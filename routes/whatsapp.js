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
            'Ativação de grupos com API Key',
            'Validação de créditos por grupo',
            'Consumo de créditos por operação',
            'Sistema de cache para performance'
        ],
        cost: `${WHATSAPP_COST} créditos por operação (detecção de status mention)`,
        usage: {
            activate: {
                method: 'POST',
                endpoint: '/api/whatsapp/activate',
                body: {
                    group_id: '120363xxxxx@g.us',
                    api_key: 'alauda_live_xyz',
                    group_name: 'Nome do Grupo (opcional)',
                    bot_number: '258123456789 (opcional)'
                }
            },
            validate: {
                method: 'POST',
                endpoint: '/api/whatsapp/validate',
                body: {
                    group_id: '120363xxxxx@g.us'
                }
            },
            consume: {
                method: 'POST',
                endpoint: '/api/whatsapp/consume',
                body: {
                    group_id: '120363xxxxx@g.us'
                }
            }
        }
    });
});

// ===== ATIVAR GRUPO =====
router.post('/activate', response.asyncHandler(async (req, res) => {
    try {
        const { group_id, api_key, group_name, bot_number } = req.body;

        // Validações
        if (!group_id || !api_key) {
            return response.validationError(res, [
                { field: 'group_id', message: 'ID do grupo é obrigatório' },
                { field: 'api_key', message: 'API Key é obrigatória' }
            ]);
        }

        // Valida formato do group_id
        if (!/^120363\d+@g\.us$/.test(group_id)) {
            return response.validationError(res, [{
                field: 'group_id',
                message: 'Group ID inválido. Use formato: 120363xxxxx@g.us'
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

        // Verifica se grupo já está ativado
        let activation = await WhatsappActivation.findByGroupId(group_id);

        if (activation) {
            // Já ativado - atualiza API Key se for diferente
            if (activation.apiKey !== api_key) {
                activation.apiKey = api_key;
                activation.groupName = group_name || activation.groupName;
                activation.botNumber = bot_number || activation.botNumber;
                await activation.save();

                return response.success(res, {
                    message: '✅ Grupo atualizado com nova API Key',
                    group_id: activation.groupId,
                    group_name: activation.groupName,
                    api_key: api_key,
                    credits_available: apiKeyData.credits,
                    activated_at: activation.activatedAt
                });
            }

            return response.success(res, {
                message: '✅ Grupo já está ativado',
                group_id: activation.groupId,
                group_name: activation.groupName,
                credits_available: apiKeyData.credits,
                activated_at: activation.activatedAt
            });
        }

        // Cria nova ativação
        activation = new WhatsappActivation({
            groupId: group_id,
            groupName: group_name,
            botNumber: bot_number,
            apiKey: api_key,
            isActive: true
        });

        await activation.save();

        return response.created(res, {
            message: '✅ Grupo ativado com sucesso!',
            group_id: activation.groupId,
            group_name: activation.groupName,
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

// ===== VALIDAR GRUPO E CRÉDITOS =====
router.post('/validate', response.asyncHandler(async (req, res) => {
    try {
        const { group_id } = req.body;

        if (!group_id) {
            return response.validationError(res, [{
                field: 'group_id',
                message: 'ID do grupo é obrigatório'
            }]);
        }

        // Busca ativação
        const activation = await WhatsappActivation.findByGroupId(group_id);

        if (!activation) {
            return response.error(res, 
                '❌ *Grupo não ativado*\n\nUse *!ativar <sua_chave>* para ativar o bot neste grupo.', 
                404
            );
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
            group_id: activation.groupId,
            group_name: activation.groupName,
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
        const { group_id } = req.body;

        if (!group_id) {
            return response.validationError(res, [{
                field: 'group_id',
                message: 'ID do grupo é obrigatório'
            }]);
        }

        // Busca ativação
        const activation = await WhatsappActivation.findByGroupId(group_id);

        if (!activation) {
            return response.error(res, 'Grupo não ativado', 404);
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
            group_id: activation.groupId,
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

// ===== DESATIVAR GRUPO =====
router.post('/deactivate', response.asyncHandler(async (req, res) => {
    try {
        const { group_id, api_key } = req.body;

        if (!group_id || !api_key) {
            return response.validationError(res, [
                { field: 'group_id', message: 'ID do grupo é obrigatório' },
                { field: 'api_key', message: 'API Key é obrigatória' }
            ]);
        }

        const activation = await WhatsappActivation.findByGroupId(group_id);

        if (!activation) {
            return response.error(res, 'Grupo não encontrado', 404);
        }

        if (activation.apiKey !== api_key) {
            return response.error(res, 'API Key não corresponde ao grupo', 403);
        }

        await activation.deactivate();

        return response.success(res, {
            message: 'Grupo desativado com sucesso',
            group_id: activation.groupId,
            deactivated_at: activation.deactivatedAt
        });

    } catch (error) {
        console.error('❌ Erro ao desativar WhatsApp:', error);
        return response.error(res, error.message, 500);
    }
}));

// ===== CONSULTAR STATUS =====
router.get('/status/:group_id', response.asyncHandler(async (req, res) => {
    try {
        const { group_id } = req.params;

        const activation = await WhatsappActivation.findByGroupId(group_id);

        if (!activation) {
            return response.error(res, 'Grupo não ativado', 404);
        }

        const apiKeyData = await ApiKey.findByKey(activation.apiKey);

        return response.success(res, {
            group_id: activation.groupId,
            group_name: activation.groupName,
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
