// ===== ALAUDA API - SERVER.JS =====
// By: Habibo "Zëüs Lykraios" Salimo Julio
// API de cases para bots WhatsApp - Moçambique

require('dotenv').config();
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
const tiktokRoutes = require('./routes/tiktok');
//const twitterRoutes = require('./routes/twitter');
//const youtubeRoutes = require('./routes/youtube');
const instagramRoutes = require('./routes/instagram');
const whatsappRoutes = require('./routes/whatsapp');
//const paymentRoutes = require('./routes/payment');
//const dashboardRoutes = require('./routes/dashboard');
const facebookRoutes = require('./routes/facebook');
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
            tiktok: '/api/tiktok',
            twitter: '/api/twitter',
            youtube: '/api/youtube',
            instagram: '/api/instagram',
            whatsapp: '/api/whatsapp',
            payment: '/api/payment',
            dashboard: '/api/dashboard'
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

// ===== ROTAS DA API =====
// Todas as rotas precisam de autenticação (implementado dentro de cada rota)
app.use('/api/tiktok', tiktokRoutes);
//app.use('/api/twitter', twitterRoutes);
//app.use('/api/youtube', youtubeRoutes);
app.use('/api/instagram', instagramRoutes);
app.use('/api/whatsapp', whatsappRoutes);
//app.use('/api/payment', paymentRoutes);
//app.use('/api/dashboard', dashboardRoutes);
app.use('/api/facebook', facebookRoutes);
// ===== ROTA 404 =====
/*
app.all('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint não encontrado',
        message: 'Verifique a documentação em https://docs.alauda.api/v1'
    });
});
*/
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
    console.log(`   📡 Servidor rodando na porta: ${PORT}`);
    console.log(`   🔗 URL: http://localhost:${PORT}`);
    console.log(`   📊 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    console.log('');
    console.log('   📋 Cases disponíveis:');
    console.log('      • TikTok Downloader');
    console.log('      • Twitter Downloader');
    console.log('      • YouTube Downloader (Python)');
    console.log('      • Instagram Downloader');
    console.log('      • WhatsApp Status Mention Detector');
    console.log('      • M-Pesa/E-Mola Validator');
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
