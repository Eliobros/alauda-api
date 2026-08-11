// ===== SERVICES/DEBITOPAYSERVICE.JS =====
// Lógica de integração com a Débito Pay (M-Pesa, E-Mola, mKesh, Visa/Mastercard).
// Separado do router para facilitar a manutenção e testes.

// ===== CONFIGURAÇÕES =====

const DEBITOPAY_API_URL = 'https://gyqoaningqhurhvdugne.supabase.co/functions/v1/payment-orchestrator';
const DEBITOPAY_WALLET_BALANCE_URL = 'https://gyqoaningqhurhvdugne.supabase.co/functions/v1/wallet-balance';
const DEBITOPAY_API_KEY = process.env.DEBITOPAY_API_KEY || 'sk_live_xxx';
const DEBITOPAY_MERCHANT_ID = process.env.DEBITOPAY_MERCHANT_ID || 'SEU_MERCHANT_UUID';
const DEBITOPAY_WEBHOOK_SECRET = process.env.DEBITOPAY_WEBHOOK_SECRET || 'seu_webhook_secret';

// Cada método de pagamento tem sua própria carteira na Débito Pay.
// Preenche os wallet_code conforme for criando cada carteira no painel deles.
const DEBITOPAY_WALLETS = {
    mpesa: {
        name: 'M-Pesa',
        wallet_code: process.env.DEBITOPAY_WALLET_MPESA || 'PREENCHER_WALLET_MPESA'
    },
    emola: {
        name: 'E-Mola',
        wallet_code: process.env.DEBITOPAY_WALLET_EMOLA || 'PREENCHER_WALLET_EMOLA'
    },
    mkesh: {
        name: 'mKesh',
        wallet_code: process.env.DEBITOPAY_WALLET_MKESH || 'PREENCHER_WALLET_MKESH'
    },
    visa_mastercard: {
        name: 'Visa/Mastercard',
        wallet_code: process.env.DEBITOPAY_WALLET_CARD || 'PREENCHER_WALLET_CARD'
    }
};

// ===== TRADUÇÃO DE ERROS =====

// Dicionário de erros conhecidos da Débito Pay -> mensagem amigável pro cliente final.
// Erros que NÃO estão nesse dicionário são tratados como erro interno (não expõe a mensagem crua).
const DEBITOPAY_ERROR_MESSAGES = {
    'Insufficient balance': 'Saldo insuficiente. Recarrega a tua conta e tenta novamente.',
    'Número de telefone inválido. Use formato M-Pesa válido.': 'Número de telefone inválido. Verifica o formato (258XXXXXXXXX).',
    'O valor mínimo para pagamentos via M-Pesa é 10 MT.': 'O valor mínimo para pagamento via M-Pesa é 10 MZN.',
    'Initiator authentication error.': 'PIN incorreto ou pagamento cancelado. Tenta novamente.',
    // Erros específicos do payout B2C (confirmados na doc da Débito Pay)
    'INSUFFICIENT_MATURED_BALANCE': 'Saldo insuficiente para o envio. Tenta novamente mais tarde.',
    'WALLET_INACTIVE': 'Carteira de envio indisponível. Contacta o suporte.',
    'WALLET_CODE_NOT_FOUND': 'Carteira de envio não encontrada. Contacta o suporte.',
    'WALLET_DOMAIN_NOT_ALLOWED': 'Origem da chamada não autorizada para esta carteira.'
};

// Erros internos de configuração — nunca devem aparecer para o cliente final,
// mas ajudam a identificar rapidamente o que quebrou nos logs.
const DEBITOPAY_INTERNAL_ERROR_HINTS = [
    'merchant_id',
    'wallet_code',
    'wallet not found',
    'invalid merchant'
];

function traduzErroDebitoPay(errorMessage) {
    if (DEBITOPAY_ERROR_MESSAGES[errorMessage]) {
        return { mensagem: DEBITOPAY_ERROR_MESSAGES[errorMessage], interno: false };
    }

    const pareceErroInterno = DEBITOPAY_INTERNAL_ERROR_HINTS.some(hint =>
        (errorMessage || '').toLowerCase().includes(hint)
    );

    if (pareceErroInterno) {
        console.error('🚨 Possível erro de configuração Débito Pay:', errorMessage);
    }

    return {
        mensagem: 'Não foi possível processar o pagamento. Tenta novamente em instantes.',
        interno: true
    };
}

// ===== PROCESSAMENTO (FUNÇÃO CENTRAL) =====

async function processDebitoPayPayment(metodo, data) {
    const wallet = DEBITOPAY_WALLETS[metodo];

    if (!wallet) {
        throw new Error(`Método de pagamento não suportado: ${metodo}`);
    }

    const sourceId = `alauda_${data.usuario_id}_${Date.now()}`;

    const payload = {
        action: 'process',
        payment_method: metodo,
        merchant_id: DEBITOPAY_MERCHANT_ID,
        wallet_code: wallet.wallet_code,
        amount: parseFloat(data.valor),
        currency: 'MZN',
        phone: data.numero_celular,
        source: 'alauda_api',
        source_id: sourceId
    };

    console.log(`📤 Enviando requisição para Débito Pay (${wallet.name}):`, {
        ...payload,
        merchant_id: '***',
        wallet_code: '***'
    });

    const fetchResponse = await fetch(DEBITOPAY_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${DEBITOPAY_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    const responseData = await fetchResponse.json();
    console.log('📥 Resposta Débito Pay:', responseData);

    if (!responseData.success) {
        const { mensagem, interno } = traduzErroDebitoPay(responseData.error);
        const err = new Error(mensagem);
        err.isDebitoPayError = true;
        err.internal = interno;
        err.rawError = responseData.error;
        err.httpStatus = fetchResponse.status;
        throw err;
    }

    return {
        success: true,
        metodo: wallet.name,
        valor: data.valor,
        numero_celular: data.numero_celular,
        usuario_id: data.usuario_id,
        payment_id: responseData.payment_id,
        status: responseData.status,
        checkout_url: responseData.checkout_url || null, // usado no visa_mastercard
        source_id: sourceId,
        created_at: new Date().toISOString()
    };
}

// ===== PAYOUT (B2C — ENVIO DE DINHEIRO) =====

// Envia dinheiro para o telemóvel do cliente (payout B2C).
// Confirmado com a doc/suporte da Débito Pay:
//   POST {DEBITOPAY_API_URL}?action=payout   ← action vai na QUERY STRING, não no body
//   Body: { payment_method, wallet_code, amount, phone (258XXXXXXXXX), reference }
// Resposta: { success, payment: { id, status, provider_reference, payment_method, amount, currency } }
async function processDebitoPayPayout({ valor, numero_celular, usuario_id, reference, metodo = 'mpesa' }) {
    const wallet = DEBITOPAY_WALLETS[metodo];

    if (!wallet) {
        throw new Error(`Método de pagamento não suportado para payout: ${metodo}`);
    }

    // Normaliza o telefone para formato internacional (258XXXXXXXXX) como no exemplo oficial
    const localPhone = String(numero_celular).replace(/^258/, '');
    const phone = `258${localPhone}`;

    // Referência única (aceita a do cliente ou gera automática)
    const ref = reference || `alauda_payout_${usuario_id}_${Date.now()}`;

    const payload = {
        payment_method: metodo,
        wallet_code: wallet.wallet_code,
        amount: parseFloat(valor),
        phone,
        reference: ref
    };

    console.log(`📤 Enviando PAYOUT (${wallet.name}) para Débito Pay:`, {
        ...payload,
        wallet_code: '***'
    });

    const fetchResponse = await fetch(`${DEBITOPAY_API_URL}?action=payout`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${DEBITOPAY_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    const responseData = await fetchResponse.json();
    console.log('📥 Resposta Débito Pay (payout):', responseData);

    if (!responseData.success) {
        const { mensagem, interno } = traduzErroDebitoPay(responseData.error);
        const err = new Error(mensagem);
        err.isDebitoPayError = true;
        err.internal = interno;
        err.rawError = responseData.error;
        err.httpStatus = fetchResponse.status;
        throw err;
    }

    // A doc usa { payment: { id, status, ... } }; aceita também o formato antigo
    // { payment_id, status } para ser defensivo com as duas versões da API.
    return {
        success: true,
        metodo: wallet.name,
        valor: valor,
        numero_celular: numero_celular,
        payment_id: responseData.payment?.id || responseData.payment_id,
        status: responseData.payment?.status || responseData.status,
        provider_reference: responseData.payment?.provider_reference || responseData.provider_reference || null,
        reference: ref,
        source_id: `alauda_payout_${usuario_id}_${Date.now()}`,
        created_at: new Date().toISOString()
    };
}

// ===== CONSULTA DE SALDO DA WALLET =====

// Endpoint próprio da Débito Pay: GET .../v1/wallet-balance?wallet_code=XXXXX
// Usado antes do payout para garantir que há saldo — evita cobrar o cliente
// no PayPal e depois não conseguir enviar o M-Pesa.
// Helper: pega a primeira wallet do array (formato real da API: { wallets: [...] })
function primeiraWallet(data) {
    if (Array.isArray(data?.wallets) && data.wallets.length > 0) return data.wallets[0];
    if (Array.isArray(data?.data?.wallets) && data.data.wallets.length > 0) return data.data.wallets[0];
    return null;
}

function extrairSaldo(data) {
    const w = primeiraWallet(data);
    // Formatos defensivos: balance, wallet.balance, data.balance, wallets[0].balance...
    const b = data?.balance ??
        data?.wallet?.balance ??
        w?.balance ??
        data?.data?.balance ??
        data?.data?.wallet?.balance ??
        data?.available_balance ??
        data?.wallet_balance;
    if (typeof b === 'number') return b;
    if (typeof b === 'string' && b.trim() !== '') {
        // Remove separadores de milhar/espaços (ex: "75,000.50" → 75000.50)
        const n = parseFloat(b.replace(/[^\d.\-]/g, ''));
        return isNaN(n) ? NaN : n;
    }
    return NaN;
}

async function checkWalletBalance(walletCode = null) {
    const code = walletCode || DEBITOPAY_WALLETS.mpesa.wallet_code;

    const url = `${DEBITOPAY_WALLET_BALANCE_URL}?wallet_code=${encodeURIComponent(code)}`;

    console.log(`📤 Consultando saldo da wallet Débito Pay (${code})...`);

    const fetchResponse = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${DEBITOPAY_API_KEY}`,
            'Content-Type': 'application/json'
        }
    });

    const responseData = await fetchResponse.json();
    console.log('📥 Resposta Débito Pay (saldo):', responseData);

    if (!responseData.success) {
        const err = new Error(responseData.error || 'Falha ao consultar o saldo da wallet');
        err.isDebitoPayError = true;
        err.rawError = responseData.error;
        err.httpStatus = fetchResponse.status;
        throw err;
    }

    const balance = extrairSaldo(responseData);
    if (typeof balance !== 'number' || isNaN(balance)) {
        throw new Error('Formato de saldo inesperado na resposta da Débito Pay');
    }

    const w = primeiraWallet(responseData);

    return {
        balance,
        currency: w?.currency || responseData.currency || responseData.data?.currency || 'MZN',
        wallet_code: w?.wallet_code || code,
        wallet_status: w?.status || null
    };
}

module.exports = {
    DEBITOPAY_API_URL,
    DEBITOPAY_API_KEY,
    DEBITOPAY_MERCHANT_ID,
    DEBITOPAY_WEBHOOK_SECRET,
    DEBITOPAY_WALLETS,
    traduzErroDebitoPay,
    processDebitoPayPayment,
    processDebitoPayPayout,
    checkWalletBalance
};
