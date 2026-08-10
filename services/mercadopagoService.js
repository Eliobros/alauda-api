// ===== SERVICES/MERCADOPAGOSERVICE.JS =====
// Lógica de integração com o MercadoPago (PIX, Cartão, Boleto).
// Separado do router para facilitar a manutenção e testes.

const { MercadoPagoConfig, Preference, Payment: MPPayment } = require('mercadopago');

// ===== CONFIGURAÇÕES =====

const mpClient = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN || 'APP_USR-8802230897684987-041621-6921931c4f51569f86ef5f5a25196068-1779653557'
});

// ===== FUNÇÕES MERCADOPAGO =====

async function createPaymentPreference(data) {
    try {
        const { email, amount, description, usuario_id, back_urls, notification_url } = data;

        const preference = new Preference(mpClient);

        const preferenceData = {
            body: {
                items: [
                    {
                        title: description || `Compra de ${amount} Coins`,
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

module.exports = {
    createPaymentPreference,
    getPaymentStatus
};
