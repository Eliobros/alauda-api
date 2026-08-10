// ===== SERVICES/DEBITOPAYSERVICE.JS =====
// Lógica de integração com a Débito Pay (M-Pesa, E-Mola, mKesh, Visa/Mastercard).
// Separado do router para facilitar a manutenção e testes.

// ===== CONFIGURAÇÕES =====

const DEBITOPAY_API_URL = 'https://gyqoaningqhurhvdugne.supabase.co/functions/v1/payment-orchestrator';
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
    'Initiator authentication error.': 'PIN incorreto ou pagamento cancelado. Tenta novamente.'
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

module.exports = {
    DEBITOPAY_API_URL,
    DEBITOPAY_API_KEY,
    DEBITOPAY_MERCHANT_ID,
    DEBITOPAY_WEBHOOK_SECRET,
    DEBITOPAY_WALLETS,
    traduzErroDebitoPay,
    processDebitoPayPayment
};
