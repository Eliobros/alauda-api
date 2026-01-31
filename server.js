// ===== ALAUDA API - SERVER.JS =====
// By: Habibo "Zëüs Lykraios" Salimo Julio
// API de cases para bots WhatsApp - Moçambique

require('dotenv').config();
const { startPaymentCronJobs } = require('./jobs/paymentCron');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');

// Importa configurações
const dbConfig = require('./config/database');
const constants = require('./config/constants');

// Importa middlewares
const logger = require('./middleware/logger');

// Importa rotas
const validateRoutes = require('./routes/validate');
const lyricsRoutes = require('./routes/lyrics');
const authRoutes = require('./routes/auth');
const keysRoutes = require('./routes/keys');
const cpfRoutes = require('./routes/cpf');
const spotifyRoutes = require('./routes/spotify');
const removeRoutes = require('./routes/remove');
const tiktokRoutes = require('./routes/tiktok');
const vocalRemoveRoutes = require('./routes/vocalremove'); 

//const twitterRoutes = require('./routes/twitter');
const youtubeRoutes = require('./routes/youtube');
const instagramRoutes = require('./routes/instagram');
const whatsappRoutes = require('./routes/whatsapp');
const shazamRoutes = require('./routes/shazam');
const paymentRoutes = require('./routes/payment');
//const dashboardRoutes = require('./routes/dashboard');
const facebookRoutes = require('./routes/facebook');
const xvideosRoutes = require('./routes/xvideos');

// Inicializa Express
const app = express();
const PORT = process.env.PORT || 3000;

// ===== MIDDLEWARES GLOBAIS =====
app.use(helmet()); // Segurança
app.use(cors()); // CORS
app.use(express.json()); // Parse JSON
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded
app.use(logger); // Log de todas as requests

// ===== CONECTA NO MONGODB =====
mongoose.connect(process.env.MONGODB_URI || dbConfig.uri, dbConfig.options)
    .then(() => {
        console.log('✅ MongoDB conectado com sucesso!');
        console.log(`📊 Database: ${process.env.MONGODB_URI.includes('atlas') ? 'MongoDB Atlas ☁️' : 'MongoDB Local 💻'}`);
	startPaymentCronJobs();
    })
    .catch((error) => {
        console.error('❌ Erro ao conectar no MongoDB:', error.message);
        // Continua mesmo sem MongoDB (pode usar arquivos JSON como fallback)
    });

// ===== ROTA RAIZ (Health Check) =====
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: '⚡ Alauda API - Online',
        version: '1.0.0',
        author: 'Zëüs Lykraios 💎',
        endpoints: {
            lyrics: '/api/lyrics',
            tiktok: '/api/tiktok',
            twitter: '/api/twitter',
            youtube: '/api/youtube',
            instagram: '/api/instagram',
            whatsapp: '/api/whatsapp',
            spotify: '/api/spotify',
            shazam: '/api/shazam',
            facebook: '/api/facebook',
	    xvieos: '/api/xvideos',
	    vocalremover: 'api/vocalremover',
	    validateKeys: '/api/validate/key',
	    payments: '/api/payments',
	    cpf: '/api/cpf',
        },
        docs: 'https://docs.alauda.api/v1'
    });
});

// ===== HEALTH CHECK =====
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});

// ===== FUNÇÃO PARA REGISTRAR ROTAS COM LOG =====
const loadedRoutes = [];

function registerRoute(path, router, name) {
    app.use(path, router);
    loadedRoutes.push({ path, name });
    console.log(`✅ Rota carregada: ${path.padEnd(25)} | ${name}`);
}

console.log('\n🚀 ===== CARREGANDO ROTAS ===== 🚀\n');

// ===== ROTAS DA API =====
app.use('/api/vocalremove', vocalRemoveRoutes);
registerRoute('/api/auth', authRoutes, 'Autenticação');
registerRoute('/api/keys', keysRoutes, 'Gerenciamento de API Keys');
registerRoute('/api/cpf', cpfRoutes, 'Validação CPF');
registerRoute('/api/spotify', spotifyRoutes, 'Spotify Downloader');
registerRoute('/api/remove', removeRoutes, 'Background Remover');
registerRoute('/api/lyrics', lyricsRoutes, 'Lyrics Search');
registerRoute('/api/tiktok', tiktokRoutes, 'TikTok Downloader');
//registerRoute('/api/twitter', twitterRoutes, 'Twitter Downloader');
registerRoute('/api/youtube', youtubeRoutes, 'YouTube Downloader');
registerRoute('/api/instagram', instagramRoutes, 'Instagram Downloader');
registerRoute('/api/whatsapp', whatsappRoutes, 'WhatsApp Utils');
registerRoute('/api/validate', validateRoutes, 'Validação de API Keys');
registerRoute('/api/shazam', shazamRoutes, 'Shazam Music Identifier');
registerRoute('/api/payment', paymentRoutes, 'Payment System');
//registerRoute('/api/dashboard', dashboardRoutes, 'Dashboard');
registerRoute('/api/facebook', facebookRoutes, 'Facebook Downloader');
app.use('/api/xvideos', xvideosRoutes);
console.log(`\n✅ Total: ${loadedRoutes.length} rotas carregadas com sucesso!\n`);

// ===== ROTA 404 =====
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint não encontrado',
        message: `${req.method} ${req.path} não existe`,
        availableEndpoints: loadedRoutes.map(r => r.path)
    });
});

// ===== ERROR HANDLER GLOBAL =====
app.use((error, req, res, next) => {
    console.error('❌ Erro:', error);

    res.status(error.status || 500).json({
        success: false,
        error: error.message || 'Erro interno do servidor',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
});

// ===== INICIA O SERVIDOR =====
app.listen(PORT, () => {
    console.log('');
    console.log('⚡━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⚡');
    console.log('           🚀 ALAUDA API ONLINE 🚀           ');
    console.log('⚡━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⚡');
    console.log('');
    console.log(`   👑 Desenvolvido por: Zëüs Lykraios 💎`);
    console.log(`   🌍 Localização: Maputo, Moçambique`);
    console.log('');
    console.log(`   📡 Servidor: http://localhost:${PORT}`);
    console.log(`   🌐 IP Público: http://208.110.72.191:${PORT}`);
    console.log(`   📊 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   ⏰ Iniciado: ${new Date().toLocaleString('pt-BR', { timeZone: 'Africa/Maputo' })}`);
    console.log('');
    console.log('⚡━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⚡');
    console.log('');
});

// ===== GRACEFUL SHUTDOWN =====
process.on('SIGTERM', () => {
    console.log('⚠️  SIGTERM recebido, encerrando servidor...');
    mongoose.connection.close(() => {
        console.log('✅ MongoDB desconectado');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('\n⚠️  SIGINT recebido (Ctrl+C), encerrando servidor...');
    mongoose.connection.close(() => {
        console.log('✅ MongoDB desconectado');
        process.exit(0);
    });
});

module.exports = app;
