// ===== MODELS/WHATSAPPACTIVATION.JS =====
// Schema para ativação de WhatsApp na Alauda API

const mongoose = require('mongoose');

const whatsappActivationSchema = new mongoose.Schema({
    // ===== IDENTIFICAÇÃO =====
    phone: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        match: [/^258\d{9}$/, 'Telefone inválido (formato: 258XXXXXXXXX)']
    },

    // ===== VINCULAÇÃO COM API KEY =====
    apiKey: {
        type: String,
        required: true,
        trim: true
    },

    // ===== INFORMAÇÕES DO GRUPO (OPCIONAL) =====
    groupId: {
        type: String,
        default: null,
        trim: true
    },
    groupName: {
        type: String,
        default: null,
        trim: true
    },

    // ===== STATUS =====
    isActive: {
        type: Boolean,
        default: true
    },

    // ===== ESTATÍSTICAS =====
    totalMessages: {
        type: Number,
        default: 0,
        min: 0
    },
    totalCreditsConsumed: {
        type: Number,
        default: 0,
        min: 0
    },

    // ===== DATAS =====
    activatedAt: {
        type: Date,
        default: Date.now,
        immutable: true
    },
    lastUsedAt: {
        type: Date,
        default: null
    },
    deactivatedAt: {
        type: Date,
        default: null
    },

    // ===== METADATA =====
    metadata: {
        type: Map,
        of: mongoose.Schema.Types.Mixed,
        default: {}
    }
}, {
    timestamps: true,
    collection: 'whatsapp_activations'
});

// ===== INDEXES =====
whatsappActivationSchema.index({ phone: 1 });
whatsappActivationSchema.index({ apiKey: 1 });
whatsappActivationSchema.index({ isActive: 1 });

// ===== MÉTODOS DE INSTÂNCIA =====

/**
 * Registra uso
 */
whatsappActivationSchema.methods.recordUsage = async function(creditsConsumed = 50) {
    this.totalMessages += 1;
    this.totalCreditsConsumed += creditsConsumed;
    this.lastUsedAt = new Date();
    await this.save();
};

/**
 * Desativa
 */
whatsappActivationSchema.methods.deactivate = async function() {
    this.isActive = false;
    this.deactivatedAt = new Date();
    await this.save();
};

/**
 * Reativa
 */
whatsappActivationSchema.methods.reactivate = async function() {
    this.isActive = true;
    this.deactivatedAt = null;
    await this.save();
};

// ===== MÉTODOS ESTÁTICOS =====

/**
 * Busca por telefone
 */
whatsappActivationSchema.statics.findByPhone = function(phone) {
    return this.findOne({ phone, isActive: true });
};

/**
 * Busca por API Key
 */
whatsappActivationSchema.statics.findByApiKey = function(apiKey) {
    return this.find({ apiKey, isActive: true });
};

/**
 * Lista todas ativações ativas
 */
whatsappActivationSchema.statics.findAllActive = function() {
    return this.find({ isActive: true });
};

module.exports = mongoose.model('WhatsappActivation', whatsappActivationSchema);
