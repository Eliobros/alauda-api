// ===== ROUTES/PAYMENT.JS =====
// Payment Integration para Alauda API
// Suporta: MercadoPago, M-Pesa, E-Mola (via PaySuite)

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

// ===== CONFIGURAÇÕES =====

// MercadoPago
const mpClient = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN || 'APP_USR-8802230897684987-041621-6921931c4f51569f86ef5f5a25196068-1779653557'
});

// PaySuite (M-Pesa e E-Mola)
const PAYSUITE_TOKEN = process.env.PAYSUITE_TOKEN || 'seu_token_aqui';
const PAYSUITE_API_URL = 'https://paysuite.tech/api/v1/payments';
const PAYSUITE_WEBHOOK_SECRET = process.env.PAYSUITE_WEBHOOK_SECRET || 'seu_webhook_secret';
const PAYSUITE_CALLBACK_URL = process.env.PAYSUITE_CALLBACK_URL || 'https://alauda-api.topazioverse.com.br/api/payment/webhook/paysuite';

// ===== FUNÇÕES MERCADOPAGO =====

async function createPaymentPreference(data) {
    try {
        const { email, amount, description, usuario_id, back_urls, notification_url } = data;

        const preference = new Preference(mpClient);

        const preferenceData = {
            body: {
                items: [
                    {
                        title: description || `Compra de ${amount} TPV`,
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

// ===== FUNÇÕES PAYSUITE (M-PESA E E-MOLA) =====

async function processPaySuitePayment(metodo, data) {
    try {
        const { valor, numero_celular, usuario_id } = data;

        if (!['mpesa', 'emola'].includes(metodo)) {
            throw new Error('Método inválido. Use "mpesa" ou "emola"');
        }

        const reference = `REF${Date.now()}`.substring(0, 50);

        const payload = {
            amount: parseFloat(valor),
            method: metodo,
            reference: reference,
            description: `Pagamento via ${metodo.toUpperCase()} - usuário ${usuario_id}`,
            callback_url: PAYSUITE_CALLBACK_URL
        };

        console.log(`📤 Enviando requisição para PaySuite (${metodo.toUpperCase()}):`, payload);

        const fetchResponse = await fetch(PAYSUITE_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PAYSUITE_TOKEN}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const responseData = await fetchResponse.json();
        console.log('📥 Resposta PaySuite:', responseData);

        if (responseData.status !== 'success') {
            throw new Error(responseData.message || 'Erro ao processar pagamento');
        }

        return {
            success: true,
            metodo: metodo.toUpperCase(),
            valor: valor,
            numero_celular: numero_celular,
            usuario_id: usuario_id,
            payment_id: responseData.data.id,
            reference: responseData.data.reference,
            status: responseData.data.status,
            checkout_url: responseData.data.checkout_url,
            created_at: new Date().toISOString()
        };

    } catch (error) {
        console.error(`❌ Erro ao processar ${metodo.toUpperCase()}:`, error.message);
        throw new Error(`Erro ${metodo.toUpperCase()}: ${error.message}`);
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
                gateway: 'PaySuite'
            },
            {
                name: 'E-Mola',
                methods: ['Mobile Money'],
                region: 'Moçambique (Movitel)',
                gateway: 'PaySuite'
            }
        ],
        features: [
            'Pagamentos via MercadoPago (PIX, Cartão, Boleto)',
            'Pagamentos via M-Pesa (Vodacom)',
            'Pagamentos via E-Mola (Movitel)',
            'Webhook para notificações',
            'Consulta de status',
            'Auto-creditação de créditos'
        ],
        cost: 'Não consome créditos da API',
        usage: {
            mercadopago: {
                method: 'POST',
                endpoint: '/api/payment/mercadopago',
                body: {
                    email: 'cliente@email.com',
                    amount: 50.00,
                    description: 'Compra de créditos',
                    usuario_id: '123'
                }
            },
            mpesa: {
                method: 'POST',
                endpoint: '/api/payment/mpesa',
                body: {
                    valor: '100.00',
                    numero_celular: '841234567',
                    usuario_id: '123'
                }
            },
            emola: {
                method: 'POST',
                endpoint: '/api/payment/emola',
                body: {
                    valor: '100.00',
                    numero_celular: '861234567',
                    usuario_id: '123'
                }
            }
        }
    });
});

// ===== ROTAS MERCADOPAGO =====

router.post('/mercadopago', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { email, amount, description, usuario_id, back_urls, notification_url } = req.body;

        if (!email) {
            return response.validationError(res, [
                { field: 'email', message: 'Email é obrigatório' }
            ]);
        }
        if (!amount || amount < 5) {
            return response.validationError(res, [
                { field: 'amount', message: 'Valor mínimo é R$ 5,00' }
            ]);
        }
        if (!usuario_id) {
            return response.validationError(res, [
                { field: 'usuario_id', message: 'ID do usuário é obrigatório' }
            ]);
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return response.validationError(res, [
                { field: 'email', message: 'Email inválido' }
            ]);
        }

        const userDoc = await User.findOne({
            $or: [
                { email: usuario_id.toLowerCase().trim() },
                { username: usuario_id.toLowerCase().trim() }
            ]
        });

        if (!userDoc) {
            return response.validationError(res, [
                {
                    field: 'usuario_id',
                    message: 'Usuário não encontrado. Use seu email ou username cadastrado.'
                }
            ]);
        }

        const mongoUserId = userDoc._id.toString();

        const paymentData = await createPaymentPreference({
            email,
            amount,
            description,
            usuario_id: mongoUserId,
            back_urls,
            notification_url
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
            payment: {
                ...paymentData,
                credits_to_receive: credits,
                payment_db_id: payment._id
            },
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro na rota payment/mercadopago:', error);
        await req.logError(500, error.message, { case: 'mercadopago_payment' });
        return response.error(res, error.message, 500);
    }
}));

// ===== ROTAS M-PESA =====

router.post('/mpesa', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { valor, numero_celular, usuario_id } = req.body;

        if (!valor || parseFloat(valor) < 1) {
            return response.validationError(res, [
                { field: 'valor', message: 'Valor mínimo é 1.00 MZN' }
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

        const userDoc = await User.findOne({
            $or: [
                { email: usuario_id.toLowerCase().trim() },
                { username: usuario_id.toLowerCase().trim() }
            ]
        });

        if (!userDoc) {
            return response.validationError(res, [
                {
                    field: 'usuario_id',
                    message: 'Usuário não encontrado. Use seu email ou username cadastrado.'
                }
            ]);
        }

        const mongoUserId = userDoc._id.toString();

        const paymentData = await processPaySuitePayment('mpesa', {
            valor,
            numero_celular,
            usuario_id: mongoUserId
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
            paysuite_data: {
                payment_id: paymentData.payment_id,
                reference: paymentData.reference,
                status: paymentData.status,
                checkout_url: paymentData.checkout_url
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
            message: 'Pagamento M-Pesa processado com sucesso',
            provider: 'M-Pesa (Vodacom) via PaySuite',
            payment: {
                ...paymentData,
                credits_to_receive: credits,
                payment_db_id: payment._id
            },
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro na rota payment/mpesa:', error);
        await req.logError(500, error.message, { case: 'mpesa_payment' });
        return response.error(res, error.message, 500);
    }
}));

// ===== ROTAS E-MOLA =====

router.post('/emola', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { valor, numero_celular, usuario_id } = req.body;

        if (!valor || parseFloat(valor) < 1) {
            return response.validationError(res, [
                { field: 'valor', message: 'Valor mínimo é 1.00 MZN' }
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

        const userDoc = await User.findOne({
            $or: [
                { email: usuario_id.toLowerCase().trim() },
                { username: usuario_id.toLowerCase().trim() }
            ]
        });

        if (!userDoc) {
            return response.validationError(res, [
                {
                    field: 'usuario_id',
                    message: 'Usuário não encontrado. Use seu email ou username cadastrado.'
                }
            ]);
        }

        const mongoUserId = userDoc._id.toString();

        const paymentData = await processPaySuitePayment('emola', {
            valor,
            numero_celular,
            usuario_id: mongoUserId
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
            paysuite_data: {
                payment_id: paymentData.payment_id,
                reference: paymentData.reference,
                status: paymentData.status,
                checkout_url: paymentData.checkout_url
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
            message: 'Pagamento E-Mola processado com sucesso',
            provider: 'E-Mola (Movitel) via PaySuite',
            payment: {
                ...paymentData,
                credits_to_receive: credits,
                payment_db_id: payment._id
            },
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro na rota payment/emola:', error);
        await req.logError(500, error.message, { case: 'emola_payment' });
        return response.error(res, error.message, 500);
    }
}));

// ===== ROTAS DE CONSULTA =====

router.get('/mercadopago/status/:payment_id', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { payment_id } = req.params;

        if (!payment_id) {
            return response.validationError(res, [
                { field: 'payment_id', message: 'ID do pagamento é obrigatório' }
            ]);
        }

        const paymentStatus = await getPaymentStatus(payment_id);

        await req.logSuccess({
            case: 'mercadopago_status_checked',
            payment_id: payment_id,
            status: paymentStatus.status
        });

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

// Consulta status de pagamento PaySuite
router.get('/paysuite/status/:payment_id', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { payment_id } = req.params;

        if (!payment_id) {
            return response.validationError(res, [
                { field: 'payment_id', message: 'ID do pagamento é obrigatório' }
            ]);
        }

        const fetchResponse = await fetch(`${PAYSUITE_API_URL}/${payment_id}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${PAYSUITE_TOKEN}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });

        const responseData = await fetchResponse.json();

        if (responseData.status !== 'success') {
            return response.error(res, responseData.message || 'Pagamento não encontrado', 404);
        }

        await req.logSuccess({
            case: 'paysuite_status_checked',
            payment_id: payment_id,
            status: responseData.data?.status
        });

        return response.success(res, {
            provider: 'PaySuite',
            payment: responseData.data,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro na rota payment/paysuite/status:', error);
        await req.logError(500, error.message, { case: 'paysuite_status' });
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

router.post('/webhook/paysuite', response.asyncHandler(async (req, res) => {
    try {
        // Valida assinatura do webhook
        const signature = req.headers['x-webhook-signature'];
        
	const payload = req.rawBody || JSON.stringify(req.body);
        const calculatedSig = crypto
            .createHmac('sha256', PAYSUITE_WEBHOOK_SECRET)
            .update(payload)
            .digest('hex');

        if (!signature || !crypto.timingSafeEqual(
            Buffer.from(signature, 'hex'),
            Buffer.from(calculatedSig, 'hex')
        )) {
            console.warn('⚠️ Assinatura inválida no webhook PaySuite');
            return res.status(401).json({ error: 'Assinatura inválida' });
        }

        console.log('📩 Webhook PaySuite recebido:', req.body);

        const result = await paymentProcessor.processPaySuiteWebhook(req.body);

        if (result.success) {
            console.log('✅ Webhook PaySuite processado:', result.message);
        } else {
            console.log('⚠️  Webhook PaySuite não processado:', result.message);
        }

        return res.status(200).json({ received: true, ...result });

    } catch (error) {
        console.error('❌ Erro no webhook PaySuite:', error);
        return res.status(500).json({ error: error.message });
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
        const { status, limit = 20, page = 1 } = req.query;

        const payments = await Payment.findByUser(
            req.apiKeyData.userId,
            {
                status,
                limit: parseInt(limit),
                skip: (parseInt(page) - 1) * parseInt(limit)
            }
        );

        const stats = await Payment.getStats(req.apiKeyData.userId);

        return response.success(res, {
            payments,
            stats,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: payments.length
            }
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

module.exports = router;
