// ===== ROUTES/WHATSAPP.JS =====
// Rotas de integração WhatsApp para Alauda API

const express = require('express');
const router = express.Router();
const WhatsappActivation = require('../models/WhatsappActivation');
const ApiKey = require('../models/ApiKey');
const response = require('../utils/responseHandler');

// Custo em créditos por operação
const WHATSAPP_COST = 50;

// ===== DOCUMENTAÇÃO =====
router.get('/info', (req, res) => {
    response.success(res, {
        endpoint: '/api/whatsapp',
        description: 'Integração do Mega-Bot com Alauda API',
        features: [
            'Ativação de números com API Key',
            'Validação de créditos',
            'Consumo de créditos por operação',
            'Sistema de cache para performance'
        ],
        cost: `${WHATSAPP_COST} créditos por operação (detecção de status mention)`,
        usage: {
            activate: {
                method: 'POST',
                endpoint: '/api/whatsapp/activate',
                body: {
                    phone: '258123456789',
                    api_key: 'alauda_live_xyz',
                    group_id: '120363xxxxx@g.us (opcional)',
                    group_name: 'Nome do Grupo (opcional)'
                }
            },
            validate: {
                method: 'POST',
                endpoint: '/api/whatsapp/validate',
                body: {
                    phone: '258123456789'
                }
            },
            consume: {
                method: 'POST',
                endpoint: '/api/whatsapp/consume',
                body: {
                    phone: '258123456789'
                }
            }
        }
    });
});

// ===== ATIVAR NÚMERO =====
router.post('/activate', response.asyncHandler(async (req, res) => {
    try {
        const { phone, api_key, group_id, group_name } = req.body;

        // Validações
        if (!phone || !api_key) {
            return response.validationError(res, [
                { field: 'phone', message: 'Número de telefone é obrigatório' },
                { field: 'api_key', message: 'API Key é obrigatória' }
            ]);
        }

        // Valida formato do telefone
        if (!/^258\d{9}$/.test(phone)) {
            return response.validationError(res, [{
                field: 'phone',
                message: 'Telefone inválido. Use formato: 258XXXXXXXXX'
            }]);
        }

        // Busca a API Key
        const apiKeyData = await ApiKey.findByKey(api_key);

        if (!apiKeyData) {
            return response.error(res, 'API Key inválida ou não encontrada', 404);
        }

        if (!apiKeyData.isValid()) {
            return response.error(res, 'API Key expirada, suspensa ou inativa', 403);
        }

        if (!apiKeyData.hasCredits(WHATSAPP_COST)) {
            return response.insufficientCredits(res, WHATSAPP_COST, apiKeyData.credits);
        }

        // Verifica se já está ativado
        let activation = await WhatsappActivation.findByPhone(phone);

        if (activation) {
            // Já ativado - atualiza API Key se for diferente
            if (activation.apiKey !== api_key) {
                activation.apiKey = api_key;
                activation.groupId = group_id || activation.groupId;
                activation.groupName = group_name || activation.groupName;
                await activation.save();

                return response.success(res, {
                    message: 'Número atualizado com nova API Key',
                    phone: activation.phone,
                    api_key: api_key,
                    credits_available: apiKeyData.credits,
                    activated_at: activation.activatedAt
                });
            }

            return response.success(res, {
                message: 'Número já está ativado',
                phone: activation.phone,
                credits_available: apiKeyData.credits,
                activated_at: activation.activatedAt
            });
        }

        // Cria nova ativação
        activation = new WhatsappActivation({
            phone,
            apiKey: api_key,
            groupId: group_id,
            groupName: group_name,
            isActive: true
        });

        await activation.save();

        return response.created(res, {
            message: 'Número ativado com sucesso!',
            phone: activation.phone,
            api_key: api_key,
            credits_available: apiKeyData.credits,
            activated_at: activation.activatedAt,
            cost_per_operation: WHATSAPP_COST
        }, 'WhatsApp ativado com sucesso');

    } catch (error) {
        console.error('❌ Erro ao ativar WhatsApp:', error);
        return response.error(res, error.message, 500);
    }
}));

// ===== VALIDAR NÚMERO E CRÉDITOS =====
router.post('/validate', response.asyncHandler(async (req, res) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return response.validationError(res, [{
                field: 'phone',
                message: 'Número de telefone é obrigatório'
            }]);
        }

        // Busca ativação
        const activation = await WhatsappActivation.findByPhone(phone);

        if (!activation) {
            return response.error(res, 'Número não ativado. Use !ativar <sua_chave> para ativar.', 404);
        }

        // Busca API Key vinculada
        const apiKeyData = await ApiKey.findByKey(activation.apiKey);

        if (!apiKeyData) {
            return response.error(res, 'API Key vinculada não encontrada', 404);
        }

        if (!apiKeyData.isValid()) {
            return response.error(res, 'API Key expirada, suspensa ou inativa', 403);
        }

        if (!apiKeyData.hasCredits(WHATSAPP_COST)) {
            return response.error(res, 
                `⚠️ *CRÉDITOS INSUFICIENTES*\n\nVocê precisa de ${WHATSAPP_COST} créditos para usar o bot.\nCréditos disponíveis: ${apiKeyData.credits}\n\n💰 Recarregue sua conta para continuar usando!`, 
                402
            );
        }

        return response.success(res, {
            valid: true,
            phone: activation.phone,
            api_key: activation.apiKey,
            credits_available: apiKeyData.credits,
            cost_per_operation: WHATSAPP_COST,
            can_process: true
        });

    } catch (error) {
        console.error('❌ Erro ao validar WhatsApp:', error);
        return response.error(res, error.message, 500);
    }
}));

// ===== CONSUMIR CRÉDITOS =====
router.post('/consume', response.asyncHandler(async (req, res) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return response.validationError(res, [{
                field: 'phone',
                message: 'Número de telefone é obrigatório'
            }]);
        }

        // Busca ativação
        const activation = await WhatsappActivation.findByPhone(phone);

        if (!activation) {
            return response.error(res, 'Número não ativado', 404);
        }

        // Busca API Key
        const apiKeyData = await ApiKey.findByKey(activation.apiKey);

        if (!apiKeyData) {
            return response.error(res, 'API Key não encontrada', 404);
        }

        if (!apiKeyData.hasCredits(WHATSAPP_COST)) {
            return response.insufficientCredits(res, WHATSAPP_COST, apiKeyData.credits);
        }

        // Consome créditos
        await apiKeyData.consumeCredits(WHATSAPP_COST);

        // Registra uso
        await activation.recordUsage(WHATSAPP_COST);

        return response.success(res, {
            success: true,
            message: 'Créditos consumidos com sucesso',
            credits_consumed: WHATSAPP_COST,
            credits_remaining: apiKeyData.credits,
            total_messages: activation.totalMessages,
            total_credits_consumed: activation.totalCreditsConsumed
        });

    } catch (error) {
        console.error('❌ Erro ao consumir créditos:', error);
        return response.error(res, error.message, 500);
    }
}));

// ===== DESATIVAR NÚMERO =====
router.post('/deactivate', response.asyncHandler(async (req, res) => {
    try {
        const { phone, api_key } = req.body;

        if (!phone || !api_key) {
            return response.validationError(res, [
                { field: 'phone', message: 'Número é obrigatório' },
                { field: 'api_key', message: 'API Key é obrigatória' }
            ]);
        }

        const activation = await WhatsappActivation.findByPhone(phone);

        if (!activation) {
            return response.error(res, 'Número não encontrado', 404);
        }

        if (activation.apiKey !== api_key) {
            return response.error(res, 'API Key não corresponde ao número', 403);
        }

        await activation.deactivate();

        return response.success(res, {
            message: 'Número desativado com sucesso',
            phone: activation.phone,
            deactivated_at: activation.deactivatedAt
        });

    } catch (error) {
        console.error('❌ Erro ao desativar WhatsApp:', error);
        return response.error(res, error.message, 500);
    }
}));

// ===== CONSULTAR STATUS =====
router.get('/status/:phone', response.asyncHandler(async (req, res) => {
    try {
        const { phone } = req.params;

        const activation = await WhatsappActivation.findByPhone(phone);

        if (!activation) {
            return response.error(res, 'Número não ativado', 404);
        }

        const apiKeyData = await ApiKey.findByKey(activation.apiKey);

        return response.success(res, {
            phone: activation.phone,
            is_active: activation.isActive,
            credits_available: apiKeyData ? apiKeyData.credits : 0,
            total_messages: activation.totalMessages,
            total_credits_consumed: activation.totalCreditsConsumed,
            activated_at: activation.activatedAt,
            last_used_at: activation.lastUsedAt
        });

    } catch (error) {
        console.error('❌ Erro ao consultar status:', error);
        return response.error(res, error.message, 500);
    }
}));

module.exports = router;
