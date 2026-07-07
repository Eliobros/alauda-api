// scripts/checar-visa-mastercard.js
//
// Lista todos os pagamentos via Visa/Mastercard dos últimos 30 dias.
// Rodar de dentro da pasta raiz da Alauda API (onde está o node_modules
// e o .env), assim: node scripts/checar-visa-mastercard.js
//
// Se o teu projeto usa outro caminho para o Payment model ou outra
// variável de ambiente para a connection string do Mongo, ajusta as
// duas linhas marcadas abaixo.

require('dotenv').config(); // carrega o .env (ajusta o caminho se necessário)
const mongoose = require('mongoose');
const Payment = require('../models/Payment'); // <-- ajusta o caminho se necessário

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI; // <-- ajusta o nome da env var se for diferente

async function main() {
  if (!MONGO_URI) {
    console.error('❌ Não achei a connection string do Mongo (MONGODB_URI / MONGO_URI). Confere o .env.');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log('✅ Conectado ao MongoDB\n');

  const trintaDiasAtras = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const pagamentos = await Payment.find({
    provider: 'visa_mastercard',
    created_at: { $gte: trintaDiasAtras }
  }).sort({ created_at: -1 });

  if (pagamentos.length === 0) {
    console.log('Nenhum pagamento via Visa/Mastercard encontrado nos últimos 30 dias.');
  } else {
    console.log(`Encontrados ${pagamentos.length} pagamento(s) via Visa/Mastercard:\n`);

    let totalBruto = 0;

    pagamentos.forEach((p, i) => {
      totalBruto += parseFloat(p.amount || 0);
      console.log(`${i + 1}. ID: ${p.payment_id}`);
      console.log(`   Usuário: ${p.userId}`);
      console.log(`   Email: ${p.email || 'N/A'}`);
      console.log(`   Valor: ${p.amount} ${p.currency}`);
      console.log(`   Status: ${p.status}`);
      console.log(`   Data: ${p.created_at}`);
      console.log('   ---');
    });

    console.log(`\n💰 Total bruto no período: ${totalBruto.toFixed(2)} MZN`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Erro ao consultar pagamentos:', err);
  process.exit(1);
});
