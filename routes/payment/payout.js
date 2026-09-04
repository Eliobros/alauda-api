// ===== ROUTES/PAYMENT/PAYOUT.JS =====
// Payout B2C via Zumbo Pay: envia dinheiro para o telemóvel do cliente
// (usado no fluxo de depósito do EliobrosPay: PayPal capturado → M-Pesa ao cliente).

const express = require('express');
const router = express.Router();

const authenticateApiKey = require('../../middleware/auth');
const response = require('../../utils/responseHandler');
const Payment = require('../../models/Payment');
const { processZumboPayPayout, checkWalletBalance } = require('../../services/zumbopayService');

// Métodos suportados para payout
const METODOS_PAYOUT = {
    mpesa: { phoneRegex: /^(84|85)\d{7}$/, name: 'M-Pesa (Vodacom) via Zumbo Pay' },
    emola: { phoneRegex: /^(86|87)\d{7}$/, name: 'E-Mola (Movitel) via Zumbo Pay' }
};

// Segurança: payout é dinheiro a SAIR da carteira. Por padrão permite qualquer origin
// (comportamento atual), mas em produção defina ZUMBOPAY_PAYOUT_ALLOWED_ORIGINS no .env
// (separado por vírgula, ex: "eliobrospay") para restringir quem pode enviar.
const PAYOUT_ALLOWED_ORIGINS = (process.env.ZUMBOPAY_PAYOUT_ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

/**
 * POST /api/payment/zumbopay/transfer
 * Envia dinheiro (payout B2C) para um número. Body:
 *   { valor, numero_celular, usuario_id, metodo?, reference?, origin? }
 * A Zumbo Pay devolve payment_id + status (pending → success/failed),
 * confirmado pelo webhook payment.succeeded/failed.
 */
router.post('/zumbopay/transfer', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { valor, numero_celular, usuario_id, metodo = 'mpesa', reference, origin } = req.body;

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

        const config = METODOS_PAYOUT[metodo];
        if (!config) {
            return response.validationError(res, [
                { field: 'metodo', message: 'Método não suportado para payout. Use: mpesa ou emola' }
            ]);
        }

        // Normaliza o telefone (aceita 84xxxxxxx ou 25884xxxxxxx) e valida o formato local
        const localPhone = String(numero_celular).replace(/^258/, '');
        if (config.phoneRegex && !config.phoneRegex.test(localPhone)) {
            return response.validationError(res, [
                { field: 'numero_celular', message: 'Número de celular inválido (ex: 841234567)' }
            ]);
        }

        const mongoUserId = usuario_id.toString().trim();

        // Restrição opcional de origins (ver PAYOUT_ALLOWED_ORIGINS acima)
        const originFinal = (origin || 'mozhost').toLowerCase();
        if (PAYOUT_ALLOWED_ORIGINS.length > 0 && !PAYOUT_ALLOWED_ORIGINS.includes(originFinal)) {
            return response.error(res, 'Origin não autorizada para payout', 403);
        }

        // Idempotência: se o cliente já criou um payout com esta reference (ex: retry
        // após timeout), devolve o existente em vez de enviar dinheiro uma segunda vez.
        if (reference) {
            const existing = await Payment.findOne({ 'metadata.payout_reference': reference });
            if (existing) {
                await req.logSuccess({ case: 'payout_duplicate_reference', reference, payment_id: existing.zumbopay_data?.payment_id });
                return response.success(res, {
                    message: 'Payout já processado para esta reference. Reutilizando o existente.',
                    provider: config.name,
                    payout: {
                        payment_id: existing.zumbopay_data?.payment_id || existing.payment_id,
                        status: existing.status,
                        reference,
                        payout_db_id: existing._id,
                        duplicado: true
                    }
                });
            }
        }

        const payoutData = await processZumboPayPayout({
            valor,
            numero_celular: localPhone,
            usuario_id: mongoUserId,
            reference,
            metodo
        });

        // Grava o payout no banco para consulta de status e auditoria.
        const payment = await Payment.createPayment({
            payment_id: payoutData.payment_id || `payout_${Date.now()}`,
            provider: `payout_${metodo}`,
            userId: mongoUserId,
            apiKey: req.apiKeyData.key,
            phone: localPhone,
            amount: valor,
            currency: 'MZN',
            credits_to_add: 0,
            description: `Payout B2C para ${localPhone}`,
            ip_address: req.clientIP,
            user_agent: req.userAgent,
            origin: originFinal,
            metadata: { payout_reference: reference || payoutData.reference },
            zumbopay_data: {
                payment_id: payoutData.payment_id,
                reference: payoutData.reference,
                source_id: payoutData.source_id,
                status: payoutData.status,
                provider_reference: payoutData.provider_reference || reference,
                fee_amount: payoutData.fee_amount,
                net_amount: payoutData.net_amount
            }
        });

        await req.logSuccess({
            case: 'payout_created',
            usuario_id: mongoUserId,
            valor: valor,
            payment_id: payoutData.payment_id,
            reference: payoutData.reference,
            origin: originFinal
        });

        return response.success(res, {
            message: `Payout ${config.name} enviado! O cliente recebe ${valor} MZN no telemóvel.`,
            provider: config.name,
            payout: { ...payoutData, payout_db_id: payment._id }
        });

    } catch (error) {
        console.error('❌ Erro na rota payment/zumbopay/transfer:', error);
        await req.logError(error.httpStatus || 500, error.rawError || error.message, {
            case: 'payout',
            internal: error.internal || false
        });

        const status = error.isZumboPayError ? (error.httpStatus || 400) : 500;
        return response.error(res, error.message, status);
    }
}));

/**
 * GET /api/payment/zumbopay/balance
 * Consulta o saldo das wallets Zumbo Pay.
 * Usado antes de um payout para garantir que há saldo para enviar.
 */
router.get('/zumbopay/balance', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const walletId = req.query.wallet_id || null;
        const walletData = await checkWalletBalance(walletId);

        await req.logSuccess({ case: 'wallet_balance_checked', balance: walletData.balance, wallet_id: walletData.wallet_id });

        return response.success(res, {
            provider: 'Zumbo Pay',
            wallet: walletData
        });

    } catch (error) {
        console.error('❌ Erro na rota payment/zumbopay/balance:', error);
        await req.logError(error.httpStatus || 500, error.rawError || error.message, {
            case: 'wallet_balance',
            internal: error.internal || false
        });

        return response.error(res, error.message, error.httpStatus || 500);
    }
}));

module.exports = router;
