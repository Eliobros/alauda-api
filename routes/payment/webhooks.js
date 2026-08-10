// ===== ROUTES/PAYMENT/WEBHOOKS.JS =====
// Webhooks de confirmação de pagamento (MercadoPago e Débito Pay).

const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const response = require('../../utils/responseHandler');
const Payment = require('../../models/Payment');
const paymentProcessor = require('../../utils/paymentProcessor');
const { DEBITOPAY_WEBHOOK_SECRET } = require('../../services/debitopayService');

// ===== WEBHOOK MERCADOPAGO =====

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

// ===== WEBHOOK DÉBITO PAY =====

// Webhook Débito Pay — confirma pagamento e credita as coins do usuário.
// IMPORTANTE: confirma com a doc/suporte da Débito Pay qual header eles usam
// para assinar o payload (abaixo assume 'x-debitopay-signature', ajusta se for diferente).
// Formato real documentado:
// { "event": "payment.completed", "data": { "payment_id", "merchant_id", "wallet_code",
//   "amount", "currency", "method", "reference", "paid_at" }, "timestamp": "..." }
// Header: X-Webhook-Signature (HMAC-SHA256 do raw body, SEM prefixo "sha256=")
// Best practices exigidas pela Débito Pay: responder 200 em <5s, validar assinatura sempre,
// tratar cada payment_id de forma idempotente (evento pode chegar mais de uma vez).
router.post('/webhook/debitopay', response.asyncHandler(async (req, res) => {
    try {
        const secretLimpo = (DEBITOPAY_WEBHOOK_SECRET || '').trim();

        const rawSignature = req.headers['x-webhook-signature'] || '';
        const signature = (rawSignature.startsWith('sha256=') ? rawSignature.slice(7) : rawSignature).trim();

        const payload = Buffer.isBuffer(req.rawBody)
            ? req.rawBody.toString('utf8')
            : (req.rawBody || '');

        const timestamp = req.headers['x-debitopay-timestamp'] || '';

        if (!signature) {
            console.warn('⚠️ Webhook Débito Pay sem header de assinatura — rejeitado.');
            return res.status(401).json({ error: 'Assinatura ausente' });
        }

        // FÓRMULA CONFIRMADA: HMAC-SHA256(secret_com_prefixo_whsec, timestamp + "." + rawBody)
        const calculatedSig = crypto
            .createHmac('sha256', secretLimpo)
            .update(`${timestamp}.${payload}`)
            .digest('hex');

        const assinaturaValida = signature === calculatedSig;

        if (!assinaturaValida) {
            console.warn(`⚠️ Assinatura inválida no webhook Débito Pay (sig_len=${signature.length}, ts=${timestamp})`);
            return res.status(401).json({ error: 'Assinatura inválida' });
        }

        // Responde 200 imediatamente após validar a assinatura; processa em seguida.
        res.status(200).json({ received: true });

        const { event, data } = req.body || {};

        // Débito Pay manda o id no TOPO do body E dentro de `data` — não existe
        // `data.payment_id`. Aceita qualquer um dos três formatos.
        const paymentId = data?.payment_id || data?.id || req.body?.id;

        if (!paymentId) {
            console.warn('⚠️ Webhook Débito Pay sem id em lugar nenhum, ignorando:', req.body);
            return;
        }

        console.log(`📩 Webhook Débito Pay [${event || data?.status || 'sem event'}]:`, data);

        const payment = await Payment.findOne({
            'debitopay_data.payment_id': paymentId
        });

        if (!payment) {
            console.warn(`⚠️ Pagamento não encontrado para payment_id: ${paymentId}`);
            return;
        }

        // Idempotência: se já processamos esse payment_id com sucesso, não credita de novo.
        if (event === 'payment.completed' || data?.status === 'completed') {
            if (payment.status === 'completed') {
                console.log(`ℹ️ Pagamento ${paymentId} já estava completed, ignorando evento duplicado.`);
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
            if (data?.reference) payment.debitopay_data.reference = data.reference;
            if (data?.provider_reference) payment.debitopay_data.provider_reference = data.provider_reference;
            if (data?.paid_at) payment.debitopay_data.paid_at = data.paid_at;
            await payment.save();

            console.log(`✅ Pagamento Débito Pay confirmado: ${data?.amount ?? payment.amount} ${data?.currency || payment.currency}`);

        } else if (event === 'payment.failed' || data?.status === 'failed') {
            if (payment.status !== 'failed') {
                payment.status = 'failed';
                await payment.save();
                console.log(`❌ Pagamento Débito Pay falhou: ${paymentId}`);
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
                        coins: -payment.credits_to_add
                    })
                });

                payment.status = 'refunded';
                await payment.save();
                console.log(`↩️ Pagamento Débito Pay reembolsado, coins removidos: ${paymentId}`);
            }

        } else if (event === 'payment.chargeback') {
            payment.status = 'chargeback';
            await payment.save();
            console.warn(`🚨 CHARGEBACK recebido para pagamento ${paymentId} — revisar manualmente.`);
        } else {
            console.log(`ℹ️ Evento Débito Pay não tratado: ${event || 'sem event'} (status=${data?.status})`);
        }

    } catch (error) {
        console.error('❌ Erro no webhook Débito Pay:', error);
        if (!res.headersSent) {
            return res.status(500).json({ error: 'Erro interno no webhook' });
        }
    }
}));

module.exports = router;
