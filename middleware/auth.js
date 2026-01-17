// ===== MIDDLEWARE/AUTH.JS =====
// Middleware de autenticação para Alauda API
// Com suporte para RapidAPI

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
        // ===== RAPIDAPI HANDLER =====
        // Detecta se request veio do RapidAPI
        const isFromRapidAPI = req.headers['x-rapidapi-host'] === 'alauda-api.p.rapidapi.com';

        if (isFromRapidAPI) {
            console.log('🔵 Request via RapidAPI detectada');
            console.log('🎫 RapidAPI Key:', req.headers['x-rapidapi-key']?.substring(0, 10) + '...');

            // Cria objeto "virtual" com créditos ilimitados
            req.apiKeyData = {
                _id: 'rapidapi-user',
                key: req.headers['x-rapidapi-key'],
                name: 'RapidAPI User',
                email: 'rapidapi@alauda.api',
                plan: 'rapidapi',
                credits: 999999,
                requestsToday: 0,
                totalRequests: 0,

                // Métodos necessários
                isValid: () => true,
                hasCredits: (amount) => true,
                consumeCredits: async (amount) => {
                    console.log(`💰 RapidAPI: ${amount} créditos virtuais usados`);
                    return true;
                },
                recordFailure: async () => {
                    console.log('⚠️  RapidAPI: Falha registrada');
                }
            };

            req.creditsNeeded = getCreditsCost(req.originalUrl); // ✅ CORRIGIDO!
            req.startTime = startTime;
            req.clientIP = getClientIP(req);
            req.userAgent = getUserAgent(req);

            // Log de sucesso para RapidAPI
            req.logSuccess = async (responseData = {}) => {
                const responseTime = Date.now() - startTime;

                console.log('✅ RapidAPI Request Success:', {
                    endpoint: req.originalUrl,
                    responseTime: `${responseTime}ms`,
                    case: getCaseName(req.originalUrl)
                });

                // Log no banco (opcional - para analytics)
                try {
                    await Usage.logUsage({
                        apiKey: 'rapidapi',
                        userId: 'rapidapi-user',
                        endpoint: req.originalUrl || req.url,
                        method: req.method,
                        case: getCaseName(req.originalUrl),
                        requestBody: sanitizeRequestBody(req.body),
                        statusCode: 200,
                        success: true,
                        responseTime: responseTime,
                        creditsUsed: req.creditsNeeded,
                        creditsRemaining: 999999,
                        ip: req.clientIP,
                        userAgent: req.userAgent,
                        metadata: { ...responseData, source: 'rapidapi' }
                    });
                } catch (logError) {
                    console.error('⚠️  Erro ao logar uso RapidAPI:', logError.message);
                }
            };

            // Log de erro para RapidAPI
            req.logError = async (statusCode, errorMsg) => {
                const responseTime = Date.now() - startTime;

                console.error('❌ RapidAPI Request Error:', {
                    endpoint: req.originalUrl,
                    error: errorMsg,
                    statusCode
                });

                // Log no banco (opcional)
                try {
                    await Usage.logUsage({
                        apiKey: 'rapidapi',
                        userId: 'rapidapi-user',
                        endpoint: req.originalUrl || req.url,
                        method: req.method,
                        case: getCaseName(req.originalUrl),
                        requestBody: sanitizeRequestBody(req.body),
                        statusCode: statusCode,
                        success: false,
                        responseTime: responseTime,
                        errorMessage: errorMsg,
                        creditsUsed: 0,
                        creditsRemaining: 999999,
                        ip: req.clientIP,
                        userAgent: req.userAgent,
                        metadata: { source: 'rapidapi' }
                    });
                } catch (logError) {
                    console.error('⚠️  Erro ao logar erro RapidAPI:', logError.message);
                }
            };

            console.log('✅ RapidAPI: Autenticação bypass concedida');
            return next(); // LIBERA SEM VALIDAR KEY!
        }

        // ===== AUTENTICAÇÃO NORMAL (REQUESTS DIRETOS) =====
        console.log('🔐 Request direto - validando API Key...');

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
        const creditsNeeded = getCreditsCost(req.originalUrl); // ✅ CORRIGIDO!

        console.log(`📍 Rota: ${req.originalUrl}`);
        console.log(`💰 Créditos necessários: ${creditsNeeded}`);
        console.log(`💰 Créditos disponíveis: ${keyData.credits}`);

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

            console.log(`✅ Sucesso! Consumindo ${creditsNeeded} créditos...`);

            // Consome créditos
            await keyData.consumeCredits(creditsNeeded);

            console.log(`💰 Créditos restantes: ${keyData.credits}`);

            // Log no banco
            await Usage.logUsage({
                apiKey: keyData.key,
                userId: keyData.userId,
                endpoint: req.originalUrl || req.url,
                method: req.method,
                case: getCaseName(req.originalUrl),
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

            console.log(`❌ Erro! Não consumindo créditos.`);

            // Registra falha (sem consumir créditos)
            await keyData.recordFailure();

            // Log no banco
            await Usage.logUsage({
                apiKey: keyData.key,
                userId: keyData.userId,
                endpoint: req.originalUrl || req.url,
                method: req.method,
                case: getCaseName(req.originalUrl),
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

        console.log('✅ Autenticação direta concedida');
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
 * ✅ CORRIGIDO - Usa req.originalUrl ao invés de req.path
 */
function getCreditsCost(url) {
    // TikTok
    if (url.includes('/tiktok/download')) return constants.COSTS.TIKTOK_DOWNLOAD;
    if (url.includes('/tiktok/info')) return constants.COSTS.TIKTOK_INFO;
    if (url.includes('/tiktok')) return constants.COSTS.TIKTOK_DOWNLOAD; // Fallback genérico

    // Twitter
    if (url.includes('/twitter')) return constants.COSTS.TWITTER_DOWNLOAD;

    // YouTube
    if (url.includes('/youtube/download')) return constants.COSTS.YOUTUBE_DOWNLOAD;
    if (url.includes('/youtube/info')) return constants.COSTS.YOUTUBE_INFO;
    if (url.includes('/youtube')) return constants.COSTS.YOUTUBE_DOWNLOAD; // Fallback genérico

    // Instagram
    if (url.includes('/instagram')) return constants.COSTS.INSTAGRAM_DOWNLOAD;

    // WhatsApp
    if (url.includes('/whatsapp')) return constants.COSTS.STATUS_MENTION;

    // Spotify
    if (url.includes('/spotify/search')) return constants.COSTS.SPOTIFY_SEARCH;
    if (url.includes('/spotify/download')) return constants.COSTS.SPOTIFY_DOWNLOAD;
    if (url.includes('/spotify')) return constants.COSTS.SPOTIFY_DOWNLOAD; // Fallback genérico

    // Facebook
    if (url.includes('/facebook')) return constants.COSTS.FACEBOOK_DOWNLOAD;

    // Shazam
    if (url.includes('/shazam')) return constants.COSTS.SHAZAM_IDENTIFY;

    // Lyrics
    if (url.includes('/lyrics')) return constants.COSTS.LYRICS_SEARCH;

    // CPF - ✅ CORRIGIDO!
    if (url.includes('/cpf')) return constants.COSTS.CPF_CONSULTA;

    // Remove Background - ✅ CORRIGIDO!
    if (url.includes('/remove')) return constants.COSTS.REMOVE_BG;

    // Pagamentos
    if (url.includes('/payment/mpesa')) return constants.COSTS.MPESA_VALIDATE;
    if (url.includes('/payment/emola')) return constants.COSTS.EMOLA_VALIDATE;

    // ⚠️ Default para rotas não mapeadas
    console.warn(`⚠️ Rota não mapeada: ${url} - usando custo padrão de 1 crédito`);
    return 1;
}

/**
 * Obtém nome da case baseado no url
 */
function getCaseName(url) {
    if (url.includes('/tiktok')) return 'tiktok_download';
    if (url.includes('/twitter')) return 'twitter_download';
    if (url.includes('/youtube/download')) return 'youtube_download';
    if (url.includes('/youtube/info')) return 'youtube_info';
    if (url.includes('/instagram')) return 'instagram_download';
    if (url.includes('/whatsapp')) return 'status_mention';
    if (url.includes('/payment/mpesa')) return 'mpesa_payment';
    if (url.includes('/payment/emola')) return 'emola_payment';
    if (url.includes('/payment/mercadopago')) return 'mercadopago_payment';
    if (url.includes('/spotify')) return 'spotify_download';
    if (url.includes('/facebook')) return 'facebook_download';
    if (url.includes('/shazam')) return 'shazam_identify';
    if (url.includes('/lyrics')) return 'lyrics_search';
    if (url.includes('/cpf')) return 'cpf_validate';
    if (url.includes('/remove')) return 'background_remove';

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
    delete sanitized.numero_celular; // Protege números de telefone

    return sanitized;
}

module.exports = authenticateApiKey;

