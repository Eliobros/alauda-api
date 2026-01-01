// ===== MODELS/PAYMENT.JS =====
// Schema de Pagamentos para Alauda API

const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    // ===== IDENTIFICAÇÃO =====
    payment_id: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    
    // ===== PROVEDOR =====
    provider: {
        type: String,
        enum: ['mercadopago', 'mpesa', 'emola'],
        required: true,
        lowercase: true,
        index: true
    },

    // ===== DADOS DO USUÁRIO =====
    userId: {
        type: String,
        required: true,
        index: true
    },
    apiKey: {
        type: String,
        required: true,
        index: true
    },
    email: {
        type: String,
        lowercase: true,
        trim: true
    },
    phone: {
        type: String,
        trim: true
    },

    // ===== VALORES =====
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    currency: {
        type: String,
        default: 'MZN',
        enum: ['MZN', 'BRL', 'USD']
    },
    credits_to_add: {
        type: Number,
        required: true,
        min: 0,
        default: 0
    },

    // ===== STATUS =====
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'cancelled', 'refunded', 'in_process'],
        default: 'pending',
        index: true
    },
    status_detail: {
        type: String,
        default: null
    },

    // ===== DADOS ESPECÍFICOS POR PROVEDOR =====
    
    // MercadoPago
    mercadopago_data: {
        preference_id: String,
        init_point: String,
        external_reference: String,
        collector_id: Number,
        installments: Number,
        payment_method_id: String,
        payment_type_id: String
    },

    // M-Pesa / E-Mola (PayMoz)
    paymoz_data: {
        transaction_id: String,
        conversation_id: String,
        third_party_reference: String,
        response_code: String,
        response_desc: String,
        numero_celular: String
    },

    // ===== WEBHOOK & TRACKING =====
    webhook_received: {
        type: Boolean,
        default: false
    },
    webhook_data: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },
    webhook_received_at: {
        type: Date,
        default: null
    },

    // ===== PROCESSAMENTO =====
    processed: {
        type: Boolean,
        default: false,
        index: true
    },
    processed_at: {
        type: Date,
        default: null
    },
    credits_added: {
        type: Boolean,
        default: false
    },
    credits_added_at: {
        type: Date,
        default: null
    },

    // ===== METADATA =====
    description: {
        type: String,
        default: 'Compra de créditos Alauda API'
    },
    ip_address: {
        type: String,
        default: null
    },
    user_agent: {
        type: String,
        default: null
    },
    metadata: {
        type: Map,
        of: mongoose.Schema.Types.Mixed,
        default: {}
    },

    // ===== DATAS =====
    created_at: {
        type: Date,
        default: Date.now,
        immutable: true,
        index: true
    },
    updated_at: {
        type: Date,
        default: Date.now
    },
    approved_at: {
        type: Date,
        default: null
    },
    expires_at: {
        type: Date,
        default: function() {
            // Expira em 24 horas
            return new Date(Date.now() + 24 * 60 * 60 * 1000);
        }
    }
}, {
    timestamps: true,
    collection: 'payments'
});

// ===== INDEXES =====
paymentSchema.index({ payment_id: 1, provider: 1 });
paymentSchema.index({ userId: 1, status: 1 });
paymentSchema.index({ apiKey: 1, created_at: -1 });
paymentSchema.index({ status: 1, processed: 1 });
paymentSchema.index({ created_at: -1 });

// ===== MÉTODOS DE INSTÂNCIA =====

/**
 * Marca pagamento como aprovado
 */
paymentSchema.methods.approve = async function(webhookData = null) {
    this.status = 'approved';
    this.approved_at = new Date();
    
    if (webhookData) {
        this.webhook_received = true;
        this.webhook_data = webhookData;
        this.webhook_received_at = new Date();
    }
    
    await this.save();
};

/**
 * Processa pagamento e adiciona créditos
 */
paymentSchema.methods.processPayment = async function() {
    if (this.processed) {
        throw new Error('Pagamento já foi processado');
    }
    
    if (this.status !== 'approved') {
        throw new Error('Apenas pagamentos aprovados podem ser processados');
    }

    // Buscar a API Key do usuário
    const ApiKey = mongoose.model('ApiKey');
    const apiKeyDoc = await ApiKey.findOne({ key: this.apiKey });

    if (!apiKeyDoc) {
        throw new Error('API Key não encontrada');
    }

    // Adicionar créditos
    await apiKeyDoc.addCredits(
        this.credits_to_add,
        this.provider,
        this.payment_id
    );

    // Marcar como processado
    this.processed = true;
    this.processed_at = new Date();
    this.credits_added = true;
    this.credits_added_at = new Date();

    await this.save();

    return {
        success: true,
        credits_added: this.credits_to_add,
        new_balance: apiKeyDoc.credits
    };
};

/**
 * Cancela pagamento
 */
paymentSchema.methods.cancel = async function(reason = null) {
    this.status = 'cancelled';
    if (reason) {
        this.status_detail = reason;
    }
    await this.save();
};

/**
 * Rejeita pagamento
 */
paymentSchema.methods.reject = async function(reason = null) {
    this.status = 'rejected';
    if (reason) {
        this.status_detail = reason;
    }
    await this.save();
};

/**
 * Verifica se pagamento está expirado
 */
paymentSchema.methods.isExpired = function() {
    return this.expires_at && this.expires_at < new Date();
};

/**
 * Verifica se pode ser processado
 */
paymentSchema.methods.canProcess = function() {
    return (
        this.status === 'approved' &&
        !this.processed &&
        !this.isExpired()
    );
};

// ===== MÉTODOS ESTÁTICOS =====

/**
 * Cria novo pagamento
 */
paymentSchema.statics.createPayment = async function(data) {
    const payment = new this({
        payment_id: data.payment_id,
        provider: data.provider,
        userId: data.userId,
        apiKey: data.apiKey,
        email: data.email,
        phone: data.phone,
        amount: data.amount,
        currency: data.currency || 'MZN',
        credits_to_add: data.credits_to_add,
        description: data.description,
        ip_address: data.ip_address,
        user_agent: data.user_agent,
        mercadopago_data: data.mercadopago_data,
        paymoz_data: data.paymoz_data,
        metadata: data.metadata
    });

    await payment.save();
    return payment;
};

/**
 * Busca pagamento por ID e provedor
 */
paymentSchema.statics.findByPaymentId = function(payment_id, provider = null) {
    const query = { payment_id };
    if (provider) {
        query.provider = provider;
    }
    return this.findOne(query);
};

/**
 * Lista pagamentos de um usuário
 */
paymentSchema.statics.findByUser = function(userId, options = {}) {
    const { status, limit = 50, skip = 0 } = options;
    
    const query = { userId };
    if (status) {
        query.status = status;
    }

    return this.find(query)
        .sort({ created_at: -1 })
        .limit(limit)
        .skip(skip);
};

/**
 * Lista pagamentos pendentes de processamento
 */
paymentSchema.statics.findPendingToProcess = function() {
    return this.find({
        status: 'approved',
        processed: false,
        expires_at: { $gt: new Date() }
    }).sort({ approved_at: 1 });
};

/**
 * Estatísticas de pagamentos
 */
paymentSchema.statics.getStats = async function(userId = null) {
    const match = userId ? { userId } : {};

    const stats = await this.aggregate([
        { $match: match },
        {
            $group: {
                _id: '$status',
                count: { $sum: 1 },
                total_amount: { $sum: '$amount' },
                total_credits: { $sum: '$credits_to_add' }
            }
        }
    ]);

    return stats;
};

// ===== MIDDLEWARE PRE-SAVE =====
paymentSchema.pre('save', function(next) {
    this.updated_at = new Date();
    next();
});

// ===== VIRTUAL PROPERTIES =====

/**
 * Status formatado
 */
paymentSchema.virtual('status_formatted').get(function() {
    const statusMap = {
        'pending': 'Pendente',
        'approved': 'Aprovado',
        'rejected': 'Rejeitado',
        'cancelled': 'Cancelado',
        'refunded': 'Reembolsado',
        'in_process': 'Processando'
    };
    return statusMap[this.status] || this.status;
});

/**
 * Tempo desde criação
 */
paymentSchema.virtual('age_minutes').get(function() {
    return Math.floor((Date.now() - this.created_at) / 1000 / 60);
});

module.exports = mongoose.model('Payment', paymentSchema);
