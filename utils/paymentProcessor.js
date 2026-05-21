// ===== UTILS/PAYMENTPROCESSOR.JS =====
// Processador automático de pagamentos

const Payment = require('../models/Payment');
const ApiKey = require('../models/ApiKey');

/**
 * Calcula quantos créditos dar baseado no valor pago
 * @param {number} amount - Valor em moeda local
 * @param {string} currency - Moeda (MZN, BRL, USD)
 * @returns {number} Quantidade de créditos
 */
function calculateCredits(amount, currency = 'MZN') {
    // Tabela de conversão (ajuste conforme seu modelo de negócio)
    const rates = {
        'MZN': 10,    // 100 MZN = 1000 créditos (10 créditos por MZN)
        'BRL': 100,   // 1 BRL = 100 créditos
        'USD': 500    // 1 USD = 500 créditos
    };

    const rate = rates[currency] || rates['MZN'];
    return Math.floor(amount * rate);
}

/**
 * Processa webhook do MercadoPago
 */
async function processMercadoPagoWebhook(webhookData) {
    try {
        const { type, data } = webhookData;

        // Só processa eventos de payment
        if (type !== 'payment') {
            return { success: false, message: 'Tipo de evento não suportado' };
        }

        const paymentId = data.id;

        // Busca pagamento no banco
        const payment = await Payment.findByPaymentId(paymentId, 'mercadopago');

        if (!payment) {
            console.log(`⚠️  Pagamento ${paymentId} não encontrado no banco`);
            return { success: false, message: 'Pagamento não encontrado' };
        }

        // Se já foi processado, ignora
        if (payment.processed) {
            console.log(`✅ Pagamento ${paymentId} já foi processado anteriormente`);
            return { success: true, message: 'Já processado' };
        }

        // Atualiza status
        await payment.approve(webhookData);

        // Se aprovado, processa e adiciona créditos
        if (payment.status === 'approved') {
            const result = await payment.processPayment();
            
            console.log(`💰 Créditos adicionados com sucesso!`);
            console.log(`   Payment ID: ${paymentId}`);
            console.log(`   Usuário: ${payment.userId}`);
            console.log(`   Créditos: ${result.credits_added}`);
            console.log(`   Novo saldo: ${result.new_balance}`);

            return {
                success: true,
                message: 'Pagamento processado e créditos adicionados',
                data: result
            };
        }

        return { success: true, message: 'Status atualizado' };

    } catch (error) {
        console.error('❌ Erro ao processar webhook MercadoPago:', error);
        throw error;
    }
}

/**
 * Processa webhook do PayMoz (M-Pesa/E-Mola)
 */
async function processPayMozWebhook(webhookData) {
    try {
        // PayMoz envia dados em formato diferente
        const { transaction_id, status, reference } = webhookData;

        if (!transaction_id && !reference) {
            return { success: false, message: 'Dados inválidos do webhook' };
        }

        // Busca pelo transaction_id ou reference
        const payment = await Payment.findOne({
            $or: [
                { 'paymoz_data.transaction_id': transaction_id },
                { 'paymoz_data.third_party_reference': reference }
            ]
        });

        if (!payment) {
            console.log(`⚠️  Pagamento com transaction_id ${transaction_id} não encontrado`);
            return { success: false, message: 'Pagamento não encontrado' };
        }

        if (payment.processed) {
            console.log(`✅ Pagamento já processado`);
            return { success: true, message: 'Já processado' };
        }

        // Atualiza status baseado no webhook
        if (status === 'success' || status === 'approved') {
            await payment.approve(webhookData);
            const result = await payment.processPayment();

            console.log(`💰 Créditos PayMoz adicionados!`);
            console.log(`   Transaction ID: ${transaction_id}`);
            console.log(`   Usuário: ${payment.userId}`);
            console.log(`   Créditos: ${result.credits_added}`);

            return {
                success: true,
                message: 'Pagamento processado',
                data: result
            };
        }

        return { success: true, message: 'Status atualizado' };

    } catch (error) {
        console.error('❌ Erro ao processar webhook PayMoz:', error);
        throw error;
    }
}

async function processPaySuiteWebhook(webhookData) {
    try {
        const { event, data, request_id } = webhookData;

        // Evita processar duas vezes
        const existing = await Payment.findOne({ 
            'paysuite_data.request_id': request_id 
        });
        if (existing?.status === 'completed') {
            return { success: true, message: 'Já processado' };
        }

        if (event === 'payment.success') {
            const payment = await Payment.findOne({
                'paysuite_data.payment_id': data.id
            });

            if (!payment) {
                return { success: false, message: 'Pagamento não encontrado' };
            }

            // Credita coins no MozHost
            await fetch(`${process.env.MOZHOST_API_URL}/api/payment/internal/credit-coins`, {
                method: 'POST',
                headers: {
                    'x-internal-key': process.env.INTERNAL_SECRET_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userId: payment.userId,
                    coins: payment.credits_to_add
                })
            });

            payment.status = 'completed';
            payment.paysuite_data.request_id = request_id;
            await payment.save();

            console.log(`💰 Coins creditados via Paysuite!`);
            console.log(`   Payment ID: ${data.id}`);
            console.log(`   Usuário: ${payment.userId}`);
            console.log(`   Coins: ${payment.credits_to_add}`);

            return { success: true, message: 'Pagamento processado e coins creditados' };
        }

        if (event === 'payment.failed') {
            const payment = await Payment.findOne({
                'paysuite_data.payment_id': data.id
            });

            if (payment) {
                payment.status = 'failed';
                payment.paysuite_data.error = data.error;
                await payment.save();
            }

            return { success: true, message: 'Pagamento marcado como falhado' };
        }

        return { success: false, message: `Evento desconhecido: ${event}` };

    } catch (error) {
        console.error('❌ Erro ao processar webhook Paysuite:', error);
        throw error;
    }
}

/**
 * Processa pagamentos pendentes (cron job)
 * Útil para processar pagamentos que o webhook não chegou
 */
async function processPendingPayments() {
    try {
        const pendingPayments = await Payment.findPendingToProcess();

        console.log(`🔄 Processando ${pendingPayments.length} pagamentos pendentes...`);

        let processed = 0;
        let failed = 0;

        for (const payment of pendingPayments) {
            try {
                if (payment.canProcess()) {
                    await payment.processPayment();
                    processed++;
                    console.log(`✅ Pagamento ${payment.payment_id} processado`);
                }
            } catch (error) {
                failed++;
                console.error(`❌ Erro ao processar ${payment.payment_id}:`, error.message);
            }
        }

        return {
            total: pendingPayments.length,
            processed,
            failed
        };

    } catch (error) {
        console.error('❌ Erro ao processar pagamentos pendentes:', error);
        throw error;
    }
}

/**
 * Verifica e expira pagamentos antigos
 */
async function expireOldPayments() {
    try {
        const result = await Payment.updateMany(
            {
                status: 'pending',
                expires_at: { $lt: new Date() }
            },
            {
                $set: {
                    status: 'cancelled',
                    status_detail: 'Pagamento expirado automaticamente',
                    updated_at: new Date()
                }
            }
        );

        console.log(`⏰ ${result.modifiedCount} pagamentos expirados`);
        return result.modifiedCount;

    } catch (error) {
        console.error('❌ Erro ao expirar pagamentos:', error);
        throw error;
    }
}

module.exports = {
    calculateCredits,
    processMercadoPagoWebhook,
    processPaySuiteWebhook,
    processPayMozWebhook,
    processPendingPayments,
    expireOldPayments
};
