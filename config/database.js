// ===== CONFIG/DATABASE.JS =====
// Configuração do MongoDB para Alauda API

module.exports = {
    // URI de conexão
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/alauda-api',
    
    // Opções de conexão
    options: {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        
        // Auto Index
        autoIndex: true,
        
        // Connection Pool
        maxPoolSize: 10,
        minPoolSize: 2,
        
        // Timeouts
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        
        // Retry
        retryWrites: true,
        
        // Logging
        // loggerLevel: 'info'
    },
    
    // Configurações adicionais
    settings: {
        // Nome do banco
        dbName: 'alauda-api',
        
        // Collections
        collections: {
            apiKeys: 'api_keys',
            usage: 'usage_logs',
            users: 'users'
        }
    }
};
