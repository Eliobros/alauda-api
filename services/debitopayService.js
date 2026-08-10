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

const DEBITOPAY_WALLET_PLATFORM = DEBITOPAY_WALLETS.mpesa.wallet_code; // = '07503' (Mozhost-Mpesa)

const DEBITOPAY_FEE_PERCENTAGE = 7;

const DEBITOPAY_SPLIT_PARTNERS = {
    felio: {
        name: 'Felio Cliente #1',
        wallet_code: process.env.DEBITOPAY_WALLET_PARCEIRO_FELIO || 'PREENCHER_WALLET_FELIO',
        partner_percentage: 85,   // Felio recebe 85% do líquido (pós-taxa)
        platform_percentage: 15   // Tu recebes 15% do líquido (pós-taxa)
    },
    helio: {
        name: 'Helio',
        wallet_code: process.env.DEBITOPAY_WALLET_PARCEIRO_HELIO || 'PREENCHER_WALLET_HELIO',
        partner_percentage: 85,
        platform_percentage: 15
    }
};

// ===== BREAKDOWN DE SPLIT =====

// Calcula quanto cada lado recebe de facto, já descontada a taxa da Débito Pay.
// Versão INTERNA (completa) — inclui a comissão da plataforma.
// Usar só para logs internos / gravação em BD, nunca para responder ao parceiro.
function calcularBreakdownSplit(valorBruto, partner) {
    const valorLiquido = valorBruto * (1 - DEBITOPAY_FEE_PERCENTAGE / 100);
    const valorParceiro = valorLiquido * (partner.partner_percentage / 100);
    const valorPlataforma = valorLiquido * (partner.platform_percentage / 100);
    const valorTaxaDebitoPay = valorBruto - valorLiquido;

    return {
        valor_bruto: Number(valorBruto.toFixed(2)),
        taxa_debitopay: Number(valorTaxaDebitoPay.toFixed(2)),
        valor_liquido: Number(valorLiquido.toFixed(2)),
        recebe_parceiro: Number(valorParceiro.toFixed(2)),
        recebe_plataforma: Number(valorPlataforma.toFixed(2))
    };
}

// Versão PÚBLICA do breakdown — esconde "recebe_plataforma" (a tua comissão),
// que é informação interna e não deve ser exposta ao parceiro.
function breakdownPublico(breakdownCompleto) {
    const { recebe_plataforma, ...resto } = breakdownCompleto;
    return {
        ...resto,
        voce_recebe: resto.recebe_parceiro
    };
}

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

async function processDebitoPayPaymentParceiro(parceiro, metodo, data) {
    const partner = DEBITOPAY_SPLIT_PARTNERS[parceiro];

    if (!partner) {
        const err = new Error(`Parceiro não configurado: ${parceiro}`);
        err.httpStatus = 404;
        throw err;
    }

    if (metodo !== 'mpesa' && metodo !== 'emola') {
        const err = new Error(`Método não suportado para parceiros: ${metodo}`);
        err.httpStatus = 400;
        throw err;
    }

    // Validação de segurança: soma das percentagens tem de dar 100
    const somaPercentagens = partner.partner_percentage + partner.platform_percentage;
    if (Math.abs(somaPercentagens - 100) > 0.01) {
        console.error(`🚨 Configuração de split inválida para parceiro ${parceiro}: soma = ${somaPercentagens}`);
        const err = new Error('Erro de configuração no split de pagamento. Contacta o suporte.');
        err.httpStatus = 500;
        err.internal = true;
        throw err;
    }

    const valorNumerico = parseFloat(data.valor);
    if (!Number.isFinite(valorNumerico) || valorNumerico <= 0) {
        const err = new Error('Valor de pagamento inválido.');
        err.httpStatus = 400;
        throw err;
    }

    const sourceId = `alauda_parceiro_${parceiro}_${data.usuario_id}_${Date.now()}`;

    // Breakdown líquido — INTERNO, inclui a tua comissão. Guardamos separado
    // da resposta pública que vai pro parceiro.
    const breakdownInterno = calcularBreakdownSplit(valorNumerico, partner);

    // NOTA (confirmada com o suporte da Débito Pay): o campo amount é enviado
    // no formato decimal (200.00 = 200.00 MZN), NÃO em centavos.

    const payload = {
        action: 'process',
        payment_method: metodo,
        merchant_id: DEBITOPAY_MERCHANT_ID,
        amount: valorNumerico,
        currency: 'MZN',
        phone: data.numero_celular,
        source: 'alauda_api_parceiro',
        source_id: sourceId,
        split_payout_rules: [
            {
                wallet_code: partner.wallet_code,
                percentage: partner.partner_percentage,
                description: `Parte do parceiro (${partner.name})`
            },
            {
                wallet_code: DEBITOPAY_WALLET_PLATFORM,
                percentage: partner.platform_percentage,
                description: 'Comissão de Plataforma MozHost'
            }
        ]
    };

    console.log(`📤 Enviando requisição SPLIT para Débito Pay (Parceiro: ${partner.name}, ${metodo}):`, {
        ...payload,
        merchant_id: '***',
        split_payout_rules: payload.split_payout_rules.map(r => ({ ...r, wallet_code: '***' }))
    });
    console.log(`💰 Breakdown líquido (bruto ${valorNumerico} MZN, taxa DebitoPay ${DEBITOPAY_FEE_PERCENTAGE}%):`, breakdownInterno);

    const fetchResponse = await fetch(DEBITOPAY_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${DEBITOPAY_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    const responseData = await fetchResponse.json();

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
        metodo: `${metodo} (Split — Parceiro: ${partner.name}, ${partner.partner_percentage}%/${partner.platform_percentage}%)`,
        valor: data.valor,
        numero_celular: data.numero_celular,
        usuario_id: data.usuario_id,
        payment_id: responseData.payment_id,
        status: responseData.status,
        source_id: sourceId,
        breakdown_interno: breakdownInterno, // guarda completo (não devolver isso direto na rota!)
        created_at: new Date().toISOString()
    };
}

module.exports = {
    DEBITOPAY_API_URL,
    DEBITOPAY_API_KEY,
    DEBITOPAY_MERCHANT_ID,
    DEBITOPAY_WEBHOOK_SECRET,
    DEBITOPAY_WALLETS,
    DEBITOPAY_WALLET_PLATFORM,
    DEBITOPAY_FEE_PERCENTAGE,
    DEBITOPAY_SPLIT_PARTNERS,
    calcularBreakdownSplit,
    breakdownPublico,
    traduzErroDebitoPay,
    processDebitoPayPayment,
    processDebitoPayPaymentParceiro
};
