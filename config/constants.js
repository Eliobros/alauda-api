// ===== CONFIG/CONSTANTS.JS =====
// Constantes da Alauda API

module.exports = {
    // ===== PLANOS =====
    PLANS: {
        FREE: {
            name: 'Free',
            price: 0, // MT
            credits: 100,
            requestsPerDay: 10,
            requestsPerMonth: 100,
            features: [
                'Acesso básico',
                '100 requests/mês',
                'Suporte por email'
            ]
        },
        BASIC: {
            name: 'Basic',
            price: 200, // MT
            credits: 5000,
            requestsPerDay: 200,
            requestsPerMonth: 5000,
            features: [
                'Todas as cases',
                '5.000 requests/mês',
                'Suporte prioritário',
                'Rate limit aumentado'
            ]
        },
        PRO: {
            name: 'Pro',
            price: 500, // MT
            credits: 20000,
            requestsPerDay: 1000,
            requestsPerMonth: 20000,
            features: [
                'Todas as cases',
                '20.000 requests/mês',
                'Suporte prioritário',
                'Sem rate limit diário',
                'Webhooks'
            ]
        },
        PREMIUM: {
            name: 'Premium',
            price: 1000, // MT
            credits: Infinity,
            requestsPerDay: Infinity,
            requestsPerMonth: Infinity,
            features: [
                'Requests ilimitados',
                'Suporte 24/7',
                'SLA garantido',
                'Webhooks',
                'API dedicada',
                'Custom cases'
            ]
        }
    },

    // ===== CUSTOS POR CASE =====
    COSTS: {
	SHAZAM_IDENTIFY: 300,
        TIKTOK_INFO: 10,           // 1 crédito
        TIKTOK_DOWNLOAD: 100,       // 1 crédito
        TWITTER_DOWNLOAD: 100,      // 1 crédito
	SPOTIFY_SEARCH: 10,      // 🆕 ADICIONAR
	LYRICS_SEARCH: 50, // Adiciona isso
    SPOTIFY_DOWNLOAD: 50,
	REMOVE_BG: 10,
        YOUTUBE_INFO: 10,          // 1 crédito
        YOUTUBE_DOWNLOAD: 200,      // 2 créditos (mais pesado)
        INSTAGRAM_DOWNLOAD: 150,    // 1 crédito
        STATUS_MENTION: 250,        // 1 crédito
	FACEBOOK_DOWNLOAD: 50,
	CPF_CONSULTA: 50,	    // 50 de credito
	VOCAL_REMOVE: 50,
        MPESA_VALIDATE: 10,        // 1 crédito
        EMOLA_VALIDATE: 10         // 1 crédito
    },

    // ===== RATE LIMITS =====
    RATE_LIMITS: {
        FREE: {
            windowMs: 15 * 60 * 1000, // 15 minutos
            max: 10 // 10 requests por 15min
        },
        BASIC: {
            windowMs: 15 * 60 * 1000,
            max: 100
        },
        PRO: {
            windowMs: 15 * 60 * 1000,
            max: 500
        },
        PREMIUM: {
            windowMs: 15 * 60 * 1000,
            max: 10000 // Praticamente ilimitado
        }
    },

    // ===== STATUS CODES =====
    STATUS: {
        SUCCESS: 200,
        CREATED: 201,
        BAD_REQUEST: 400,
        UNAUTHORIZED: 401,
        PAYMENT_REQUIRED: 402,
        FORBIDDEN: 403,
        NOT_FOUND: 404,
        TOO_MANY_REQUESTS: 429,
        SERVER_ERROR: 500,
        SERVICE_UNAVAILABLE: 503
    },

    // ===== MENSAGENS DE ERRO =====
    ERRORS: {
        NO_API_KEY: 'API key não fornecida',
        INVALID_API_KEY: 'API key inválida',
        EXPIRED_API_KEY: 'API key expirada',
        INACTIVE_API_KEY: 'API key desativada',
        NO_CREDITS: 'Créditos esgotados. Recarregue sua conta.',
        RATE_LIMIT: 'Limite de requisições atingido. Tente novamente mais tarde.',
        INVALID_URL: 'URL inválida',
        DOWNLOAD_FAILED: 'Falha ao processar download',
        SERVICE_UNAVAILABLE: 'Serviço temporariamente indisponível'
    },

    // ===== SERVIÇOS EXTERNOS =====
    SERVICES: {
        YOUTUBE: {
            url: process.env.YOUTUBE_SERVICE_URL || 'http://localhost:5000',
            timeout: 60000 // 60 segundos
        },
        TIKTOK: {
            url: 'https://www.tikwm.com/api/',
            timeout: 30000
        }
    },

    // ===== CONFIGURAÇÕES GERAIS =====
    SETTINGS: {
        API_VERSION: 'v1',
        API_NAME: 'Alauda API',
        API_DESCRIPTION: 'API de cases para bots WhatsApp - Moçambique',
        AUTHOR: 'Zëüs Lykraios 💎',
        LOCATION: 'Maputo, Moçambique 🇲🇿',
        
        // Validade padrão de API keys (dias)
        DEFAULT_KEY_EXPIRATION: 365,
        
        // Logs
        LOG_RETENTION_DAYS: 30,
        
        // Cache
        CACHE_TTL: 3600 // 1 hora
    },

    // ===== REGEX PATTERNS =====
    PATTERNS: {
        TIKTOK_URL: /(?:https?:\/\/)?(?:www\.)?(?:tiktok\.com|vm\.tiktok\.com)\/@?[\w.-]+\/video\/\d+/,
        YOUTUBE_URL: /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+/,
        TWITTER_URL: /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/\w+\/status\/\d+/,
        INSTAGRAM_URL: /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:p|reel)\/[\w-]+/,
        
        // M-Pesa
        MPESA_PHONE: /^(25[0-9]{9}|0[0-9]{9})$/,
        MPESA_TRANSACTION: /^[A-Z0-9]{10,}$/,
        
        // E-Mola
        EMOLA_PHONE: /^(25[0-9]{9}|0[0-9]{9})$/
    }
};
