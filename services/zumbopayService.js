// ===== SERVICES/ZUMBOPAYSERVICE.JS =====
// Lógica de integração com a Zumbo Pay (M-Pesa, E-Mola, Visa/Mastercard).
// Substitui o antigo Débito Pay. Documentação: docs.txt (API Zumbo Pay).

// ===== CONFIGURAÇÕES =====

const ZUMBOPAY_BASE_URL = 'https://zumbopay.com/api/public/v1';
const ZUMBOPAY_API_KEY = process.env.ZUMBOPAY_API_KEY || 'zk_test_SUA_CHAVE';
const ZUMBOPAY_MERCHANT_ID = process.env.ZUMBOPAY_MERCHANT_ID || 'MCH_XXXXXXXXXX';
const ZUMBOPAY_WEBHOOK_SECRET = process.env.ZUMBOPAY_WEBHOOK_SECRET || 'whsec_...';

// Wallet IDs (UUIDs) — obtidos via GET /wallets e guardados no .env
const ZUMBOPAY_WALLETS = {
    mpesa: {
        name: 'M-Pesa',
        wallet_id: process.env.ZUMBOPAY_WALLET_MPESA || ''
    },
    emola: {
        name: 'E-Mola',
        wallet_id: process.env.ZUMBOPAY_WALLET_EMOLA || ''
    },
    card: {
        name: 'Visa/Mastercard',
        wallet_id: process.env.ZUMBOPAY_WALLET_CARD || ''
    }
};

// ===== HELPERS =====

function buildHeaders(extra = {}) {
    return {
        'Authorization': `Bearer ${ZUMBOPAY_API_KEY}`,
        'X-Merchant-Id': ZUMBOPAY_MERCHANT_ID,
        'Content-Type': 'application/json',
        ...extra
    };
}

// ===== TRADUÇÃO DE ERROS =====

const ZUMBOPAY_ERROR_MESSAGES = {
    'insufficient_funds': 'Saldo insuficiente na carteira. Recarrega e tenta novamente.',
    'wallet_not_found': 'Carteira de pagamento não encontrada. Contacta o suporte.',
    'missing_wallet_id': 'Carteira de pagamento não configurada. Contacta o suporte.',
    'invalid_input': 'Dados de pagamento inválidos. Verifica os campos e tenta novamente.',
    'invalid_api_key': 'Chave de API inválida. Contacta o suporte.',
    'revoked_api_key': 'Chave de API revogada. Contacta o suporte.',
    'expired_api_key': 'Chave de API expirada. Contacta o suporte.',
    'insufficient_scope': 'Permissão insuficiente para esta operação.',
    'psp_declined': 'Pagamento recusado pelo provedor. Tenta novamente.',
    'manual_min_amount': 'Valor mínimo para saque manual é 500 MZN.',
    'auto_dispatch_unsupported': 'Envio automático não suportado para este método.',
    'b2c_failed': 'Falha no envio B2C. Tenta novamente.',
    'merchant_id_mismatch': 'Merchant ID não corresponde à chave de API.'
};

const ZUMBOPAY_INTERNAL_ERROR_HINTS = [
    'merchant_id',
    'wallet_id',
    'wallet_not_found',
    'invalid merchant'
];

function traduzErroZumboPay(errorMessage, errorCode) {
    if (errorCode && ZUMBOPAY_ERROR_MESSAGES[errorCode]) {
        return { mensagem: ZUMBOPAY_ERROR_MESSAGES[errorCode], interno: false };
    }
    if (errorMessage && ZUMBOPAY_ERROR_MESSAGES[errorMessage]) {
        return { mensagem: ZUMBOPAY_ERROR_MESSAGES[errorMessage], interno: false };
    }

    const pareceErroInterno = ZUMBOPAY_INTERNAL_ERROR_HINTS.some(hint =>
        (errorMessage || '').toLowerCase().includes(hint) ||
        (errorCode || '').toLowerCase().includes(hint)
    );

    if (pareceErroInterno) {
        console.error('🚨 Possível erro de configuração Zumbo Pay:', errorMessage || errorCode);
    }

    return {
        mensagem: 'Não foi possível processar o pagamento. Tenta novamente em instantes.',
        interno: true
    };
}

// ===== COBRANÇA DIRECTA (STK PUSH) =====
// POST /charges — M-Pesa (84/85) e E-Mola (86/87)
// O cliente recebe o popup do PIN no telemóvel. Sem redirecionamento.

async function processZumboPayCharge(metodo, data) {
    const wallet = ZUMBOPAY_WALLETS[metodo];

    if (!wallet || !wallet.wallet_id) {
        throw new Error(`Método de pagamento não suportado ou wallet não configurada: ${metodo}`);
    }

    const sourceId = `alauda_${data.usuario_id}_${Date.now()}`;

    const payload = {
        wallet_id: wallet.wallet_id,
        amount: parseFloat(data.valor),
        msisdn: data.numero_celular,
        customer_name: data.customer_name || undefined,
        source_id: sourceId
    };

    console.log(`📤 Enviando charge Zumbo Pay (${wallet.name}):`, {
        ...payload,
        wallet_id: '***',
        msisdn: data.numero_celular ? `${data.numero_celular.slice(0, 6)}***` : undefined
    });

    const fetchResponse = await fetch(`${ZUMBOPAY_BASE_URL}/charges`, {
        method: 'POST',
        headers: buildHeaders({ 'Idempotency-Key': sourceId }),
        body: JSON.stringify(payload)
    });

    const responseData = await fetchResponse.json();
    console.log('📥 Resposta Zumbo Pay (charge):', responseData);

    // 200 = sucesso síncrono, 202 = aguardar PIN do cliente
    if (fetchResponse.status === 200 || fetchResponse.status === 202) {
        return {
            success: true,
            metodo: wallet.name,
            valor: data.valor,
            numero_celular: data.numero_celular,
            usuario_id: data.usuario_id,
            payment_id: responseData.data?.reference || sourceId,
            reference: responseData.data?.reference,
            status: responseData.data?.status || 'pending',
            checkout_url: null, // STK push não usa checkout_url
            source_id: sourceId,
            channel: responseData.data?.channel || metodo,
            created_at: new Date().toISOString()
        };
    }

    // Erro
    const errorData = responseData.error || responseData;
    const { mensagem, interno } = traduzErroZumboPay(errorData.message, errorData.code);
    const err = new Error(mensagem);
    err.isZumboPayError = true;
    err.internal = interno;
    err.rawError = errorData.message || errorData.code;
    err.httpStatus = fetchResponse.status;
    throw err;
}

// ===== CHECKOUT HOSPEDADO (VISA/MASTERCARD + 3DS) =====
// POST /payments — devolve checkout_url para redirecionar o cliente.
// Suporta M-Pesa, E-Mola E Visa/Mastercard (3DS em iframe).

async function processZumboPayCheckout(data) {
    const wallet = ZUMBOPAY_WALLETS.card;

    if (!wallet || !wallet.wallet_id) {
        throw new Error('Wallet de cartão não configurada. Contacta o suporte.');
    }

    const sourceId = `alauda_${data.usuario_id}_${Date.now()}`;

    const payload = {
        title: data.description || `Pagamento #${sourceId}`,
        amount: parseFloat(data.valor),
        currency: 'MZN',
        channels: ['card'],
        wallet_id: wallet.wallet_id
    };

    console.log('📤 Enviando checkout Zumbo Pay (card):', {
        ...payload,
        wallet_id: '***'
    });

    const fetchResponse = await fetch(`${ZUMBOPAY_BASE_URL}/payments`, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(payload)
    });

    const responseData = await fetchResponse.json();
    console.log('📥 Resposta Zumbo Pay (checkout):', responseData);

    if (fetchResponse.status === 201) {
        return {
            success: true,
            metodo: 'Visa/Mastercard',
            valor: data.valor,
            usuario_id: data.usuario_id,
            payment_id: responseData.data?.id || sourceId,
            reference: responseData.data?.reference,
            status: 'pending',
            checkout_url: responseData.data?.checkout_url || null,
            source_id: sourceId,
            created_at: new Date().toISOString()
        };
    }

    const errorData = responseData.error || responseData;
    const { mensagem, interno } = traduzErroZumboPay(errorData.message, errorData.code);
    const err = new Error(mensagem);
    err.isZumboPayError = true;
    err.internal = interno;
    err.rawError = errorData.message || errorData.code;
    err.httpStatus = fetchResponse.status;
    throw err;
}

// ===== PROCESSAMENTO CENTRAL (ROTEADOR) =====
// Roteia para charge (STK) ou checkout (card) conforme o método.

async function processZumboPayPayment(metodo, data) {
    if (metodo === 'visa_mastercard' || metodo === 'card') {
        return processZumboPayCheckout(data);
    }

    // M-Pesa e E-Mola usam STK push (/charges)
    if (metodo === 'mpesa' || metodo === 'emola') {
        return processZumboPayCharge(metodo, data);
    }

    throw new Error(`Método de pagamento não suportado: ${metodo}`);
}

// ===== PAYOUT (B2C — ENVIO DE DINHEIRO) =====
// POST /payouts — envia dinheiro para o telemóvel do cliente.

async function processZumboPayPayout({ valor, numero_celular, usuario_id, reference, metodo = 'mpesa' }) {
    const wallet = ZUMBOPAY_WALLETS[metodo];

    if (!wallet || !wallet.wallet_id) {
        throw new Error(`Método de pagamento não suportado para payout: ${metodo}`);
    }

    // Normaliza o telefone para formato internacional (258XXXXXXXXX)
    const localPhone = String(numero_celular).replace(/^258/, '');
    const phone = `258${localPhone}`;

    const ref = reference || `alauda_payout_${usuario_id}_${Date.now()}`;

    const payload = {
        wallet_id: wallet.wallet_id,
        amount: parseFloat(valor),
        method: metodo,
        destination: phone,
        auto_dispatch: metodo === 'mpesa', // B2C instantâneo só para M-Pesa
        notes: ref
    };

    console.log(`📤 Enviando PAYOUT Zumbo Pay (${wallet.name}):`, {
        ...payload,
        wallet_id: '***'
    });

    const fetchResponse = await fetch(`${ZUMBOPAY_BASE_URL}/payouts`, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(payload)
    });

    const responseData = await fetchResponse.json();
    console.log('📥 Resposta Zumbo Pay (payout):', responseData);

    if (fetchResponse.status === 201) {
        return {
            success: true,
            metodo: wallet.name,
            valor: valor,
            numero_celular: numero_celular,
            payment_id: responseData.data?.id || `payout_${Date.now()}`,
            status: responseData.data?.status || 'pending',
            provider_reference: responseData.data?.reference || responseData.data?.provider_reference || null,
            fee_amount: responseData.data?.fee_amount || 0,
            net_amount: responseData.data?.net_amount || valor,
            reference: ref,
            source_id: `alauda_payout_${usuario_id}_${Date.now()}`,
            created_at: new Date().toISOString()
        };
    }

    const errorData = responseData.error || responseData;
    const { mensagem, interno } = traduzErroZumboPay(errorData.message, errorData.code);
    const err = new Error(mensagem);
    err.isZumboPayError = true;
    err.internal = interno;
    err.rawError = errorData.message || errorData.code;
    err.httpStatus = fetchResponse.status;
    throw err;
}

// ===== CONSULTA DE SALDO DAS WALLETS =====
// GET /wallets — lista todas as carteiras com saldo.

async function checkWalletBalance(walletId = null) {
    const targetWallet = walletId
        ? Object.values(ZUMBOPAY_WALLETS).find(w => w.wallet_id === walletId || w.name.toLowerCase().includes(walletId.toLowerCase()))
        : ZUMBOPAY_WALLETS.mpesa;

    if (!targetWallet || !targetWallet.wallet_id) {
        throw new Error('Wallet não configurada. Verifica as variáveis de ambiente ZUMBOPAY_WALLET_*');
    }

    console.log(`📤 Consultando saldos das wallets Zumbo Pay...`);

    const fetchResponse = await fetch(`${ZUMBOPAY_BASE_URL}/wallets`, {
        method: 'GET',
        headers: buildHeaders()
    });

    const responseData = await fetchResponse.json();
    console.log('📥 Resposta Zumbo Pay (wallets):', responseData);

    if (fetchResponse.status !== 200) {
        const errorData = responseData.error || responseData;
        const err = new Error(errorData.message || 'Falha ao consultar saldos das wallets');
        err.isZumboPayError = true;
        err.rawError = errorData.message;
        err.httpStatus = fetchResponse.status;
        throw err;
    }

    const wallets = responseData.data || [];
    const wallet = wallets.find(w => w.id === targetWallet.wallet_id);

    if (!wallet) {
        throw new Error(`Wallet ${targetWallet.name} não encontrada na resposta da Zumbo Pay`);
    }

    return {
        balance: wallet.balance || 0,
        currency: wallet.currency || 'MZN',
        wallet_id: wallet.id,
        wallet_code: wallet.wallet_code || null,
        wallet_status: wallet.is_active ? 'active' : 'inactive',
        wallet_name: wallet.name,
        method: wallet.method
    };
}

// ===== LISTAR TODAS AS WALLETS =====

async function listWallets() {
    console.log('📤 Listando wallets Zumbo Pay...');

    const fetchResponse = await fetch(`${ZUMBOPAY_BASE_URL}/wallets`, {
        method: 'GET',
        headers: buildHeaders()
    });

    const responseData = await fetchResponse.json();
    console.log('📥 Resposta Zumbo Pay (list wallets):', responseData);

    if (fetchResponse.status !== 200) {
        const errorData = responseData.error || responseData;
        const err = new Error(errorData.message || 'Falha ao listar wallets');
        err.isZumboPayError = true;
        err.httpStatus = fetchResponse.status;
        throw err;
    }

    return responseData.data || [];
}

// ===== VALIDAR CREDENCIAIS =====

async function validateCredentials() {
    console.log('📤 Validando credenciais Zumbo Pay...');

    const fetchResponse = await fetch(`${ZUMBOPAY_BASE_URL}/merchant/validate`, {
        method: 'GET',
        headers: buildHeaders()
    });

    const responseData = await fetchResponse.json();
    console.log('📥 Resposta Zumbo Pay (validate):', responseData);

    return responseData.data || responseData;
}

module.exports = {
    ZUMBOPAY_BASE_URL,
    ZUMBOPAY_API_KEY,
    ZUMBOPAY_MERCHANT_ID,
    ZUMBOPAY_WEBHOOK_SECRET,
    ZUMBOPAY_WALLETS,
    traduzErroZumboPay,
    processZumboPayPayment,
    processZumboPayCharge,
    processZumboPayCheckout,
    processZumboPayPayout,
    checkWalletBalance,
    listWallets,
    validateCredentials
};
