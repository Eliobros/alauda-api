// ===== MODELS/USAGE.JS =====
// Schema de logs de uso para Alauda API

const mongoose = require('mongoose');

const usageSchema = new mongoose.Schema({
    // ===== IDENTIFICAÇÃO =====
    apiKey: {
        type: String,
        required: true,
        index: true
    },
    userId: {
        type: String,
        required: true,
        index: true
    },
    
    // ===== REQUEST INFO =====
    endpoint: {
        type: String,
        required: true,
        index: true
    },
    method: {
        type: String,
        enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        default: 'POST'
    },
    case: {
        type: String,
        enum: [
            'tiktok_download',
            'twitter_download', 
            'youtube_download',
            'youtube_info',
            'instagram_download',
            'status_mention',
            'mpesa_validate',
            'emola_validate',
	    'unknown'
        ],
        required: true,
        index: true
    },
    
    // ===== REQUEST DETAILS =====
    requestBody: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    requestHeaders: {
        type: Map,
        of: String,
        default: {}
    },
    
    // ===== RESPONSE INFO =====
    statusCode: {
        type: Number,
        required: true,
        index: true
    },
    success: {
        type: Boolean,
        required: true,
        index: true
    },
    responseTime: {
        type: Number, // em ms
        required: true
    },
    errorMessage: {
        type: String,
        default: null
    },
    
    // ===== CREDITS =====
    creditsUsed: {
        type: Number,
        default: 1,
        min: 0
    },
    creditsRemaining: {
        type: Number,
        default: 0,
        min: 0
    },
    
    // ===== CLIENT INFO =====
    ip: {
        type: String,
        required: true
    },
    userAgent: {
        type: String,
        default: 'unknown'
    },
    
    // ===== TIMESTAMP =====
    timestamp: {
        type: Date,
        default: Date.now,
        index: true
    },
    
    // ===== METADATA =====
    metadata: {
        type: Map,
        of: mongoose.Schema.Types.Mixed,
        default: {}
    }
}, {
    timestamps: false, // Usamos timestamp manual
    collection: 'usage_logs'
});

// ===== INDEXES =====
usageSchema.index({ apiKey: 1, timestamp: -1 });
usageSchema.index({ userId: 1, timestamp: -1 });
usageSchema.index({ case: 1, timestamp: -1 });
usageSchema.index({ success: 1, timestamp: -1 });
usageSchema.index({ timestamp: -1 }); // Para limpeza de logs antigos

// ===== MÉTODOS ESTÁTICOS =====

/**
 * Registra uso
 */
usageSchema.statics.logUsage = async function(data) {
    const usage = new this(data);
    return await usage.save();
};

/**
 * Estatísticas por API key
 */
usageSchema.statics.getStatsByApiKey = async function(apiKey, startDate, endDate) {
    const match = { apiKey };
    
    if (startDate || endDate) {
        match.timestamp = {};
        if (startDate) match.timestamp.$gte = new Date(startDate);
        if (endDate) match.timestamp.$lte = new Date(endDate);
    }
    
    return await this.aggregate([
        { $match: match },
        {
            $group: {
                _id: '$case',
                count: { $sum: 1 },
                successCount: {
                    $sum: { $cond: ['$success', 1, 0] }
                },
                failureCount: {
                    $sum: { $cond: ['$success', 0, 1] }
                },
                totalCredits: { $sum: '$creditsUsed' },
                avgResponseTime: { $avg: '$responseTime' }
            }
        },
        { $sort: { count: -1 } }
    ]);
};

/**
 * Estatísticas por usuário
 */
usageSchema.statics.getStatsByUser = async function(userId, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    return await this.aggregate([
        {
            $match: {
                userId,
                timestamp: { $gte: startDate }
            }
        },
        {
            $group: {
                _id: {
                    date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }
                },
                requests: { $sum: 1 },
                credits: { $sum: '$creditsUsed' },
                successRate: {
                    $avg: { $cond: ['$success', 1, 0] }
                }
            }
        },
        { $sort: { '_id.date': 1 } }
    ]);
};

/**
 * Top cases mais usadas
 */
usageSchema.statics.getTopCases = async function(limit = 10, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    return await this.aggregate([
        {
            $match: {
                timestamp: { $gte: startDate }
            }
        },
        {
            $group: {
                _id: '$case',
                count: { $sum: 1 },
                successRate: {
                    $avg: { $cond: ['$success', 1, 0] }
                }
            }
        },
        { $sort: { count: -1 } },
        { $limit: limit }
    ]);
};

/**
 * Limpa logs antigos
 */
usageSchema.statics.cleanOldLogs = async function(days = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    const result = await this.deleteMany({
        timestamp: { $lt: cutoffDate }
    });
    
    return result.deletedCount;
};

/**
 * Requests por hora (últimas 24h)
 */
usageSchema.statics.getRequestsPerHour = async function(apiKey = null) {
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
    
    const match = { timestamp: { $gte: twentyFourHoursAgo } };
    if (apiKey) match.apiKey = apiKey;
    
    return await this.aggregate([
        { $match: match },
        {
            $group: {
                _id: {
                    hour: { $hour: '$timestamp' }
                },
                count: { $sum: 1 }
            }
        },
        { $sort: { '_id.hour': 1 } }
    ]);
};

module.exports = mongoose.model('Usage', usageSchema);
