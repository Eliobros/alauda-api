// ===== ROUTES/PAYMENT/MANAGEMENT.JS =====
// Rotas de informação e gestão de pagamentos: /info, /process-pending,
// /my-payments e /receipt (recibo em PDF).

const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');

const authenticateApiKey = require('../../middleware/auth');
const response = require('../../utils/responseHandler');
const Payment = require('../../models/Payment');
const paymentProcessor = require('../../utils/paymentProcessor');

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

// ===== ROTA: PROCESSAR PAGAMENTOS PENDENTES MANUALMENTE =====

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

// ===== ROTA: LISTAR MEUS PAGAMENTOS =====

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

// ===== ROTA: GERAR RECIBO EM PDF =====
// Recibo gerado direto do MongoDB (independente do MozHost/MySQL)

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
