// ===== JOBS/PAYMENTCRON.JS =====
// Cron jobs para processar pagamentos automaticamente

const cron = require('node-cron');
const paymentProcessor = require('../utils/paymentProcessor');

/**
 * Inicia todos os cron jobs de pagamento
 */
function startPaymentCronJobs() {
    console.log('🕐 Iniciando cron jobs de pagamento...');

    // ===== JOB 1: Processar pagamentos pendentes =====
    // Executa a cada 5 minutos
    cron.schedule('*/5 * * * *', async () => {
        try {
            console.log('🔄 [CRON] Processando pagamentos pendentes...');
            const result = await paymentProcessor.processPendingPayments();
            console.log(`✅ [CRON] Pagamentos processados: ${result.processed}/${result.total}`);
            
            if (result.failed > 0) {
                console.log(`⚠️  [CRON] Falhas: ${result.failed}`);
            }
        } catch (error) {
            console.error('❌ [CRON] Erro ao processar pagamentos:', error.message);
        }
    });

    // ===== JOB 2: Expirar pagamentos antigos =====
    // Executa a cada 1 hora
    cron.schedule('0 * * * *', async () => {
        try {
            console.log('⏰ [CRON] Expirando pagamentos antigos...');
            const expired = await paymentProcessor.expireOldPayments();
            console.log(`✅ [CRON] ${expired} pagamentos expirados`);
        } catch (error) {
            console.error('❌ [CRON] Erro ao expirar pagamentos:', error.message);
        }
    });

    // ===== JOB 3: Relatório diário (opcional) =====
    // Executa todo dia às 00:00
    cron.schedule('0 0 * * *', async () => {
        try {
            console.log('📊 [CRON] Gerando relatório diário de pagamentos...');
            const Payment = require('../models/Payment');
            
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const stats = await Payment.aggregate([
                {
                    $match: {
                        created_at: { $gte: today }
                    }
                },
                {
                    $group: {
                        _id: '$status',
                        count: { $sum: 1 },
                        total: { $sum: '$amount' }
                    }
                }
            ]);
            
            console.log('📈 [CRON] Relatório diário:', stats);
        } catch (error) {
            console.error('❌ [CRON] Erro no relatório:', error.message);
        }
    });

    console.log('✅ Cron jobs de pagamento iniciados com sucesso!');
    console.log('   • Processar pendentes: a cada 5 minutos');
    console.log('   • Expirar antigos: a cada 1 hora');
    console.log('   • Relatório diário: 00:00');
}

module.exports = { startPaymentCronJobs };
