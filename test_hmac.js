const crypto = require('crypto');

const rawBody = '{"event_id":"d131a82e-e699-42fd-aa77-598201c42d7b","event":"payment.completed","delivery_id":"d131a82e-e699-42fd-aa77-598201c42d7b","created_at":"2026-07-06T18:54:36.274231+00:00","test":true,"amount":100,"method":"mpesa","status":"success","currency":"MZN","timestamp":"2026-07-06T18:54:30.867Z","transaction_id":"test_1783364070867","data":{"test":true,"amount":100,"method":"mpesa","status":"success","currency":"MZN","timestamp":"2026-07-06T18:54:30.867Z","transaction_id":"test_1783364070867"}}';

const secret = process.env.DEBITOPAY_WEBHOOK_SECRET; // pega direto do .env real

const calculated = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
console.log('Calculado:', calculated);
console.log('Esperado: ', '617bc292b644b60f0009f99124ce80c9211e5c794088c645b4920b49061b2891');
console.log('Bate?', calculated === '617bc292b644b60f0009f99124ce80c9211e5c794088c645b4920b49061b2891');
