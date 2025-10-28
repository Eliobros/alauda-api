// ===== MIDDLEWARE/LOGGER.JS =====
// Logger de requests para Alauda API

const fs = require('fs');
const path = require('path');

// Cria pasta de logs se não existir
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Arquivo de log
const logFile = path.join(logsDir, 'access.log');

/**
 * Formata data no padrão ISO
 */
function getTimestamp() {
    return new Date().toISOString();
}

/**
 * Formata IP (pega o real mesmo atrás de proxy)
 */
function getIP(req) {
    return req.headers['x-forwarded-for'] || 
           req.headers['x-real-ip'] || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress ||
           'unknown';
}

/**
 * Obtém user agent
 */
function getUserAgent(req) {
    return req.headers['user-agent'] || 'unknown';
}

/**
 * Obtém API key do request (sem expor completa)
 */
function getApiKey(req) {
    const key = req.headers['x-api-key'] || req.body?.apiKey;
    if (!key) return 'none';
    
    // Mascara a key (mostra só primeiros e últimos 4 chars)
    if (key.length > 12) {
        return `${key.substring(0, 6)}...${key.substring(key.length - 4)}`;
    }
    return 'invalid';
}

/**
 * Formata log no estilo Apache Combined Log
 */
function formatLog(req, res, responseTime) {
    const timestamp = getTimestamp();
    const ip = getIP(req);
    const method = req.method;
    const url = req.originalUrl || req.url;
    const status = res.statusCode;
    const userAgent = getUserAgent(req);
    const apiKey = getApiKey(req);
    const contentLength = res.get('content-length') || 0;
    
    // Formato: [timestamp] IP "METHOD /path" STATUS bytes "User-Agent" apikey ms
    return `[${timestamp}] ${ip} "${method} ${url}" ${status} ${contentLength}b "${userAgent}" ${apiKey} ${responseTime}ms`;
}

/**
 * Escreve log no arquivo
 */
function writeLog(logString) {
    fs.appendFile(logFile, logString + '\n', (err) => {
        if (err) {
            console.error('❌ Erro ao escrever log:', err.message);
        }
    });
}

/**
 * Cores para console (apenas em desenvolvimento)
 */
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

/**
 * Cor baseada no status code
 */
function getStatusColor(status) {
    if (status >= 500) return colors.red;
    if (status >= 400) return colors.yellow;
    if (status >= 300) return colors.cyan;
    if (status >= 200) return colors.green;
    return colors.reset;
}

/**
 * Middleware de logging
 */
function logger(req, res, next) {
    const startTime = Date.now();
    
    // Log quando a resposta termina
    res.on('finish', () => {
        const responseTime = Date.now() - startTime;
        const logString = formatLog(req, res, responseTime);
        
        // Escreve no arquivo
        writeLog(logString);
        
        // Console (apenas em desenvolvimento)
        if (process.env.NODE_ENV === 'development') {
            const statusColor = getStatusColor(res.statusCode);
            const method = req.method.padEnd(6);
            const status = res.statusCode;
            const url = req.originalUrl || req.url;
            const time = `${responseTime}ms`;
            
            console.log(
                `${colors.bright}${method}${colors.reset}`,
                `${statusColor}${status}${colors.reset}`,
                `${colors.cyan}${url}${colors.reset}`,
                `${colors.magenta}${time}${colors.reset}`
            );
        }
    });
    
    next();
}

/**
 * Limpa logs antigos (opcional)
 */
function cleanOldLogs(daysToKeep = 30) {
    const logFiles = fs.readdirSync(logsDir);
    const now = Date.now();
    const maxAge = daysToKeep * 24 * 60 * 60 * 1000; // dias em ms
    
    logFiles.forEach(file => {
        const filePath = path.join(logsDir, file);
        const stats = fs.statSync(filePath);
        const age = now - stats.mtimeMs;
        
        if (age > maxAge) {
            fs.unlinkSync(filePath);
            console.log(`🗑️  Log antigo removido: ${file}`);
        }
    });
}

// Limpa logs antigos ao iniciar (se configurado)
if (process.env.CLEAN_OLD_LOGS === 'true') {
    cleanOldLogs(30);
}

module.exports = logger;
