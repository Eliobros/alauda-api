// ===== UTILS/GENERATEKEY.JS =====
// Gerador de API Keys para Alauda API

const crypto = require('crypto');
const ApiKey = require('../models/ApiKey');

/**
 * Gera uma API key única
 * Formato: alauda_live_[64 caracteres hex]
 */
function generateApiKey() {
    const randomBytes = crypto.randomBytes(32); // 32 bytes = 64 hex chars
    const randomString = randomBytes.toString('hex');
    
    return `alauda_live_${randomString}`;
}

/**
 * Gera API key e garante que é única no banco
 */
async function generateUniqueApiKey(maxAttempts = 5) {
    for (let i = 0; i < maxAttempts; i++) {
        const key = generateApiKey();
        
        // Verifica se já existe
        const existing = await ApiKey.findOne({ key });
        
        if (!existing) {
            return key;
        }
        
        console.warn(`⚠️  Key duplicada gerada (tentativa ${i + 1}/${maxAttempts}), gerando nova...`);
    }
    
    throw new Error('Não foi possível gerar uma API key única após múltiplas tentativas');
}

/**
 * Cria nova API key no banco
 */
async function createApiKey(userData) {
    try {
        // Validações
        if (!userData.userName) {
            throw new Error('userName é obrigatório');
        }
        if (!userData.email) {
            throw new Error('email é obrigatório');
        }
        if (!userData.userId) {
            throw new Error('userId é obrigatório');
        }
        
        // Gera key única
        const key = await generateUniqueApiKey();
        
        // Define plano e créditos
        const plan = userData.plan || 'free';
        const credits = getInitialCredits(plan);
        
        // Cria no banco
        const apiKey = new ApiKey({
            key: key,
            userId: userData.userId,
            userName: userData.userName,
            email: userData.email,
            phone: userData.phone || null,
            plan: plan,
            credits: credits,
            active: true,
            metadata: userData.metadata || {}
        });
        
        await apiKey.save();
        
        console.log(`✅ API key criada: ${key.substring(0, 20)}... para ${userData.userName}`);
        
        return {
            success: true,
            apiKey: key,
            user: {
                userId: apiKey.userId,
                userName: apiKey.userName,
                email: apiKey.email,
                plan: apiKey.plan,
                credits: apiKey.credits
            },
            expiresAt: apiKey.expiresAt,
            createdAt: apiKey.createdAt
        };
        
    } catch (error) {
        console.error('❌ Erro ao criar API key:', error.message);
        throw error;
    }
}

/**
 * Retorna créditos iniciais baseado no plano
 */
function getInitialCredits(plan) {
    const credits = {
        'free': 100,
        'basic': 5000,
        'pro': 20000,
        'premium': 100000
    };
    
    return credits[plan.toLowerCase()] || 100;
}

/**
 * Valida formato de API key
 */
function isValidKeyFormat(key) {
    if (!key || typeof key !== 'string') return false;
    
    // Formato: alauda_live_[64 hex chars]
    const pattern = /^alauda_live_[a-f0-9]{64}$/;
    return pattern.test(key);
}

/**
 * Mascara API key para exibição
 * Exemplo: alauda_live_abc123...xyz789
 */
function maskApiKey(key) {
    if (!key || key.length < 20) return 'invalid';
    
    const prefix = key.substring(0, 18); // alauda_live_ + 6 chars
    const suffix = key.substring(key.length - 6);
    
    return `${prefix}...${suffix}`;
}

/**
 * Gera múltiplas keys de uma vez (útil para testes)
 */
async function generateBulkKeys(count, userData) {
    const keys = [];
    
    for (let i = 0; i < count; i++) {
        try {
            const result = await createApiKey({
                ...userData,
                userName: `${userData.userName}_${i + 1}`,
                userId: `${userData.userId}_${i + 1}`,
                email: userData.email.replace('@', `+${i + 1}@`)
            });
            
            keys.push(result);
        } catch (error) {
            console.error(`❌ Erro ao gerar key ${i + 1}:`, error.message);
        }
    }
    
    return keys;
}

/**
 * Revoga (desativa) uma API key
 */
async function revokeApiKey(key, reason = 'Revogada pelo administrador') {
    try {
        const apiKey = await ApiKey.findOne({ key });
        
        if (!apiKey) {
            throw new Error('API key não encontrada');
        }
        
        apiKey.active = false;
        apiKey.suspended = true;
        apiKey.suspensionReason = reason;
        
        await apiKey.save();
        
        console.log(`✅ API key revogada: ${maskApiKey(key)}`);
        
        return {
            success: true,
            message: 'API key revogada com sucesso',
            key: maskApiKey(key)
        };
        
    } catch (error) {
        console.error('❌ Erro ao revogar API key:', error.message);
        throw error;
    }
}

/**
 * Reativa uma API key suspensa
 */
async function reactivateApiKey(key) {
    try {
        const apiKey = await ApiKey.findOne({ key });
        
        if (!apiKey) {
            throw new Error('API key não encontrada');
        }
        
        apiKey.active = true;
        apiKey.suspended = false;
        apiKey.suspensionReason = null;
        
        await apiKey.save();
        
        console.log(`✅ API key reativada: ${maskApiKey(key)}`);
        
        return {
            success: true,
            message: 'API key reativada com sucesso',
            key: maskApiKey(key)
        };
        
    } catch (error) {
        console.error('❌ Erro ao reativar API key:', error.message);
        throw error;
    }
}

module.exports = {
    generateApiKey,
    generateUniqueApiKey,
    createApiKey,
    isValidKeyFormat,
    maskApiKey,
    generateBulkKeys,
    revokeApiKey,
    reactivateApiKey,
    getInitialCredits
};
