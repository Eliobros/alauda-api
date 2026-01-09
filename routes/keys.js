// ===== ROUTES/KEYS.JS =====
// Gerenciamento de API Keys

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { createApiKey, revokeApiKey, maskApiKey } = require('../utils/generateKey');
const ApiKey = require('../models/ApiKey');
const User = require('../models/User');

/**
 * POST /api/keys/generate
 * Gera nova API Key (requer autenticação)
 */
router.post('/generate', authMiddleware, async (req, res) => {
    try {
        const { plan } = req.body;

        // Verifica se já tem key ativa
        const existingKey = await ApiKey.findOne({
            userId: req.user.userId,
            active: true
        });

        if (existingKey) {
            return res.status(400).json({
                success: false,
                error: 'Você já possui uma API Key ativa',
                apiKey: maskApiKey(existingKey.key),
                message: 'Revogue a key existente antes de criar uma nova'
            });
        }

        // Cria nova key
        const result = await createApiKey({
            userId: req.user.userId,
            userName: req.user.name,
            email: req.user.email,
            phone: req.user.phone,
            plan: plan || 'free'
        });

        // Atualiza contador do usuário
        const user = await User.findById(req.user.userId);
        await user.incrementApiKeys();

        console.log(`✅ API Key gerada para: ${req.user.email}`);

        res.status(201).json({
            success: true,
            message: 'API Key criada com sucesso',
            ...result,
            warning: '⚠️ Guarde esta key em local seguro. Ela não será mostrada novamente!'
        });

    } catch (error) {
        console.error('❌ Erro ao gerar API Key:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao gerar API Key',
            message: error.message
        });
    }
});

/**
 * GET /api/keys/me
 * Lista API Keys do usuário autenticado
 */
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const keys = await ApiKey.find({
            userId: req.user.userId
        }).select('-__v').sort({ createdAt: -1 });

        // Mascara as keys para segurança
        const maskedKeys = keys.map(key => ({
            id: key._id,
            key: maskApiKey(key.key),
            fullKey: key.active ? key.key : maskApiKey(key.key), // Mostra completa só se ativa
            plan: key.plan,
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
            daysUntilExpiration: key.daysUntilExpiration,
            successRate: key.successRate
        }));

        res.json({
            success: true,
            count: keys.length,
            keys: maskedKeys
        });

    } catch (error) {
        console.error('❌ Erro ao listar keys:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao listar API Keys'
        });
    }
});

/**
 * GET /api/keys/:keyId
 * Detalhes de uma API Key específica
 */
router.get('/:keyId', authMiddleware, async (req, res) => {
    try {
        const key = await ApiKey.findOne({
            _id: req.params.keyId,
            userId: req.user.userId
        });

        if (!key) {
            return res.status(404).json({
                success: false,
                error: 'API Key não encontrada'
            });
        }

        res.json({
            success: true,
            key: {
                id: key._id,
                key: key.active ? key.key : maskApiKey(key.key),
                plan: key.plan,
                credits: key.credits,
                active: key.active,
                suspended: key.suspended,
                suspensionReason: key.suspensionReason,
                totalRequests: key.totalRequests,
                successfulRequests: key.successfulRequests,
                failedRequests: key.failedRequests,
                requestsToday: key.requestsToday,
                lastUsedAt: key.lastUsedAt,
                lastRequestIP: key.lastRequestIP,
                createdAt: key.createdAt,
                expiresAt: key.expiresAt,
                daysUntilExpiration: key.daysUntilExpiration,
                successRate: key.successRate,
                rechargeHistory: key.rechargeHistory
            }
        });

    } catch (error) {
        console.error('❌ Erro ao buscar key:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao buscar API Key'
        });
    }
});

/**
 * DELETE /api/keys/:keyId
 * Revoga (desativa) uma API Key
 */
router.delete('/:keyId', authMiddleware, async (req, res) => {
    try {
        const key = await ApiKey.findOne({
            _id: req.params.keyId,
            userId: req.user.userId
        });

        if (!key) {
            return res.status(404).json({
                success: false,
                error: 'API Key não encontrada'
            });
        }

        if (!key.active) {
            return res.status(400).json({
                success: false,
                error: 'API Key já está revogada'
            });
        }

        await revokeApiKey(key.key, 'Revogada pelo usuário');

        console.log(`✅ API Key revogada: ${maskApiKey(key.key)}`);

        res.json({
            success: true,
            message: 'API Key revogada com sucesso'
        });

    } catch (error) {
        console.error('❌ Erro ao revogar key:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao revogar API Key'
        });
    }
});

/**
 * GET /api/keys/stats/summary
 * Estatísticas gerais das keys do usuário
 */
router.get('/stats/summary', authMiddleware, async (req, res) => {
    try {
        const keys = await ApiKey.find({
            userId: req.user.userId
        });

        const stats = {
            totalKeys: keys.length,
            activeKeys: keys.filter(k => k.active).length,
            suspendedKeys: keys.filter(k => k.suspended).length,
            totalCredits: keys.reduce((sum, k) => sum + k.credits, 0),
            totalRequests: keys.reduce((sum, k) => sum + k.totalRequests, 0),
            successfulRequests: keys.reduce((sum, k) => sum + k.successfulRequests, 0),
            failedRequests: keys.reduce((sum, k) => sum + k.failedRequests, 0)
        };

        res.json({
            success: true,
            stats
        });

    } catch (error) {
        console.error('❌ Erro ao buscar estatísticas:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao buscar estatísticas'
        });
    }
});

/**
 * GET /api/keys/validate
 * Valida API Key (usado pela MozHost)
 */
/*
router.get('/validate', async (req, res) => {
    try {
        const apiKey = req.headers['x-api-key'];

        if (!apiKey) {
            return res.status(401).json({
                success: false,
                error: 'API Key não fornecida'
            });
        }

        const keyData = await ApiKey.findByKey(apiKey);

        if (!keyData) {
            return res.status(401).json({
                success: false,
                error: 'API Key inválida'
            });
        }

        if (!keyData.isValid()) {
            let errorMsg = 'API Key inválida';
            if (keyData.suspended) {
                errorMsg = keyData.suspensionReason || 'API Key suspensa';
            } else if (keyData.expiresAt && keyData.expiresAt < new Date()) {
                errorMsg = 'API Key expirada';
            }
            return res.status(403).json({
                success: false,
                error: errorMsg
            });
        }

        res.json({
            success: true,
            data: {
                userId: keyData.userId,
                userName: keyData.userName,
                email: keyData.email,
                phone: keyData.phone,
                plan: keyData.plan,
                credits: keyData.credits,
                active: keyData.active,
                suspended: keyData.suspended,
                suspensionReason: keyData.suspensionReason,
                expiresAt: keyData.expiresAt,
                requestsToday: keyData.requestsToday,
                totalRequests: keyData.totalRequests
            }
        });

    } catch (error) {
        console.error('❌ Erro ao validar key:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao validar API Key'
        });
    }
});
*/
module.exports = router;
