// ===== ROUTES/PAYMENT/MERCADOPAGO.JS =====
// Rotas do MercadoPago (PIX, Cartão, Boleto) + rotas legado de compatibilidade.

const express = require('express');
const router = express.Router();

const authenticateApiKey = require('../../middleware/auth');
const response = require('../../utils/responseHandler');
const Payment = require('../../models/Payment');
const paymentProcessor = require('../../utils/paymentProcessor');
const { createPaymentPreference, getPaymentStatus } = require('../../services/mercadopagoService');

// ===== ROTA MERCADOPAGO =====

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

// ===== ROTA STATUS MERCADOPAGO =====

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

// ===== ROTAS LEGADO (manter compatibilidade) =====
// IMPORTANTE: usam router.handle() no próprio router — precisam continuar
// no mesmo arquivo das rotas /mercadopago para o redirecionamento interno funcionar.
// Nota: com Express 5 (router@2.x), router.handle() exige um callback — passamos
// o `next` para que, se a rota interna não casar, o fluxo siga para o 404.

router.post('/create', authenticateApiKey, response.asyncHandler(async (req, res, next) => {
    req.url = '/mercadopago';
    return router.handle(req, res, next);
}));

router.get('/status/:payment_id', authenticateApiKey, response.asyncHandler(async (req, res, next) => {
    req.url = `/mercadopago/status/${req.params.payment_id}`;
    return router.handle(req, res, next);
}));

module.exports = router;
