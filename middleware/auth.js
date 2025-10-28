// ===== MIDDLEWARE/AUTH.JS =====
// Middleware de autenticação para Alauda API

const ApiKey = require('../models/ApiKey');
const Usage = require('../models/Usage');
const constants = require('../config/constants');

/**
 * Obtém IP do cliente (mesmo atrás de proxy)
 */
function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
           req.headers['x-real-ip'] ||
           req.connection.remoteAddress ||
           req.socket.remoteAddress ||
           'unknown';
}

/**
 * Obtém User Agent
 */
function getUserAgent(req) {
    return req.headers['user-agent'] || 'unknown';
}

/**
 * Middleware de autenticação
 */
async function authenticateApiKey(req, res, next) {
    const startTime = Date.now();
    
    try {
        // ===== 1. EXTRAI API KEY =====
        const apiKey = req.headers['x-api-key'] || 
                      req.body?.apiKey || 
                      req.query?.apiKey;
        
        if (!apiKey) {
            return res.status(constants.STATUS.UNAUTHORIZED).json({
                success: false,
                error: constants.ERRORS.NO_API_KEY,
                message: 'Forneça a API key no header X-API-Key'
            });
        }
        
        // ===== 2. BUSCA NO BANCO =====
        const keyData = await ApiKey.findByKey(apiKey);
        
        if (!keyData) {
            return res.status(constants.STATUS.UNAUTHORIZED).json({
                success: false,
                error: constants.ERRORS.INVALID_API_KEY
            });
        }
        
        // ===== 3. VALIDA STATUS =====
        if (!keyData.isValid()) {
            let errorMsg = constants.ERRORS.INACTIVE_API_KEY;
            
            if (keyData.suspended) {
                errorMsg = `API key suspensa: ${keyData.suspensionReason}`;
            } else if (keyData.expiresAt && keyData.expiresAt < new Date()) {
                errorMsg = constants.ERRORS.EXPIRED_API_KEY;
            }
            
            return res.status(constants.STATUS.FORBIDDEN).json({
                success: false,
                error: errorMsg
            });
        }
        
        // ===== 4. VERIFICA CRÉDITOS =====
        const creditsNeeded = getCreditsCost(req.path);
        
        if (!keyData.hasCredits(creditsNeeded)) {
            return res.status(constants.STATUS.PAYMENT_REQUIRED).json({
                success: false,
                error: constants.ERRORS.NO_CREDITS,
                credits_remaining: keyData.credits,
                credits_needed: creditsNeeded
            });
        }
        
        // ===== 5. RATE LIMITING =====
        const rateLimit = constants.RATE_LIMITS[keyData.plan.toUpperCase()];
        
        // Reset contador diário se necessário
        const today = new Date().toDateString();
        const lastRequest = keyData.lastRequestDate ? 
                           new Date(keyData.lastRequestDate).toDateString() : null;
        
        if (today !== lastRequest) {
            keyData.requestsToday = 0;
        }
        
        // Verifica limite diário baseado no plano
        const dailyLimit = constants.PLANS[keyData.plan.toUpperCase()].requestsPerDay;
        
        if (keyData.requestsToday >= dailyLimit) {
            return res.status(constants.STATUS.TOO_MANY_REQUESTS).json({
                success: false,
                error: constants.ERRORS.RATE_LIMIT,
                daily_limit: dailyLimit,
                requests_today: keyData.requestsToday,
                reset_at: new Date(new Date().setHours(24, 0, 0, 0)).toISOString()
            });
        }
        
        // ===== 6. ATUALIZA IP E USER AGENT =====
        keyData.lastRequestIP = getClientIP(req);
        
        // ===== 7. ANEXA DADOS NO REQUEST =====
        req.apiKeyData = keyData;
        req.creditsNeeded = creditsNeeded;
        req.startTime = startTime;
        req.clientIP = getClientIP(req);
        req.userAgent = getUserAgent(req);
        
        // ===== 8. LOG DE SUCESSO =====
        req.logSuccess = async (responseData = {}) => {
            const responseTime = Date.now() - startTime;
            
            // Consome créditos
            await keyData.consumeCredits(creditsNeeded);
            
            // Log no banco
            await Usage.logUsage({
                apiKey: keyData.key,
                userId: keyData.userId,
                endpoint: req.originalUrl || req.url,
                method: req.method,
                case: getCaseName(req.path),
                requestBody: sanitizeRequestBody(req.body),
                statusCode: 200,
                success: true,
                responseTime: responseTime,
                creditsUsed: creditsNeeded,
                creditsRemaining: keyData.credits,
                ip: req.clientIP,
                userAgent: req.userAgent,
                metadata: responseData
            });
        };
        
        // ===== 9. LOG DE ERRO =====
        req.logError = async (statusCode, errorMsg) => {
            const responseTime = Date.now() - startTime;
            
            // Registra falha (sem consumir créditos)
            await keyData.recordFailure();
            
            // Log no banco
            await Usage.logUsage({
                apiKey: keyData.key,
                userId: keyData.userId,
                endpoint: req.originalUrl || req.url,
                method: req.method,
                case: getCaseName(req.path),
                requestBody: sanitizeRequestBody(req.body),
                statusCode: statusCode,
                success: false,
                responseTime: responseTime,
                errorMessage: errorMsg,
                creditsUsed: 0,
                creditsRemaining: keyData.credits,
                ip: req.clientIP,
                userAgent: req.userAgent
            });
        };
        
        next();
        
    } catch (error) {
        console.error('❌ Erro na autenticação:', error);
        
        res.status(constants.STATUS.SERVER_ERROR).json({
            success: false,
            error: 'Erro na autenticação',
            message: error.message
        });
    }
}

/**
 * Obtém custo em créditos baseado no endpoint
 */
function getCreditsCost(path) {
    if (path.includes('/tiktok')) return constants.COSTS.TIKTOK_DOWNLOAD;
    if (path.includes('/twitter')) return constants.COSTS.TWITTER_DOWNLOAD;
    if (path.includes('/youtube/download')) return constants.COSTS.YOUTUBE_DOWNLOAD;
    if (path.includes('/youtube/info')) return constants.COSTS.YOUTUBE_INFO;
    if (path.includes('/instagram')) return constants.COSTS.INSTAGRAM_DOWNLOAD;
    if (path.includes('/whatsapp')) return constants.COSTS.STATUS_MENTION;
    if (path.includes('/payment/mpesa')) return constants.COSTS.MPESA_VALIDATE;
    if (path.includes('/payment/emola')) return constants.COSTS.EMOLA_VALIDATE;
    
    return 1; // Default
}

/**
 * Obtém nome da case baseado no path
 */
function getCaseName(path) {
    if (path.includes('/tiktok')) return 'tiktok_download';
    if (path.includes('/twitter')) return 'twitter_download';
    if (path.includes('/youtube/download')) return 'youtube_download';
    if (path.includes('/youtube/info')) return 'youtube_info';
    if (path.includes('/instagram')) return 'instagram_download';
    if (path.includes('/whatsapp')) return 'status_mention';
    if (path.includes('/payment/mpesa')) return 'mpesa_validate';
    if (path.includes('/payment/emola')) return 'emola_validate';
    
    return 'unknown';
}

/**
 * Remove dados sensíveis do request body antes de logar
 */
function sanitizeRequestBody(body) {
    const sanitized = { ...body };
    
    // Remove campos sensíveis
    delete sanitized.apiKey;
    delete sanitized.password;
    delete sanitized.token;
    
    return sanitized;
}

module.exports = authenticateApiKey;
