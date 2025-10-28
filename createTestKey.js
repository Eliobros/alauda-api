const mongoose = require('mongoose');
const { createApiKey } = require('./utils/generateKey');

async function main() {
    await mongoose.connect('mongodb://localhost:27017/alauda-api');
    
    const key = await createApiKey({
        userId: 'test_001',
        userName: 'Habibo Test',
        email: 'habibo@test.com',
        phone: '258841234567',
        plan: 'basic' // 5000 créditos
    });
    
    console.log('\n✅ API Key criada com sucesso!\n');
    console.log('🔑 API Key:', key.apiKey);
    console.log('👤 Usuário:', key.user.userName);
    console.log('📊 Plano:', key.user.plan);
    console.log('💰 Créditos:', key.user.credits);
    console.log('\n🔗 Use essa key nos testes!\n');
    
    process.exit(0);
}

main().catch(console.error)
