// ===== MODELS/APIKEY.JS =====
// Schema de API Keys para Alauda API

const mongoose = require('mongoose');

const apiKeySchema = new mongoose.Schema({
    // ===== IDENTIFICAÇÃO =====
    key: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    
    // ===== INFORMAÇÕES DO USUÁRIO =====
    userId: {
        type: String,
        required: true
    },
    userName: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
        match: [/^\S+@\S+\.\S+$/, 'Email inválido']
    },
    phone: {
  type: String,
  trim: true,
  match: [/^258\d{9}$/, 'Telefone inválido']
},
    
    // ===== PLANO E CRÉDITOS =====
    plan: {
        type: String,
        enum: ['free', 'basic', 'pro', 'premium'],
        default: 'free',
        lowercase: true
    },
    credits: {
        type: Number,
        default: 100, // Plano free começa com 100
        min: 0
    },
    
    // ===== ESTATÍSTICAS =====
    totalRequests: {
        type: Number,
        default: 0,
        min: 0
    },
    successfulRequests: {
        type: Number,
        default: 0,
        min: 0
    },
    failedRequests: {
        type: Number,
        default: 0,
        min: 0
    },
    
    // ===== RATE LIMITING =====
    requestsToday: {
        type: Number,
        default: 0,
        min: 0
    },
    lastRequestDate: {
        type: Date,
        default: null
    },
    lastRequestIP: {
        type: String,
        default: null
    },
    
    // ===== STATUS =====
    active: {
        type: Boolean,
        default: true
    },
    suspended: {
        type: Boolean,
        default: false
    },
    suspensionReason: {
        type: String,
        default: null
    },
    
    // ===== DATAS =====
    createdAt: {
        type: Date,
        default: Date.now,
        immutable: true
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
    expiresAt: {
        type: Date,
        default: function() {
            // 1 ano a partir da criação
            const oneYear = new Date();
            oneYear.setFullYear(oneYear.getFullYear() + 1);
            return oneYear;
        }
    },
    lastUsedAt: {
        type: Date,
        default: null
    },
    
    // ===== METADATA =====
    metadata: {
        type: Map,
        of: mongoose.Schema.Types.Mixed,
        default: {}
    },
    
    // ===== HISTÓRICO DE RECARGAS =====
    rechargeHistory: [{
        amount: Number,
        credits: Number,
        method: String, // mpesa, emola, transfer
        reference: String,
        date: {
            type: Date,
            default: Date.now
        }
    }]
}, {
    timestamps: true,
    collection: 'api_keys'
});

// ===== INDEXES =====
apiKeySchema.index({ key: 1 });
apiKeySchema.index({ userId: 1 });
apiKeySchema.index({ email: 1 });
apiKeySchema.index({ active: 1, plan: 1 });
apiKeySchema.index({ expiresAt: 1 });

// ===== MÉTODOS DE INSTÂNCIA =====

/**
 * Verifica se a key está válida
 */
apiKeySchema.methods.isValid = function() {
    if (!this.active) return false;
    if (this.suspended) return false;
    if (this.expiresAt && this.expiresAt < new Date()) return false;
    return true;
};

/**
 * Verifica se tem créditos suficientes
 */
apiKeySchema.methods.hasCredits = function(amount = 1) {
    return this.credits >= amount;
};

/**
 * Consome créditos
 */
apiKeySchema.methods.consumeCredits = async function(amount = 1) {
    if (!this.hasCredits(amount)) {
        throw new Error('Créditos insuficientes');
    }
    
    this.credits -= amount;
    this.totalRequests += 1;
    this.successfulRequests += 1;
    this.lastUsedAt = new Date();
    
    // Reset contador diário se necessário
    const today = new Date().toDateString();
    const lastRequest = this.lastRequestDate ? new Date(this.lastRequestDate).toDateString() : null;
    
    if (today !== lastRequest) {
        this.requestsToday = 0;
    }
    
    this.requestsToday += 1;
    this.lastRequestDate = new Date();
    
    await this.save();
};

/**
 * Adiciona créditos (recarga)
 */
apiKeySchema.methods.addCredits = async function(amount, method, reference) {
    this.credits += amount;
    
    // Adiciona ao histórico
    this.rechargeHistory.push({
        amount: amount,
        credits: amount,
        method: method,
        reference: reference,
        date: new Date()
    });
    
    await this.save();
};

/**
 * Registra falha
 */
apiKeySchema.methods.recordFailure = async function() {
    this.totalRequests += 1;
    this.failedRequests += 1;
    await this.save();
};

/**
 * Atualiza plano
 */
apiKeySchema.methods.upgradePlan = async function(newPlan, creditsToAdd) {
    this.plan = newPlan;
    this.credits += creditsToAdd;
    await this.save();
};

/**
 * Suspende key
 */
apiKeySchema.methods.suspend = async function(reason) {
    this.suspended = true;
    this.suspensionReason = reason;
    await this.save();
};

/**
 * Reativa key
 */
apiKeySchema.methods.unsuspend = async function() {
    this.suspended = false;
    this.suspensionReason = null;
    await this.save();
};

// ===== MÉTODOS ESTÁTICOS =====

/**
 * Busca por key
 */
apiKeySchema.statics.findByKey = function(key) {
    return this.findOne({ key, active: true });
};

/**
 * Busca por usuário
 */
apiKeySchema.statics.findByUser = function(userId) {
    return this.find({ userId, active: true });
};

/**
 * Lista keys expiradas
 */
apiKeySchema.statics.findExpired = function() {
    return this.find({ 
        expiresAt: { $lt: new Date() },
        active: true 
    });
};

// ===== MIDDLEWARE PRE-SAVE =====
apiKeySchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

// ===== VIRTUAL PROPERTIES =====

/**
 * Dias até expiração
 */
apiKeySchema.virtual('daysUntilExpiration').get(function() {
    if (!this.expiresAt) return null;
    const diff = this.expiresAt - new Date();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
});

/**
 * Taxa de sucesso
 */
apiKeySchema.virtual('successRate').get(function() {
    if (this.totalRequests === 0) return 100;
    return ((this.successfulRequests / this.totalRequests) * 100).toFixed(2);
});

module.exports = mongoose.model('ApiKey', apiKeySchema);
