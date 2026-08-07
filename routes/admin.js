// ===== ROUTES/ADMIN.JS =====
// Rotas administrativas da Alauda API
// Protegidas pelo middleware authenticateAdmin — apenas a chave do dono
// (email: eliobrostech3@gmail.com) consegue usar estas rotas.

const express = require('express');
const router = express.Router();
const ApiKey = require('../models/ApiKey');
const authenticateAdmin = require('../middleware/adminAuth');
const response = require('../utils/responseHandler');
const { maskApiKey } = require('../utils/generateKey');

// ===== HELPERS =====

function safeKeyData(key) {
    return {
        id: key._id,
        key: maskApiKey(key.key),
        userId: key.userId,
        userName: key.userName,
        email: key.email,
        phone: key.phone,
        plan: key.plan,
        role: key.role,
        credits: key.credits,
        active: key.active,
        suspended: key.suspended,
        suspensionReason: key.suspensionReason,
        totalRequests: key.totalRequests,
        successfulRequests: key.successfulRequests,
        failedRequests: key.failedRequests,
        requestsToday: key.requestsToday,
        lastUsedAt: key.lastUsedAt,
        createdAt: key.createdAt,
        expiresAt: key.expiresAt,
        successRate: key.successRate
    };
}

/**
 * POST /api/admin/keys/add-credits
 * Adiciona créditos (reqs) a uma API Key.
 * Body: { apiKey: "alauda_live_...", credits: 500, reason?: "bônus" }
 *    OU { email: "cliente@email.com", credits: 500, reason?: "bônus" }
 */
router.post('/keys/add-credits', authenticateAdmin, response.asyncHandler(async (req, res) => {
    const { apiKey, email, credits, reason } = req.body;

    if (!credits || typeof credits !== 'number' || !Number.isFinite(credits) || credits <= 0) {
        return response.validationError(res, [{
            field: 'credits',
            message: 'Informe um valor de créditos válido (número maior que 0)'
        }]);
    }

    const creditsToAdd = Math.floor(Number(credits));

    if (creditsToAdd > 100000) {
        return response.validationError(res, [{
            field: 'credits',
            message: 'Valor máximo por recarga admin: 100.000 créditos'
        }]);
    }

    // Localiza a chave alvo: por chave completa OU por email do dono
    let targetKey = null;

    if (apiKey) {
        targetKey = await ApiKey.findOne({ key: apiKey });
        if (!targetKey) {
            return response.error(res, 'API Key alvo não encontrada', 404);
        }
    } else if (email) {
        // Se informar email, adiciona na chave ATIVA mais recente da pessoa
        targetKey = await ApiKey.findOne({ email: email.toLowerCase(), active: true })
            .sort({ createdAt: -1 });
        if (!targetKey) {
            return response.error(res, `Nenhuma API Key ativa encontrada para: ${email}`, 404);
        }
    } else {
        return response.validationError(res, [{
            field: 'apiKey|email',
            message: 'Informe a apiKey da chave alvo ou o email do dono'
        }]);
    }

    // Aplica créditos usando o método do modelo (registra no histórico)
    await targetKey.addCredits(creditsToAdd, 'admin', reason || `Crédito admin (${req.adminKeyData.email})`);

    console.log(`👑 Admin ${req.adminKeyData.email} adicionou ${creditsToAdd} créditos na chave de ${targetKey.email} (${maskApiKey(targetKey.key)})`);

    return response.success(res, {
        message: `${creditsToAdd} créditos adicionados com sucesso`,
        target: safeKeyData(targetKey),
        credits_added: creditsToAdd,
        credits_total: targetKey.credits,
        reason: reason || null
    });
}));

/**
 * GET /api/admin/keys
 * Lista API Keys (com filtros opcionais: email, plan, ativas/suspensas).
 */
router.get('/keys', authenticateAdmin, response.asyncHandler(async (req, res) => {
    const { email, plan, status, limit = 50 } = req.query;

    const query = {};
    if (email) query.email = email.toLowerCase();
    if (plan) query.plan = plan.toLowerCase();
    if (status === 'active') query.active = true;
    if (status === 'suspended') query.suspended = true;

    const keys = await ApiKey.find(query)
        .sort({ createdAt: -1 })
        .limit(Math.max(1, Math.min(Number(limit) || 50, 200)));

    const total = await ApiKey.countDocuments(query);

    return response.success(res, {
        count: keys.length,
        total,
        keys: keys.map(safeKeyData)
    });
}));

/**
 * GET /api/admin/keys/:keyId
 * Detalhes de uma API Key específica (inclui histórico de recargas).
 */
router.get('/keys/:keyId', authenticateAdmin, response.asyncHandler(async (req, res) => {
    const key = await ApiKey.findById(req.params.keyId);

    if (!key) {
        return response.error(res, 'API Key não encontrada', 404);
    }

    return response.success(res, {
        key: {
            ...safeKeyData(key),
            fullKey: key.active ? key.key : maskApiKey(key.key),
            rechargeHistory: key.rechargeHistory
        }
    });
}));

/**
 * POST /api/admin/keys/:keyId/suspend
 * Suspende uma API Key.
 * Body: { reason: "motivo da suspensão" }
 */
router.post('/keys/:keyId/suspend', authenticateAdmin, response.asyncHandler(async (req, res) => {
    const key = await ApiKey.findById(req.params.keyId);

    if (!key) {
        return response.error(res, 'API Key não encontrada', 404);
    }

    const reason = req.body.reason || 'Suspensa pelo administrador';
    await key.suspend(reason);

    console.log(`👑 Admin ${req.adminKeyData.email} suspendeu a chave de ${key.email}`);

    return response.success(res, {
        message: 'API Key suspensa com sucesso',
        key: safeKeyData(key)
    });
}));

/**
 * POST /api/admin/keys/:keyId/reactivate
 * Reativa uma API Key suspensa.
 */
router.post('/keys/:keyId/reactivate', authenticateAdmin, response.asyncHandler(async (req, res) => {
    const key = await ApiKey.findById(req.params.keyId);

    if (!key) {
        return response.error(res, 'API Key não encontrada', 404);
    }

    await key.unsuspend();

    console.log(`👑 Admin ${req.adminKeyData.email} reativou a chave de ${key.email}`);

    return response.success(res, {
        message: 'API Key reativada com sucesso',
        key: safeKeyData(key)
    });
}));

/**
 * GET /api/admin/me
 * Info da própria chave admin (para validar acesso).
 */
router.get('/me', authenticateAdmin, (req, res) => {
    return response.success(res, {
        admin: true,
        email: req.adminKeyData.email,
        name: req.adminKeyData.userName,
        key: maskApiKey(req.adminKeyData.key),
        role: req.adminKeyData.role
    });
});

module.exports = router;
