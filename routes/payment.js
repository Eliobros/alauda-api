// ===== ROUTES/PAYMENT.JS =====
// Payment Integration para Alauda API
// Suporta: MercadoPago, M-Pesa, E-Mola, mKesh, Visa/Mastercard (via Débito Pay)
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { MercadoPagoConfig, Preference, Payment: MPPayment } = require('mercadopago');
const authenticateApiKey = require('../middleware/auth');
const response = require('../utils/responseHandler');
const constants = require('../config/constants');
const Payment = require('../models/Payment');
const User = require('../models/User');
const paymentProcessor = require('../utils/paymentProcessor');
const mongoose = require('mongoose');

// ===== CONFIGURAÇÕES =====

// MercadoPago
const mpClient = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN || 'APP_USR-8802230897684987-041621-6921931c4f51569f86ef5f5a25196068-1779653557'
});

// Débito Pay (M-Pesa, E-Mola, mKesh, Visa/Mastercard)
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

const DEBITOPAY_WALLET_PLATFORM = process.env.DEBITOPAY_WALLET_PLATFORM || 'PREENCHER_WALLET_PLATAFORMA';

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

// ===== FUNÇÃO CENTRAL: DÉBITO PAY =====

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

    // Débito Pay espera valor em centavos (confirmado pelo suporte: 20000 = 200.00 MZN)
    

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

// ===== FUNÇÕES MERCADOPAGO (sem alteração) =====

async function createPaymentPreference(data) {
    try {
        const { email, amount, description, usuario_id, back_urls, notification_url } = data;

        const preference = new Preference(mpClient);

        const preferenceData = {
            body: {
                items: [
                    {
                        title: description || `Compra de ${amount} Coins`,
                        unit_price: parseFloat(amount),
                        quantity: 1,
                    }
                ],
                payer: {
                    email: email
                },
                back_urls: back_urls || {
                    success: 'https://topaziocoin.online/comprar-tpv/sucesso.php',
                    failure: 'https://topaziocoin.online/comprar-tpv/erro.php',
                    pending: 'https://topaziocoin.online/comprar-tpv/pendente.php'
                },
                auto_return: 'approved',
                external_reference: `${usuario_id}-${Date.now()}`,
                notification_url: notification_url || 'https://alauda-api.topazioverse.com.br/api/payment/webhook/mercadopago',
                statement_descriptor: 'ALAUDA API',
                expires: true,
                expiration_date_from: new Date().toISOString(),
                expiration_date_to: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            }
        };

        const preferenceResponse = await preference.create(preferenceData);

        return {
            success: true,
            id: preferenceResponse.id,
            init_point: preferenceResponse.init_point,
            sandbox_init_point: preferenceResponse.sandbox_init_point,
            external_reference: preferenceData.body.external_reference,
            created_at: new Date().toISOString()
        };

    } catch (error) {
        console.error('❌ Erro ao criar preferência MercadoPago:', error.message);
        throw new Error(`Erro ao criar pagamento: ${error.message}`);
    }
}

async function getPaymentStatus(payment_id) {
    try {
        const payment = new MPPayment(mpClient);
        const paymentData = await payment.get({ id: payment_id });

        return {
            success: true,
            payment_id: paymentData.id,
            status: paymentData.status,
            status_detail: paymentData.status_detail,
            transaction_amount: paymentData.transaction_amount,
            currency_id: paymentData.currency_id,
            date_created: paymentData.date_created,
            date_approved: paymentData.date_approved,
            payer: {
                email: paymentData.payer?.email,
                identification: paymentData.payer?.identification
            }
        };

    } catch (error) {
        console.error('❌ Erro ao consultar pagamento:', error.message);
        throw new Error(`Erro ao consultar status: ${error.message}`);
    }
}

// ===== ROTA INFO =====

router.get('/info', (req, res) => {
    response.success(res, {
        endpoint: '/api/payment',
        description: 'Sistema de pagamentos integrado com múltiplos provedores',
        providers: [
            {
                name: 'MercadoPago',
                methods: ['PIX', 'Cartão de Crédito', 'Boleto'],
                region: 'Brasil e América Latina'
            },
            {
                name: 'M-Pesa',
                methods: ['Mobile Money'],
                region: 'Moçambique (Vodacom)',
                gateway: 'Débito Pay'
            },
            {
                name: 'E-Mola',
                methods: ['Mobile Money'],
                region: 'Moçambique (Movitel)',
                gateway: 'Débito Pay'
            },
            {
                name: 'mKesh',
                methods: ['Mobile Money'],
                region: 'Moçambique',
                gateway: 'Débito Pay'
            },
            {
                name: 'Visa/Mastercard',
                methods: ['Cartão Internacional'],
                region: 'Global',
                gateway: 'Débito Pay'
            }
        ],
        features: [
            'Pagamentos via MercadoPago (PIX, Cartão, Boleto)',
            'Pagamentos via M-Pesa, E-Mola, mKesh (Débito Pay)',
            'Pagamentos via Visa/Mastercard (Débito Pay)',
            'Webhook para notificações',
            'Consulta de status',
            'Auto-creditação de créditos'
        ],
        cost: 'Não consome créditos da API',
        usage: {
            mercadopago: {
                method: 'POST',
                endpoint: '/api/payment/mercadopago',
                body: { email: 'cliente@email.com', amount: 50.00, description: 'Compra de créditos', usuario_id: '123' }
            },
            mpesa: {
                method: 'POST',
                endpoint: '/api/payment/mpesa',
                body: { valor: '100.00', numero_celular: '841234567', usuario_id: '123' }
            },
            emola: {
                method: 'POST',
                endpoint: '/api/payment/emola',
                body: { valor: '100.00', numero_celular: '861234567', usuario_id: '123' }
            }
        }
    });
});

// ===== ROTAS MERCADOPAGO (sem alteração) =====

router.post('/mercadopago', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { email, amount, description, usuario_id, back_urls, notification_url } = req.body;

        if (!email) {
            return response.validationError(res, [{ field: 'email', message: 'Email é obrigatório' }]);
        }
        if (!amount || amount < 5) {
            return response.validationError(res, [{ field: 'amount', message: 'Valor mínimo é R$ 5,00' }]);
        }
        if (!usuario_id) {
            return response.validationError(res, [{ field: 'usuario_id', message: 'ID do usuário é obrigatório' }]);
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return response.validationError(res, [{ field: 'email', message: 'Email inválido' }]);
        }

        const mongoUserId = usuario_id.toString().trim();

        const paymentData = await createPaymentPreference({
            email, amount, description, usuario_id: mongoUserId, back_urls, notification_url
        });

        const credits = paymentProcessor.calculateCredits(amount, 'BRL');

        const payment = await Payment.createPayment({
            payment_id: paymentData.id,
            provider: 'mercadopago',
            userId: mongoUserId,
            apiKey: req.apiKeyData.key,
            email: email,
            amount: amount,
            currency: 'BRL',
            credits_to_add: credits,
            description: description,
            ip_address: req.clientIP,
            user_agent: req.userAgent,
            mercadopago_data: {
                preference_id: paymentData.id,
                init_point: paymentData.init_point,
                external_reference: paymentData.external_reference
            }
        });

        await req.logSuccess({
            case: 'mercadopago_payment_created',
            usuario_id: mongoUserId,
            amount: amount,
            payment_id: paymentData.id,
            credits_to_add: credits
        });

        return response.success(res, {
            message: 'Link de pagamento MercadoPago criado com sucesso',
            provider: 'MercadoPago',
            payment: { ...paymentData, credits_to_receive: credits, payment_db_id: payment._id },
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro na rota payment/mercadopago:', error);
        await req.logError(500, error.message, { case: 'mercadopago_payment' });
        return response.error(res, error.message, 500);
    }
}));

// ===== ROTAS M-PESA (agora via Débito Pay) =====

router.post('/mpesa', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { valor, numero_celular, usuario_id } = req.body;

        if (!valor || parseFloat(valor) < 10) {
            return response.validationError(res, [
                { field: 'valor', message: 'Valor mínimo é 10.00 MZN' }
            ]);
        }
        if (!numero_celular) {
            return response.validationError(res, [
                { field: 'numero_celular', message: 'Número de celular é obrigatório' }
            ]);
        }
        if (!usuario_id) {
            return response.validationError(res, [
                { field: 'usuario_id', message: 'ID do usuário é obrigatório' }
            ]);
        }

        const phoneRegex = /^(84|85)\d{7}$/;
        if (!phoneRegex.test(numero_celular)) {
            return response.validationError(res, [
                { field: 'numero_celular', message: 'Número M-Pesa inválido. Use formato: 84xxxxxxx ou 85xxxxxxx' }
            ]);
        }

        const mongoUserId = usuario_id.toString().trim();

        const paymentData = await processDebitoPayPayment('mpesa', {
            valor, numero_celular, usuario_id: mongoUserId
        });

        const credits = paymentProcessor.calculateCredits(valor, 'MZN');

        const payment = await Payment.createPayment({
            payment_id: paymentData.payment_id || `mpesa_${Date.now()}`,
            provider: 'mpesa',
            userId: mongoUserId,
            apiKey: req.apiKeyData.key,
            phone: numero_celular,
            amount: valor,
            currency: 'MZN',
            credits_to_add: credits,
            ip_address: req.clientIP,
            user_agent: req.userAgent,
            debitopay_data: {
                payment_id: paymentData.payment_id,
                source_id: paymentData.source_id,
                status: paymentData.status
            }
        });

        await req.logSuccess({
            case: 'mpesa_payment_created',
            usuario_id: mongoUserId,
            valor: valor,
            payment_id: paymentData.payment_id,
            credits_to_add: credits
        });

        return response.success(res, {
            message: 'Pedido M-Pesa enviado! Confirma o PIN no teu telemóvel.',
            provider: 'M-Pesa (Vodacom) via Débito Pay',
            payment: { ...paymentData, credits_to_receive: credits, payment_db_id: payment._id },
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro na rota payment/mpesa:', error);
        await req.logError(error.httpStatus || 500, error.rawError || error.message, {
            case: 'mpesa_payment',
            internal: error.internal || false
        });

        const status = error.isDebitoPayError ? (error.httpStatus || 400) : 500;
        return response.error(res, error.message, status);
    }
}));

// ===== ROTAS E-MOLA (agora via Débito Pay) =====

router.post('/emola', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { valor, numero_celular, usuario_id } = req.body;

        if (!valor || parseFloat(valor) < 10) {
            return response.validationError(res, [
                { field: 'valor', message: 'Valor mínimo é 10.00 MZN' }
            ]);
        }
        if (!numero_celular) {
            return response.validationError(res, [
                { field: 'numero_celular', message: 'Número de celular é obrigatório' }
            ]);
        }
        if (!usuario_id) {
            return response.validationError(res, [
                { field: 'usuario_id', message: 'ID do usuário é obrigatório' }
            ]);
        }

        const phoneRegex = /^(86|87)\d{7}$/;
        if (!phoneRegex.test(numero_celular)) {
            return response.validationError(res, [
                { field: 'numero_celular', message: 'Número E-Mola inválido. Use formato: 86xxxxxxx ou 87xxxxxxx' }
            ]);
        }

        const mongoUserId = usuario_id.toString().trim();

        const paymentData = await processDebitoPayPayment('emola', {
            valor, numero_celular, usuario_id: mongoUserId
        });

        const credits = paymentProcessor.calculateCredits(valor, 'MZN');

        const payment = await Payment.createPayment({
            payment_id: paymentData.payment_id || `emola_${Date.now()}`,
            provider: 'emola',
            userId: mongoUserId,
            apiKey: req.apiKeyData.key,
            phone: numero_celular,
            amount: valor,
            currency: 'MZN',
            credits_to_add: credits,
            ip_address: req.clientIP,
            user_agent: req.userAgent,
            debitopay_data: {
                payment_id: paymentData.payment_id,
                source_id: paymentData.source_id,
                status: paymentData.status
            }
        });

        await req.logSuccess({
            case: 'emola_payment_created',
            usuario_id: mongoUserId,
            valor: valor,
            payment_id: paymentData.payment_id,
            credits_to_add: credits
        });

        return response.success(res, {
            message: 'Pedido E-Mola enviado! Confirma o PIN no teu telemóvel.',
            provider: 'E-Mola (Movitel) via Débito Pay',
            payment: { ...paymentData, credits_to_receive: credits, payment_db_id: payment._id },
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro na rota payment/emola:', error);
        await req.logError(error.httpStatus || 500, error.rawError || error.message, {
            case: 'emola_payment',
            internal: error.internal || false
        });

        const status = error.isDebitoPayError ? (error.httpStatus || 400) : 500;
        return response.error(res, error.message, status);
    }
}));

// ===== ROTA MKESH (novo) =====

router.post('/mkesh', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { valor, numero_celular, usuario_id } = req.body;

        if (!valor || parseFloat(valor) < 10) {
            return response.validationError(res, [
                { field: 'valor', message: 'Valor mínimo é 10.00 MZN' }
            ]);
        }
        if (!numero_celular) {
            return response.validationError(res, [
                { field: 'numero_celular', message: 'Número de celular é obrigatório' }
            ]);
        }
        if (!usuario_id) {
            return response.validationError(res, [
                { field: 'usuario_id', message: 'ID do usuário é obrigatório' }
            ]);
        }

        const mongoUserId = usuario_id.toString().trim();

        const paymentData = await processDebitoPayPayment('mkesh', {
            valor, numero_celular, usuario_id: mongoUserId
        });

        const credits = paymentProcessor.calculateCredits(valor, 'MZN');

        const payment = await Payment.createPayment({
            payment_id: paymentData.payment_id || `mkesh_${Date.now()}`,
            provider: 'mkesh',
            userId: mongoUserId,
            apiKey: req.apiKeyData.key,
            phone: numero_celular,
            amount: valor,
            currency: 'MZN',
            credits_to_add: credits,
            ip_address: req.clientIP,
            user_agent: req.userAgent,
            debitopay_data: {
                payment_id: paymentData.payment_id,
                source_id: paymentData.source_id,
                status: paymentData.status
            }
        });

        await req.logSuccess({
            case: 'mkesh_payment_created',
            usuario_id: mongoUserId,
            valor: valor,
            payment_id: paymentData.payment_id,
            credits_to_add: credits
        });

        return response.success(res, {
            message: 'Pedido mKesh enviado! Confirma o PIN no teu telemóvel.',
            provider: 'mKesh via Débito Pay',
            payment: { ...paymentData, credits_to_receive: credits, payment_db_id: payment._id },
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro na rota payment/mkesh:', error);
        await req.logError(error.httpStatus || 500, error.rawError || error.message, {
            case: 'mkesh_payment',
            internal: error.internal || false
        });

        const status = error.isDebitoPayError ? (error.httpStatus || 400) : 500;
        return response.error(res, error.message, status);
    }
}));

router.post('/mpesa/parceiro/:parceiro', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { parceiro } = req.params;
        const { valor, numero_celular, usuario_id } = req.body;

        if (!DEBITOPAY_SPLIT_PARTNERS[parceiro]) {
            return response.error(res, `Parceiro não encontrado: ${parceiro}`, 404);
        }

        if (!valor || parseFloat(valor) < 10) {
            return response.validationError(res, [
                { field: 'valor', message: 'Valor mínimo é 10.00 MZN' }
            ]);
        }
        if (!numero_celular) {
            return response.validationError(res, [
                { field: 'numero_celular', message: 'Número de celular é obrigatório' }
            ]);
        }
        if (!usuario_id) {
            return response.validationError(res, [
                { field: 'usuario_id', message: 'ID do usuário é obrigatório' }
            ]);
        }

        const phoneRegex = /^(84|85)\d{7}$/;
        if (!phoneRegex.test(numero_celular)) {
            return response.validationError(res, [
                { field: 'numero_celular', message: 'Número M-Pesa inválido. Use formato: 84xxxxxxx ou 85xxxxxxx' }
            ]);
        }

        const mongoUserId = usuario_id.toString().trim();

        const paymentData = await processDebitoPayPaymentParceiro(parceiro, 'mpesa', {
            valor, numero_celular, usuario_id: mongoUserId
        });

        const payment = await Payment.createPayment({
            payment_id: paymentData.payment_id || `mpesa_parceiro_${parceiro}_${Date.now()}`,
            provider: `mpesa_parceiro_${parceiro}`,
            userId: mongoUserId,
            apiKey: req.apiKeyData.key,
            phone: numero_celular,
            amount: valor,
            currency: 'MZN',
            credits_to_add: 0,
            ip_address: req.clientIP,
            user_agent: req.userAgent,
            debitopay_data: {
                payment_id: paymentData.payment_id,
                source_id: paymentData.source_id,
                status: paymentData.status
            }
        });

        await req.logSuccess({
            case: 'mpesa_parceiro_payment_created',
            parceiro,
            usuario_id: mongoUserId,
            valor,
            payment_id: paymentData.payment_id
        });

        const { breakdown_interno, ...paymentSemBreakdown } = paymentData;
        const breakdown = breakdownPublico(breakdown_interno);

        return response.success(res, {
            message: 'Pedido M-Pesa enviado! Confirma o PIN no teu telemóvel.',
            provider: `M-Pesa (Vodacom) via Débito Pay — Parceiro: ${parceiro}`,
            payment: { ...paymentSemBreakdown, breakdown, payment_db_id: payment._id },
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error(`❌ Erro na rota payment/mpesa/parceiro/${req.params.parceiro}:`, error);
        await req.logError(error.httpStatus || 500, error.rawError || error.message, {
            case: 'mpesa_parceiro_payment',
            parceiro: req.params.parceiro,
            internal: error.internal || false
        });

        const status = error.isDebitoPayError ? (error.httpStatus || 400) : (error.httpStatus || 500);
        return response.error(res, error.message, status);
    }
}));

// ===== ROTAS DE CONSULTA =====

router.get('/mercadopago/status/:payment_id', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { payment_id } = req.params;

        if (!payment_id) {
            return response.validationError(res, [{ field: 'payment_id', message: 'ID do pagamento é obrigatório' }]);
        }

        const paymentStatus = await getPaymentStatus(payment_id);

        await req.logSuccess({ case: 'mercadopago_status_checked', payment_id: payment_id, status: paymentStatus.status });

        return response.success(res, {
            provider: 'MercadoPago',
            payment: paymentStatus,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro na rota payment/mercadopago/status:', error);
        await req.logError(500, error.message, { case: 'mercadopago_status' });

        if (error.message.includes('not found')) {
            return response.error(res, 'Pagamento não encontrado', 404);
        }
        return response.error(res, error.message, 500);
    }
}));

// Consulta status de pagamento na Débito Pay (via nosso próprio banco, que é atualizado pelo webhook)
router.get('/debitopay/status/:payment_id', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { payment_id } = req.params;

        const payment = await Payment.findOne({
            'debitopay_data.payment_id': payment_id   // ← corrige aqui: payment_id, não data.id
        });

        if (!payment) {
            console.warn(`⚠️ Pagamento não encontrado para payment_id: ${payment_id}`);
            return response.error(res, 'Pagamento não encontrado', 404);   // ← precisa retornar resposta aqui!
        }

        await req.logSuccess({ case: 'debitopay_status_checked', payment_id, status: payment.status });

        return response.success(res, {
            provider: 'Débito Pay',
            payment: {
                payment_id,
                status: payment.status,
                provider: payment.provider,
                amount: payment.amount
            },
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro na rota payment/debitopay/status:', error);
        await req.logError(500, error.message, { case: 'debitopay_status' });
        return response.error(res, error.message, 500);
    }
}));

// ===== WEBHOOKS =====

router.post('/webhook/mercadopago', response.asyncHandler(async (req, res) => {
    try {
        console.log('📩 Webhook MercadoPago recebido:', req.body);

        const result = await paymentProcessor.processMercadoPagoWebhook(req.body);

        if (result.success) {
            console.log('✅ Webhook processado:', result.message);
        } else {
            console.log('⚠️  Webhook não processado:', result.message);
        }

        return res.status(200).json({ received: true, ...result });

    } catch (error) {
        console.error('❌ Erro no webhook MercadoPago:', error);
        return res.status(500).json({ error: error.message });
    }
}));

// Webhook Débito Pay — confirma pagamento e credita as coins do usuário.
// IMPORTANTE: confirma com a doc/suporte da Débito Pay qual header eles usam
// para assinar o payload (abaixo assume 'x-debitopay-signature', ajusta se for diferente).
// Webhook Débito Pay — confirma pagamento e credita as coins do usuário.
// Formato real documentado:
// { "event": "payment.completed", "data": { "payment_id", "merchant_id", "wallet_code",
//   "amount", "currency", "method", "reference", "paid_at" }, "timestamp": "..." }
// Header: X-Webhook-Signature (HMAC-SHA256 do raw body, SEM prefixo "sha256=")
// Best practices exigidas pela Débito Pay: responder 200 em <5s, validar assinatura sempre,
// tratar cada payment_id de forma idempotente (evento pode chegar mais de uma vez).
router.post('/webhook/debitopay', response.asyncHandler(async (req, res) => {
  console.log('🔬 rawBody length:', req.rawBody?.length);
console.log('🔬 rawBody primeiros 200 chars:', req.rawBody?.toString().slice(0, 200));
  console.log('🔥🔥🔥 WEBHOOK DEBITOPAY CHEGOU 🔥🔥🔥');   // ← ADICIONA ESSA LINHA AQUI
    console.log('RAW BODY:', req.rawBody?.toString());        // ← E ESSA
    console.log('SIGNATURE HEADER:', req.headers['x-webhook-signature']); //
    console.log('🔍 SECRET length:', DEBITOPAY_WEBHOOK_SECRET?.length);
console.log('🔍 SECRET raw (JSON):', JSON.stringify(DEBITOPAY_WEBHOOK_SECRET));
    try {
        const rawSignature = req.headers['x-webhook-signature'] || '';
const signature = rawSignature.startsWith('sha256=') ? rawSignature.slice(7) : rawSignature;
        const payload = req.rawBody || JSON.stringify(req.body);

        if (!signature) {
            console.warn('⚠️ Webhook Débito Pay recebido sem header X-Webhook-Signature — rejeitado.');
            return res.status(401).json({ error: 'Assinatura ausente' });
        }

        const calculatedSig = crypto
            .createHmac('sha256', DEBITOPAY_WEBHOOK_SECRET)
            .update(payload)
            .digest('hex');
            
            console.log('🔑 SECRET USADO (primeiros 10 chars):', DEBITOPAY_WEBHOOK_SECRET?.slice(0, 10));
console.log('📝 SIGNATURE LIMPA (recebida):', signature);
console.log('🧮 SIGNATURE CALCULADA:', calculatedSig);
console.log('📏 TAMANHOS:', signature.length, calculatedSig.length);
            

        const assinaturaValida = signature.length === calculatedSig.length &&
            crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(calculatedSig, 'hex'));

        if (!assinaturaValida) {
            console.warn('⚠️ Assinatura inválida no webhook Débito Pay');
            return res.status(401).json({ error: 'Assinatura inválida' });
        }

        // Responde 200 imediatamente após validar a assinatura; processa em seguida.
        // Isso evita retry desnecessário se a chamada ao MozHost demorar.
        res.status(200).json({ received: true });

        const { event, data } = req.body;

        if (!data || !data.id) {
    console.warn('⚠️ Webhook Débito Pay sem data.id, ignorando:', req.body);
    return;
}

        console.log(`📩 Webhook Débito Pay [${event}]:`, data);

        const payment = await Payment.findOne({
            'debitopay_data.payment_id': data.payment_id
        });

        if (!payment) {
            console.warn(`⚠️ Pagamento não encontrado para payment_id: ${data.payment_id}`);
            return;
        }

        // Idempotência: se já processamos esse payment_id com sucesso, não credita de novo.
        if (event === 'payment.completed') {
    if (payment.status === 'completed') {
        console.log(`ℹ️ Pagamento ${data.payment_id} já estava completed, ignorando evento duplicado.`);
        return;
    }

    const isPagamentoParceiro = payment.provider && payment.provider.startsWith('mpesa_parceiro_');

    if (!isPagamentoParceiro) {
        await fetch(`${process.env.MOZHOST_API_URL}/api/payment/internal/credit-coins`, {
            method: 'POST',
            headers: {
                'x-internal-key': process.env.INTERNAL_SECRET_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId: payment.userId,
                coins: payment.credits_to_add,
                externalPaymentId: payment.payment_id
            })
        });
    } else {
        console.log(`ℹ️ Pagamento de parceiro (${payment.provider}) confirmado — sem crédito de coins no MozHost.`);
    }

    payment.status = 'completed';
    payment.debitopay_data.reference = data.reference;
    payment.debitopay_data.paid_at = data.paid_at;
    await payment.save();

    console.log(`✅ Pagamento Débito Pay confirmado: ${data.amount} ${data.currency}`);
} else if (event === 'payment.failed') {
            if (payment.status !== 'failed') {
                payment.status = 'failed';
                await payment.save();
                console.log(`❌ Pagamento Débito Pay falhou: ${data.payment_id}`);
            }

        } else if (event === 'payment.refunded') {
            // Só ocorre para Visa/Mastercard. Remove as coins que foram creditadas.
            if (payment.status === 'completed') {
                await fetch(`${process.env.MOZHOST_API_URL}/api/payment/internal/credit-coins`, {
                    method: 'POST',
                    headers: {
                        'x-internal-key': process.env.INTERNAL_SECRET_KEY,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        userId: payment.userId,
                        coins: -payment.credits_to_add // remove o que foi creditado
                    })
                });

                payment.status = 'refunded';
                await payment.save();
                console.log(`↩️ Pagamento Débito Pay reembolsado, coins removidos: ${data.payment_id}`);
            }

        } else if (event === 'payment.chargeback') {
            // Chargeback é mais sério que refund — vale notificar você manualmente também.
            payment.status = 'chargeback';
            await payment.save();
            console.warn(`🚨 CHARGEBACK recebido para pagamento ${data.payment_id} — revisar manualmente.`);
        }

    } catch (error) {
        console.error('❌ Erro no webhook Débito Pay:', error);
        // Resposta 200 já foi enviada acima; erro aqui só é logado para investigação.
    }
}));

// ===== NOVA ROTA: Processar pagamentos pendentes manualmente =====

router.post('/process-pending', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        if (req.apiKeyData.plan !== 'premium') {
            return response.error(res, 'Apenas contas premium podem executar esta ação', 403);
        }

        const result = await paymentProcessor.processPendingPayments();

        return response.success(res, {
            message: 'Processamento de pagamentos pendentes concluído',
            stats: result
        });

    } catch (error) {
        console.error('❌ Erro ao processar pendentes:', error);
        return response.error(res, error.message, 500);
    }
}));

// ===== NOVA ROTA: Listar meus pagamentos =====

router.get('/my-payments', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { status, limit = 20, page = 1, usuario_id } = req.query;

        // Se usuario_id foi passado explicitamente (fluxo MozHost com API Key genérica),
        // usa ele. Senão, cai no userId da própria API Key (fluxo de API Key pessoal).
        const targetUserId = usuario_id ? usuario_id.toString().trim() : req.apiKeyData.userId;

        const payments = await Payment.findByUser(targetUserId, {
            status,
            limit: parseInt(limit),
            skip: (parseInt(page) - 1) * parseInt(limit)
        });

        const stats = await Payment.getStats(targetUserId);

        return response.success(res, {
            payments,
            stats,
            pagination: { page: parseInt(page), limit: parseInt(limit), total: payments.length }
        });

    } catch (error) {
        console.error('❌ Erro ao listar pagamentos:', error);
        return response.error(res, error.message, 500);
    }
}));

// ===== ROTAS LEGADO (manter compatibilidade) =====

router.post('/create', authenticateApiKey, response.asyncHandler(async (req, res) => {
    req.url = '/mercadopago';
    return router.handle(req, res);
}));

router.get('/status/:payment_id', authenticateApiKey, response.asyncHandler(async (req, res) => {
    req.url = `/mercadopago/status/${req.params.payment_id}`;
    return router.handle(req, res);
}));

router.post('/visa_mastercard', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { valor, customer_email, customer_name, usuario_id, return_url } = req.body;

        if (!valor || parseFloat(valor) < 10) {
            return response.validationError(res, [
                { field: 'valor', message: 'Valor mínimo é 10.00 MZN' }
            ]);
        }
        if (!customer_email) {
            return response.validationError(res, [
                { field: 'customer_email', message: 'Email do cliente é obrigatório' }
            ]);
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(customer_email)) {
            return response.validationError(res, [
                { field: 'customer_email', message: 'Email inválido' }
            ]);
        }
        if (!usuario_id) {
            return response.validationError(res, [
                { field: 'usuario_id', message: 'ID do usuário é obrigatório' }
            ]);
        }
        if (!return_url) {
            return response.validationError(res, [
                { field: 'return_url', message: 'return_url é obrigatório' }
            ]);
        }

        const mongoUserId = usuario_id.toString().trim();

        const paymentData = await processDebitoPayPayment('visa_mastercard', {
            valor,
            usuario_id: mongoUserId,
            customer_email,
            customer_name,
            return_url
        });

        if (!paymentData.checkout_url) {
            console.error('🚨 Débito Pay não retornou checkout_url para visa_mastercard:', paymentData);
            throw new Error('Não foi possível gerar o link de pagamento. Tenta novamente em instantes.');
        }

        const credits = paymentProcessor.calculateCredits(valor, 'MZN');

        const payment = await Payment.createPayment({
            payment_id: paymentData.payment_id || `card_${Date.now()}`,
            provider: 'visa_mastercard',
            userId: mongoUserId,
            apiKey: req.apiKeyData.key,
            email: customer_email,
            amount: valor,
            currency: 'MZN',
            credits_to_add: credits,
            ip_address: req.clientIP,
            user_agent: req.userAgent,
            debitopay_data: {
                payment_id: paymentData.payment_id,
                source_id: paymentData.source_id,
                status: paymentData.status
            }
        });

        await req.logSuccess({
            case: 'card_payment_created',
            usuario_id: mongoUserId,
            valor: valor,
            payment_id: paymentData.payment_id,
            credits_to_add: credits
        });

        return response.success(res, {
            message: 'Link de pagamento por cartão criado. Redireciona o cliente para checkout_url.',
            provider: 'Visa/Mastercard via Débito Pay',
            payment: { ...paymentData, credits_to_receive: credits, payment_db_id: payment._id },
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro na rota payment/visa_mastercard:', error);
        await req.logError(error.httpStatus || 500, error.rawError || error.message, {
            case: 'card_payment',
            internal: error.internal || false
        });

        const status = error.isDebitoPayError ? (error.httpStatus || 400) : 500;
        return response.error(res, error.message, status);
    }
}));

// ===== ROTA: Gerar recibo em PDF direto do MongoDB (independente do MozHost/MySQL) =====
const PDFDocument = require('pdfkit');

router.get('/receipt/:payment_id', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { payment_id } = req.params;

        const payment = await Payment.findOne({ payment_id });

        if (!payment) {
            return response.error(res, 'Pagamento não encontrado', 404);
        }

        if (!['completed', 'approved'].includes(payment.status)) {
            return response.error(res, 'Recibo disponível apenas para pagamentos concluídos', 400);
        }

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const filename = `recibo_${payment.payment_id}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        doc.pipe(res);

        // === HEADER ===
        doc
            .fontSize(28)
            .fillColor('#1e40af')
            .text('MOZHOST', 50, 50, { align: 'center' })
            .fontSize(10)
            .fillColor('#6b7280')
            .text('Hospedagem de Bots & APIs', { align: 'center' })
            .moveDown(0.5)
            .text('mozhost.shop', { align: 'center' });

        doc.moveTo(50, 120).lineTo(545, 120).stroke('#e5e7eb');

        // === STATUS PAGO ===
        doc
            .fontSize(20)
            .fillColor('#16a34a')
            .text('✓ PAGO', 50, 140, { align: 'center' })
            .moveDown(1);

        doc
            .fontSize(16)
            .fillColor('#111827')
            .text('RECIBO DE PAGAMENTO', { align: 'center' })
            .moveDown(2);

        // === INFORMAÇÕES ===
        const startY = 220;
        const lineHeight = 25;
        const providerLabel = {
            mpesa: 'M-Pesa',
            emola: 'E-Mola',
            mkesh: 'mKesh',
            visa_mastercard: 'Visa/Mastercard',
            mercadopago: 'MercadoPago'
        };

        const info = [
            { label: 'ID da Transação:', value: `#${payment.payment_id}` },
            { label: 'Referência:', value: payment.debitopay_data?.reference || payment.mercadopago_data?.external_reference || 'N/A' },
            { label: 'Valor Pago:', value: `${payment.currency === 'MZN' ? 'MT' : 'R$'} ${parseFloat(payment.amount).toFixed(2)}` },
            { label: 'Coins Creditados:', value: `${payment.credits_to_add} coins` },
            { label: 'Método:', value: (providerLabel[payment.provider] || payment.provider).toUpperCase() },
            { label: 'Data:', value: new Date(payment.created_at).toLocaleString('pt-BR') },
            { label: 'Status:', value: 'Confirmado' }
        ];

        if (payment.phone) {
            info.splice(2, 0, { label: 'Telefone:', value: payment.phone });
        }
        if (payment.email) {
            info.splice(2, 0, { label: 'Email:', value: payment.email });
        }

        info.forEach((item, index) => {
            const y = startY + (index * lineHeight);
            doc
                .fontSize(11)
                .fillColor('#6b7280')
                .text(item.label, 80, y, { width: 150, align: 'left' })
                .fontSize(12)
                .fillColor('#111827')
                .text(item.value, 240, y, { width: 250, align: 'left' });
        });

        // === BOX ===
        const boxY = startY + (info.length * lineHeight) + 30;
        doc.rect(50, boxY, 495, 60).fillAndStroke('#f3f4f6', '#e5e7eb');
        doc
            .fontSize(10)
            .fillColor('#374151')
            .text('Créditos:', 60, boxY + 15)
            .fontSize(12)
            .fillColor('#1e40af')
            .text('Coins não expiram e podem ser usados a qualquer momento', 60, boxY + 32);

        // === RODAPÉ ===
        doc
            .fontSize(8)
            .fillColor('#9ca3af')
            .text(
                'Este documento é um comprovante válido de pagamento.\nGuarde-o para controle e referência futura.',
                50, 750, { align: 'center', width: 495 }
            );

        doc.moveTo(50, 740).lineTo(545, 740).stroke('#e5e7eb');

        doc
            .fontSize(7)
            .fillColor('#d1d5db')
            .text(
                `Gerado em: ${new Date().toLocaleString('pt-BR')} | MozHost © ${new Date().getFullYear()}`,
                50, 770, { align: 'center' }
            );

        doc.end();

    } catch (error) {
        console.error('❌ Erro ao gerar recibo:', error);
        return response.error(res, 'Erro ao gerar recibo', 500);
    }
}));

module.exports = router;
