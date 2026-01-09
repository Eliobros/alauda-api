// routes/validate.js
const express = require('express');
const router = express.Router();
const ApiKey = require('../models/ApiKey');

/**
 * GET /api/validate/key
 * Valida uma API Key (usado pela MozHost)
 * Header: X-API-Key
 */
router.get('/key', async (req, res) => {
    try {
        const apiKey = req.headers['x-api-key'];

        if (!apiKey) {
            return res.status(401).json({
                success: false,
                error: 'API Key não fornecida'
            });
        }

        // Busca key no banco
        const keyData = await ApiKey.findByKey(apiKey);

        if (!keyData) {
            return res.status(401).json({
                success: false,
                error: 'API Key inválida'
            });
        }

        // Verifica se está válida
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

        // Retorna dados do usuário
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

module.exports = router;
