// ===== ROUTES/PAYMENT/WEBHOOKS.JS =====
// Webhooks de confirmação de pagamento (MercadoPago e Zumbo Pay).

const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const response = require('../../utils/responseHandler');
const Payment = require('../../models/Payment');
const paymentProcessor = require('../../utils/paymentProcessor');
const {
    ZUMBOPAY_WEBHOOK_SECRET
} = require('../../services/zumbopayService');

// ============================================================
// WEBHOOK MERCADOPAGO
// ============================================================

router.post(
    '/webhook/mercadopago',
    response.asyncHandler(async (req, res) => {
        try {
            console.log('📩 Webhook MercadoPago recebido:', req.body);

            const result =
                await paymentProcessor.processMercadoPagoWebhook(req.body);

            if (result.success) {
                console.log('✅ Webhook processado:', result.message);
            } else {
                console.log('⚠️ Webhook não processado:', result.message);
            }

            return res.status(200).json({
                received: true,
                ...result
            });

        } catch (error) {
            console.error(
                '❌ Erro no webhook MercadoPago:',
                error
            );

            return res.status(500).json({
                error: error.message
            });
        }
    })
);


// ============================================================
// WEBHOOK ZUMBO PAY
// ============================================================
//
// Header esperado:
//
// X-Zumbo-Signature: <HMAC-SHA256>
//
// Assinatura:
//
// HMAC-SHA256(webhook_secret, raw_body)
//
// Eventos suportados:
//
// payment.succeeded
// payment.failed
// payment.refunded
// payout.completed
// payout.failed
// subscription.charged
//
// ============================================================

router.post(
    '/webhook/zumbopay',
    response.asyncHandler(async (req, res) => {

        try {

            // ====================================================
            // 1. SECRET
            // ====================================================

            const secret = (
                ZUMBOPAY_WEBHOOK_SECRET || ''
            ).trim();

            if (!secret) {

                console.error(
                    '❌ ZUMBOPAY_WEBHOOK_SECRET não configurado.'
                );

                return res.status(500).json({
                    error: 'Webhook secret não configurado'
                });
            }


            // ====================================================
            // 2. ASSINATURA RECEBIDA
            // ====================================================

            // IMPORTANTE:
            // A ZumboPay envia:
            //
            // X-Zumbo-Signature
            //
            // Express transforma automaticamente os headers
            // para lowercase.

            const rawSignature =
                req.headers['x-zumbopay-signature'] || '';

            const signature =
                String(rawSignature).trim();


            if (!signature) {

                console.warn(
                    '⚠️ Webhook Zumbo Pay sem assinatura.'
                );

                return res.status(401).json({
                    error: 'Assinatura ausente'
                });
            }


            // ====================================================
            // 3. RAW BODY
            // ====================================================

            let payload;

            if (Buffer.isBuffer(req.rawBody)) {

                payload = req.rawBody;

            } else if (typeof req.rawBody === 'string') {

                payload = Buffer.from(
                    req.rawBody,
                    'utf8'
                );

            } else {

                // Fallback.
                //
                // Idealmente req.rawBody deve existir.
                // A assinatura oficial deve ser calculada
                // sobre o body original recebido.

                payload = Buffer.from(
                    JSON.stringify(req.body || {}),
                    'utf8'
                );
            }


            // ====================================================
            // 4. CALCULAR HMAC
            // ====================================================

            const calculatedSignature =
                crypto
                    .createHmac('sha256', secret)
                    .update(payload)
                    .digest('hex');


            // ====================================================
            // 5. VALIDAR ASSINATURA
            // ====================================================

            const receivedBuffer =
                Buffer.from(
                    signature,
                    'utf8'
                );

            const calculatedBuffer =
                Buffer.from(
                    calculatedSignature,
                    'utf8'
                );


            // timingSafeEqual exige buffers
            // com o mesmo tamanho.

            if (
                receivedBuffer.length !==
                calculatedBuffer.length
            ) {

                console.warn(
                    '⚠️ Assinatura Zumbo Pay inválida.'
                );

                return res.status(401).json({
                    error: 'Assinatura inválida'
                });
            }


            const signatureValid =
                crypto.timingSafeEqual(
                    receivedBuffer,
                    calculatedBuffer
                );


            if (!signatureValid) {

                console.warn(
                    '⚠️ Assinatura Zumbo Pay inválida.'
                );

                return res.status(401).json({
                    error: 'Assinatura inválida'
                });
            }


            console.log(
                '✅ Assinatura Zumbo Pay válida.'
            );


            // ====================================================
            // 6. LER PAYLOAD
            // ====================================================

            const body = req.body || {};

            const event =
                body.type || body.event;

            const data =
                body.data || {};


            console.log(
                `📩 Evento Zumbo Pay recebido: ${event || 'sem tipo'}`
            );

            console.log(
                '📦 Dados:',
                data
            );


            // ====================================================
            // 7. IDENTIFICAR PAYMENT ID
            // ====================================================

            const paymentId =
                data.payment_id ||
                data.id ||
                data.subscription_id;


            if (!paymentId) {

                console.warn(
                    '⚠️ Webhook Zumbo Pay sem payment_id:',
                    body
                );

                // O webhook foi recebido e a assinatura
                // é válida, portanto não é necessário
                // pedir reenvio.

                return res.status(200).json({
                    received: true,
                    processed: false,
                    message: 'payment_id ausente'
                });
            }


            // ====================================================
            // 8. ENCONTRAR PAGAMENTO
            // ====================================================

            const payment =
                await Payment.findOne({
                    $or: [
                        {
                            'zumbopay_data.payment_id':
                                paymentId
                        },
                        {
                            'zumbopay_data.reference':
                                paymentId
                        },
                        {
                            payment_id:
                                paymentId
                        }
                    ]
                });


            if (!payment) {

                console.warn(
                    `⚠️ Pagamento não encontrado: ${paymentId}`
                );

                return res.status(200).json({
                    received: true,
                    processed: false,
                    message: 'Pagamento não encontrado'
                });
            }


            // ====================================================
            // 9. VERIFICAR ORIGEM
            // ====================================================

            const isPagamentoParceiro =
                payment.provider &&
                payment.provider.startsWith(
                    'mpesa_parceiro_'
                );

            const isPayout =
                payment.provider &&
                payment.provider.startsWith(
                    'payout_'
                );

            const isOriginCreditaCoins =
                !payment.origin ||
                payment.origin === 'mozhost';

            const creditaCoins =
                !isPagamentoParceiro &&
                !isPayout &&
                isOriginCreditaCoins;


            // ====================================================
            // 10. PAYMENT SUCCEEDED
            // ====================================================

            if (
                event === 'payment.succeeded' ||
                data.status === 'succeeded'
            ) {

                // ----------------------------------------------
                // Idempotência
                // ----------------------------------------------

                if (
                    payment.status === 'completed'
                ) {

                    console.log(
                        `ℹ️ Pagamento ${paymentId} já está completed.`
                    );

                    return res.status(200).json({
                        received: true,
                        processed: true,
                        duplicate: true
                    });
                }


                // ----------------------------------------------
                // Creditar coins
                // ----------------------------------------------

                if (creditaCoins) {

                    try {

                        const creditResponse =
                            await fetch(
                                `${process.env.MOZHOST_API_URL}/api/payment/internal/credit-coins`,
                                {
                                    method: 'POST',

                                    headers: {
                                        'x-internal-key':
                                            process.env.INTERNAL_SECRET_KEY,

                                        'Content-Type':
                                            'application/json'
                                    },

                                    body: JSON.stringify({
                                        userId:
                                            payment.userId,

                                        coins:
                                            payment.credits_to_add,

                                        externalPaymentId:
                                            payment.payment_id
                                    })
                                }
                            );


                        if (!creditResponse.ok) {

                            const errorText =
                                await creditResponse.text();

                            console.error(
                                '❌ Erro ao creditar coins:',
                                errorText
                            );

                            throw new Error(
                                'Falha ao creditar coins'
                            );
                        }


                        console.log(
                            `🪙 ${payment.credits_to_add} coins creditadas para ${payment.userId}`
                        );

                    } catch (creditError) {

                        console.error(
                            '❌ Erro no crédito de coins:',
                            creditError
                        );

                        // Não marcar como completed se o
                        // crédito falhou.

                        throw creditError;
                    }

                } else {

                    console.log(
                        `ℹ️ Pagamento ${paymentId} confirmado sem crédito de coins. ` +
                        `origin=${payment.origin || 'mozhost'}, ` +
                        `provider=${payment.provider}`
                    );
                }


                // ----------------------------------------------
                // Atualizar pagamento
                // ----------------------------------------------

                payment.status =
                    'completed';


                if (data.reference) {

                    payment.zumbopay_data =
                        payment.zumbopay_data || {};

                    payment.zumbopay_data.reference =
                        data.reference;
                }


                if (data.provider_reference) {

                    payment.zumbopay_data =
                        payment.zumbopay_data || {};

                    payment.zumbopay_data.provider_reference =
                        data.provider_reference;
                }


                if (data.paid_at) {

                    payment.zumbopay_data =
                        payment.zumbopay_data || {};

                    payment.zumbopay_data.paid_at =
                        data.paid_at;
                }


                // Guardar event ID se o seu schema
                // permitir este campo.

                if (body.id) {

                    payment.zumbopay_data =
                        payment.zumbopay_data || {};

                    payment.zumbopay_data.event_id =
                        body.id;
                }


                await payment.save();


                console.log(
                    `✅ Pagamento Zumbo Pay confirmado: ` +
                    `${paymentId} - ` +
                    `${data.amount ?? payment.amount} ` +
                    `${data.currency || payment.currency}`
                );


                return res.status(200).json({
                    received: true,
                    processed: true,
                    status: 'completed'
                });
            }


            // ====================================================
            // 11. PAYMENT FAILED
            // ====================================================

            if (
                event === 'payment.failed' ||
                data.status === 'failed'
            ) {

                if (
                    payment.status !== 'failed'
                ) {

                    payment.status =
                        'failed';

                    await payment.save();

                    console.log(
                        `❌ Pagamento Zumbo Pay falhou: ${paymentId}`
                    );
                }


                return res.status(200).json({
                    received: true,
                    processed: true,
                    status: 'failed'
                });
            }


            // ====================================================
            // 12. PAYMENT REFUNDED
            // ====================================================

            if (
                event === 'payment.refunded'
            ) {

                if (
                    payment.status === 'completed' &&
                    creditaCoins
                ) {

                    const refundResponse =
                        await fetch(
                            `${process.env.MOZHOST_API_URL}/api/payment/internal/credit-coins`,
                            {
                                method: 'POST',

                                headers: {
                                    'x-internal-key':
                                        process.env.INTERNAL_SECRET_KEY,

                                    'Content-Type':
                                        'application/json'
                                },

                                body: JSON.stringify({
                                    userId:
                                        payment.userId,

                                    coins:
                                        -payment.credits_to_add,

                                    externalPaymentId:
                                        payment.payment_id
                                })
                            }
                        );


                    if (!refundResponse.ok) {

                        throw new Error(
                            'Falha ao remover coins do reembolso'
                        );
                    }


                    payment.status =
                        'refunded';

                    await payment.save();


                    console.log(
                        `↩️ Reembolso processado: ${paymentId}`
                    );

                } else if (
                    payment.status === 'completed'
                ) {

                    payment.status =
                        'refunded';

                    await payment.save();


                    console.log(
                        `↩️ Pagamento reembolsado sem remoção de coins: ${paymentId}`
                    );
                }


                return res.status(200).json({
                    received: true,
                    processed: true,
                    status: 'refunded'
                });
            }


            // ====================================================
            // 13. PAYOUT
            // ====================================================

            if (
                event === 'payout.completed' ||
                event === 'payout.failed'
            ) {

                const newStatus =
                    event === 'payout.completed'
                        ? 'completed'
                        : 'failed';


                if (
                    payment.status !==
                    newStatus
                ) {

                    payment.status =
                        newStatus;


                    if (
                        data.provider_reference
                    ) {

                        payment.zumbopay_data =
                            payment.zumbopay_data || {};

                        payment.zumbopay_data.provider_reference =
                            data.provider_reference;
                    }


                    await payment.save();


                    console.log(
                        `💰 Payout Zumbo Pay ${newStatus}: ${paymentId}`
                    );
                }


                return res.status(200).json({
                    received: true,
                    processed: true,
                    status: newStatus
                });
            }


            // ====================================================
            // 14. SUBSCRIPTION
            // ====================================================

            if (
                event === 'subscription.charged'
            ) {

                console.log(
                    `🔄 Subscrição Zumbo Pay cobrada: ${paymentId}`
                );


                return res.status(200).json({
                    received: true,
                    processed: true,
                    status: 'subscription_charged'
                });
            }


            // ====================================================
            // 15. EVENTO DESCONHECIDO
            // ====================================================

            console.log(
                `ℹ️ Evento Zumbo Pay não tratado: ${event || 'sem event'} ` +
                `(status=${data.status || 'sem status'})`
            );


            return res.status(200).json({
                received: true,
                processed: false,
                message: 'Evento não tratado'
            });


        } catch (error) {

            console.error(
                '❌ Erro no webhook Zumbo Pay:',
                error
            );


            if (!res.headersSent) {

                return res.status(500).json({
                    error: 'Erro interno no webhook'
                });
            }
        }
    })
);


module.exports = router;

