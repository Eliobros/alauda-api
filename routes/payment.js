// ===== ROUTES/PAYMENT.JS (INDEX) =====
// Sistema de pagamentos da Alauda API.
// Este arquivo apenas monta os sub-routers — a lógica está em:
//   - routes/payment/mobile-money.js  → M-Pesa, E-Mola, Visa/Mastercard, status Zumbo Pay
//   - routes/payment/payout.js        → Payout B2C (envio de dinheiro) Zumbo Pay
//   - routes/payment/mercadopago.js   → MercadoPago + rotas legado
//   - routes/payment/webhooks.js      → Webhooks MercadoPago e Zumbo Pay
//   - routes/payment/management.js    → Info, process-pending, my-payments, recibo PDF
//   - services/zumbopayService.js     → Lógica de integração Zumbo Pay
//   - services/mercadopagoService.js  → Lógica de integração MercadoPago

const express = require('express');
const router = express.Router();

router.use(require('./payment/mobile-money'));
router.use(require('./payment/payout'));
router.use(require('./payment/mercadopago'));
router.use(require('./payment/webhooks'));
router.use(require('./payment/management'));

module.exports = router;
