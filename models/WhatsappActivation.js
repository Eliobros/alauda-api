// ===== MODELS/WHATSAPPACTIVATION.JS =====
// Schema para ativação de WhatsApp na Alauda API

const mongoose = require('mongoose');

const whatsappActivationSchema = new mongoose.Schema({
    // ===== IDENTIFICAÇÃO PRINCIPAL =====
    groupId: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        match: [/^120363\d+@g\.us$/, 'Group ID inválido (formato: 120363xxxxx@g.us)']
    },

    groupName: {
        type: String,
        default: null,
        trim: true
    },

    // ===== VINCULAÇÃO COM API KEY =====
    apiKey: {
        type: String,
        required: true,
        trim: true
    },

    // ===== INFORMAÇÕES ADICIONAIS (OPCIONAL) =====
    botNumber: {
        type: String,
        default: null,
        trim: true,
        validate: {
            validator: function(v) {
                // Se for null ou vazio, aceita
                if (!v) return true;
                // Aceita qualquer número de telefone válido (mínimo 10 dígitos)
                return /^\d{10,15}$/.test(v);
            },
            message: 'Telefone inválido (deve conter entre 10 e 15 dígitos)'
        }
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
whatsappActivationSchema.index({ groupId: 1 });
whatsappActivationSchema.index({ apiKey: 1 });
whatsappActivationSchema.index({ isActive: 1 });
whatsappActivationSchema.index({ botNumber: 1 });

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
 * Busca por Group ID
 */
whatsappActivationSchema.statics.findByGroupId = function(groupId) {
    return this.findOne({ groupId, isActive: true });
};

/**
 * Busca por API Key
 */
whatsappActivationSchema.statics.findByApiKey = function(apiKey) {
    return this.find({ apiKey, isActive: true });
};

/**
 * Busca por número do bot (opcional)
 */
whatsappActivationSchema.statics.findByBotNumber = function(botNumber) {
    return this.find({ botNumber, isActive: true });
};

/**
 * Lista todas ativações ativas
 */
whatsappActivationSchema.statics.findAllActive = function() {
    return this.find({ isActive: true });
};

module.exports = mongoose.model('WhatsappActivation', whatsappActivationSchema);
