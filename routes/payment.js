// ===== ROUTES/PAYMENT.JS =====
// Payment Integration para Alauda API
// Suporta: MercadoPago, M-Pesa, E-Mola

const express = require('express');
const router = express.Router();
const { MercadoPagoConfig, Preference, Payment: MPPayment } = require('mercadopago');
const authenticateApiKey = require('../middleware/auth');
const response = require('../utils/responseHandler');
const constants = require('../config/constants');
const Payment = require('../models/Payment');
const paymentProcessor = require('../utils/paymentProcessor');

// ===== CONFIGURAÇÕES =====

// MercadoPago
const mpClient = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN || 'APP_USR-8802230897684987-041621-6921931c4f51569f86ef5f5a25196068-1779653557'
});

// PayMoz (M-Pesa e E-Mola)
const PAYMOZ_API_KEY = process.env.PAYMOZ_API_KEY || 'sua_api_key_aqui';
const PAYMOZ_API_URL = 'https://paymoz.tech/api/v1/pagamentos/processar/';

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

// ===== FUNÇÕES PAYMOZ (M-PESA E E-MOLA) =====

async function processPayMozPayment(metodo, data) {
    try {
        const { valor, numero_celular, usuario_id } = data;

        // Verifica método válido
        if (!['mpesa', 'emola'].includes(metodo)) {
            throw new Error('Método inválido. Use "mpesa" ou "emola"');
        }

        const payload = {
            metodo: metodo,
            valor: parseFloat(valor).toFixed(2),
            numero_celular: numero_celular
        };

        console.log(`📤 Enviando requisição para PayMoz (${metodo.toUpperCase()}):`, payload);

        const fetchResponse = await fetch(PAYMOZ_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `ApiKey ${PAYMOZ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        // Verifica se a resposta é JSON
        const contentType = fetchResponse.headers.get('content-type');
        let responseData;

        if (contentType && contentType.includes('application/json')) {
            responseData = await fetchResponse.json();
        } else {
            const text = await fetchResponse.text();
            console.error('⚠️ EMOLA retornou algo inesperado (não JSON):', text);
            throw new Error('Erro EMOLA: a resposta não é JSON. Verifique URL, token ou API.');
        }

        console.log('📥 Resposta PayMoz:', responseData);

        // Verifica se a API indicou sucesso
        if (!responseData.sucesso) {
            throw new Error(responseData.mensagem || 'Erro ao processar pagamento');
        }

        // Retorna dados processados
        return {
            success: true,
            metodo: metodo.toUpperCase(),
            valor: valor,
            numero_celular: numero_celular,
            usuario_id: usuario_id,
            transaction_id: responseData.dados?.output_TransactionID,
            conversation_id: responseData.dados?.output_ConversationID,
            third_party_reference: responseData.dados?.output_ThirdPartyReference,
            response_code: responseData.dados?.output_ResponseCode,
            response_desc: responseData.dados?.output_ResponseDesc,
            mensagem: responseData.mensagem,
            created_at: new Date().toISOString()
        };

    } catch (error) {
        console.error(`❌ Erro ao processar ${metodo.toUpperCase()}:`, error.message);
        throw new Error(`Erro ${metodo.toUpperCase()}: ${error.message}`);
    }
}


/*
async function processPayMozPayment(metodo, data) {
    try {
        const { valor, numero_celular, usuario_id } = data;

        if (!['mpesa', 'emola'].includes(metodo)) {
            throw new Error('Método inválido. Use "mpesa" ou "emola"');
        }

        const payload = {
            metodo: metodo,
            valor: parseFloat(valor).toFixed(2),
            numero_celular: numero_celular
        };

        console.log(`📤 Enviando requisição para PayMoz (${metodo.toUpperCase()}):`, payload);

        const fetchResponse = await fetch(PAYMOZ_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `ApiKey ${PAYMOZ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const responseData = await fetchResponse.json();

        console.log('📥 Resposta PayMoz:', responseData);

        if (!responseData.sucesso) {
            throw new Error(responseData.mensagem || 'Erro ao processar pagamento');
        }

        return {
            success: true,
            metodo: metodo.toUpperCase(),
            valor: valor,
            numero_celular: numero_celular,
            usuario_id: usuario_id,
            transaction_id: responseData.dados?.output_TransactionID,
            conversation_id: responseData.dados?.output_ConversationID,
            third_party_reference: responseData.dados?.output_ThirdPartyReference,
            response_code: responseData.dados?.output_ResponseCode,
            response_desc: responseData.dados?.output_ResponseDesc,
            mensagem: responseData.mensagem,
            created_at: new Date().toISOString()
        };

    } catch (error) {
        console.error(`❌ Erro ao processar ${metodo.toUpperCase()}:`, error.message);
        throw new Error(`Erro ${metodo.toUpperCase()}: ${error.message}`);
    }
}
*/
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
                region: 'Moçambique (Vodacom)'
            },
            {
                name: 'E-Mola',
                methods: ['Mobile Money'],
                region: 'Moçambique (Movitel)'
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

        const paymentData = await createPaymentPreference({
            email,
            amount,
            description,
            usuario_id,
            back_urls,
            notification_url
        });

        const credits = paymentProcessor.calculateCredits(amount, 'BRL');

        const payment = await Payment.createPayment({
            payment_id: paymentData.id,
            provider: 'mercadopago',
            userId: usuario_id,
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
            usuario_id: usuario_id,
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

        const paymentData = await processPayMozPayment('mpesa', {
            valor,
            numero_celular,
            usuario_id
        });

        const credits = paymentProcessor.calculateCredits(valor, 'MZN');

        const payment = await Payment.createPayment({
            payment_id: paymentData.transaction_id || `mpesa_${Date.now()}`,
            provider: 'mpesa',
            userId: usuario_id,
            apiKey: req.apiKeyData.key,
            phone: numero_celular,
            amount: valor,
            currency: 'MZN',
            credits_to_add: credits,
            ip_address: req.clientIP,
            user_agent: req.userAgent,
            paymoz_data: {
                transaction_id: paymentData.transaction_id,
                conversation_id: paymentData.conversation_id,
                third_party_reference: paymentData.third_party_reference,
                response_code: paymentData.response_code,
                response_desc: paymentData.response_desc,
                numero_celular: numero_celular
            }
        });

        await req.logSuccess({
            case: 'mpesa_payment_created',
            usuario_id: usuario_id,
            valor: valor,
            transaction_id: paymentData.transaction_id,
            credits_to_add: credits
        });

        return response.success(res, {
            message: 'Pagamento M-Pesa processado com sucesso',
            provider: 'M-Pesa (Vodacom)',
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

        const paymentData = await processPayMozPayment('emola', {
            valor,
            numero_celular,
            usuario_id
        });

        const credits = paymentProcessor.calculateCredits(valor, 'MZN');

        const payment = await Payment.createPayment({
            payment_id: paymentData.transaction_id || `emola_${Date.now()}`,
            provider: 'emola',
            userId: usuario_id,
            apiKey: req.apiKeyData.key,
            phone: numero_celular,
            amount: valor,
            currency: 'MZN',
            credits_to_add: credits,
            ip_address: req.clientIP,
            user_agent: req.userAgent,
            paymoz_data: {
                transaction_id: paymentData.transaction_id,
                conversation_id: paymentData.conversation_id,
                third_party_reference: paymentData.third_party_reference,
                response_code: paymentData.response_code,
                response_desc: paymentData.response_desc,
                numero_celular: numero_celular
            }
        });

        await req.logSuccess({
            case: 'emola_payment_created',
            usuario_id: usuario_id,
            valor: valor,
            transaction_id: paymentData.transaction_id,
            credits_to_add: credits
        });

        return response.success(res, {
            message: 'Pagamento E-Mola processado com sucesso',
            provider: 'E-Mola (Movitel)',
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

router.post('/webhook/paymoz', response.asyncHandler(async (req, res) => {
    try {
        console.log('📩 Webhook PayMoz recebido:', req.body);

        const result = await paymentProcessor.processPayMozWebhook(req.body);

        if (result.success) {
            console.log('✅ Webhook processado:', result.message);
        } else {
            console.log('⚠️  Webhook não processado:', result.message);
        }

        return res.status(200).json({ received: true, ...result });

    } catch (error) {
        console.error('❌ Erro no webhook PayMoz:', error);
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
