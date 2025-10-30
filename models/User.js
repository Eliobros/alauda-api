// ===== MODELS/USER.JS =====
// Schema de Usuários para Alauda API

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    // ===== INFORMAÇÕES BÁSICAS =====
    name: {
        type: String,
        required: [true, 'Nome é obrigatório'],
        trim: true,
        minlength: [3, 'Nome deve ter pelo menos 3 caracteres'],
        maxlength: [100, 'Nome deve ter no máximo 100 caracteres']
    },
    email: {
        type: String,
        required: [true, 'Email é obrigatório'],
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^\S+@\S+\.\S+$/, 'Email inválido']
    },
    password: {
        type: String,
        required: [true, 'Senha é obrigatória'],
        minlength: [6, 'Senha deve ter pelo menos 6 caracteres']
    },
    phone: {
        type: String,
        trim: true,
        match: [/^258\d{9}$/, 'Telefone deve estar no formato: 258XXXXXXXXX']
    },

    // ===== STATUS =====
    active: {
        type: Boolean,
        default: true
    },
    verified: {
        type: Boolean,
        default: false
    },
    verificationToken: {
        type: String,
        default: null
    },

    // ===== ESTATÍSTICAS =====
    totalApiKeys: {
        type: Number,
        default: 0
    },
    lastLogin: {
        type: Date,
        default: null
    },
    loginCount: {
        type: Number,
        default: 0
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
    }
}, {
    timestamps: true,
    collection: 'users'
});

// ===== INDEXES =====
userSchema.index({ email: 1 });
userSchema.index({ active: 1 });

// ===== MÉTODOS DE INSTÂNCIA =====

/**
 * Registra login
 */
userSchema.methods.recordLogin = async function() {
    this.lastLogin = new Date();
    this.loginCount += 1;
    await this.save();
};

/**
 * Incrementa contador de API Keys
 */
userSchema.methods.incrementApiKeys = async function() {
    this.totalApiKeys += 1;
    await this.save();
};

// ===== MIDDLEWARE PRE-SAVE =====
userSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

// ===== REMOVER SENHA DO JSON =====
userSchema.methods.toJSON = function() {
    const obj = this.toObject();
    delete obj.password;
    delete obj.verificationToken;
    return obj;
};

module.exports = mongoose.model('User', userSchema);
