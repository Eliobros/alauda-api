// ===== ROUTES/PAYMENT/MOBILE-MONEY.JS =====
// Rotas de pagamento via Débito Pay: M-Pesa, E-Mola, mKesh e Visa/Mastercard.

const express = require('express');
const router = express.Router();

const authenticateApiKey = require('../../middleware/auth');
const response = require('../../utils/responseHandler');
const Payment = require('../../models/Payment');
const paymentProcessor = require('../../utils/paymentProcessor');
const { processDebitoPayPayment } = require('../../services/debitopayService');

// ===== FÁBRICA DE ROTAS MOBILE MONEY =====
// mpesa, emola e mkesh seguem o mesmo fluxo — mudam apenas o regex do telefone,
// as mensagens e os nomes de log. Para adicionar um novo método, basta criar
// uma entrada aqui (e uma carteira em services/debitopayService.js).
const METODOS_MOBILE_MONEY = {
    mpesa: {
        phoneRegex: /^(84|85)\d{7}$/,
        phoneErrorMessage: 'Número M-Pesa inválido. Use formato: 84xxxxxxx ou 85xxxxxxx',
        paymentIdFallback: 'mpesa',
        providerLabel: 'M-Pesa (Vodacom) via Débito Pay',
        successMessage: 'Pedido M-Pesa enviado! Confirma o PIN no teu telemóvel.',
        logCaseSuccess: 'mpesa_payment_created',
        logCaseError: 'mpesa_payment'
    },
    emola: {
        phoneRegex: /^(86|87)\d{7}$/,
        phoneErrorMessage: 'Número E-Mola inválido. Use formato: 86xxxxxxx ou 87xxxxxxx',
        paymentIdFallback: 'emola',
        providerLabel: 'E-Mola (Movitel) via Débito Pay',
        successMessage: 'Pedido E-Mola enviado! Confirma o PIN no teu telemóvel.',
        logCaseSuccess: 'emola_payment_created',
        logCaseError: 'emola_payment'
    },
    mkesh: {
        phoneRegex: null, // mKesh não valida formato de telefone
        phoneErrorMessage: null,
        paymentIdFallback: 'mkesh',
        providerLabel: 'mKesh via Débito Pay',
        successMessage: 'Pedido mKesh enviado! Confirma o PIN no teu telemóvel.',
        logCaseSuccess: 'mkesh_payment_created',
        logCaseError: 'mkesh_payment'
    }
};

function criarRotaMobileMoney(metodo, config) {
    router.post(`/${metodo}`, authenticateApiKey, response.asyncHandler(async (req, res) => {
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

            if (config.phoneRegex && !config.phoneRegex.test(numero_celular)) {
                return response.validationError(res, [
                    { field: 'numero_celular', message: config.phoneErrorMessage }
                ]);
            }

            const mongoUserId = usuario_id.toString().trim();

            const paymentData = await processDebitoPayPayment(metodo, {
                valor, numero_celular, usuario_id: mongoUserId
            });

            const credits = paymentProcessor.calculateCredits(valor, 'MZN');

            const payment = await Payment.createPayment({
                payment_id: paymentData.payment_id || `${config.paymentIdFallback}_${Date.now()}`,
                provider: metodo,
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
                case: config.logCaseSuccess,
                usuario_id: mongoUserId,
                valor: valor,
                payment_id: paymentData.payment_id,
                credits_to_add: credits
            });

            return response.success(res, {
                message: config.successMessage,
                provider: config.providerLabel,
                payment: { ...paymentData, credits_to_receive: credits, payment_db_id: payment._id },
                credits_remaining: req.apiKeyData.credits
            });

        } catch (error) {
            console.error(`❌ Erro na rota payment/${metodo}:`, error);
            await req.logError(error.httpStatus || 500, error.rawError || error.message, {
                case: config.logCaseError,
                internal: error.internal || false
            });

            const status = error.isDebitoPayError ? (error.httpStatus || 400) : 500;
            return response.error(res, error.message, status);
        }
    }));
}

Object.entries(METODOS_MOBILE_MONEY).forEach(([metodo, config]) => criarRotaMobileMoney(metodo, config));

// ===== ROTA VISA/MASTERCARD =====

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

// ===== CONSULTA DE STATUS DÉBITO PAY =====

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

module.exports = router;
