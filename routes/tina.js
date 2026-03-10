// ===== ROUTES/TINA.JS =====
// Tina AI Assistant - Chat com IA para Alauda API

const express = require('express');
const router = express.Router();
const authenticateApiKey = require('../middleware/auth');
const response = require('../utils/responseHandler');
const constants = require('../config/constants');
const tinaService = require('../services/tinaService');

/**
 * Valida session_id
 */
function isValidSessionId(sessionId) {
    if (!sessionId || typeof sessionId !== 'string') return false;
    // Aceita: sess_123, user_abc, qualquer string alfanumérica com _ ou -
    return /^[a-zA-Z0-9_-]{3,100}$/.test(sessionId);
}

/**
 * Gera session_id único
 */
function generateSessionId(userId) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `sess_${userId}_${timestamp}_${random}`;
}

// ===== ROTAS =====

router.get('/info', (req, res) => {
    response.success(res, {
        endpoint: '/api/tina',
        description: 'Assistente de IA conversacional - Tina',
        features: [
            'Conversas contextualizadas com histórico',
            'Múltiplas sessões simultâneas por usuário',
            'Histórico persistente no banco de dados',
            'Gerenciamento de conversas (listar, deletar)',
            'Respostas em português otimizadas',
            'Powered by Gemini 2.5 Flash'
        ],
        limitations: [
            'Máximo de 10.000 caracteres por mensagem',
            'Histórico limitado às últimas 20 mensagens',
            'Sessões inativas são removidas após 2 horas'
        ],
        cost: `${constants.COSTS.TINA_MESSAGE || 5} crédito(s) por mensagem`,
        usage: {
            new_session: {
                method: 'POST',
                endpoint: '/api/tina/session/new',
                headers: {
                    'X-API-Key': 'sua_api_key_aqui',
                    'Content-Type': 'application/json'
                },
                body: {
                    session_name: 'Minha conversa (opcional)'
                }
            },
            send_message: {
                method: 'POST',
                endpoint: '/api/tina/chat',
                headers: {
                    'X-API-Key': 'sua_api_key_aqui',
                    'Content-Type': 'application/json'
                },
                body: {
                    session_id: 'sess_123...',
                    message: 'Olá, Tina!'
                }
            },
            list_sessions: {
                method: 'GET',
                endpoint: '/api/tina/sessions',
                headers: {
                    'X-API-Key': 'sua_api_key_aqui'
                }
            },
            get_history: {
                method: 'GET',
                endpoint: '/api/tina/history/:session_id',
                headers: {
                    'X-API-Key': 'sua_api_key_aqui'
                }
            },
            delete_session: {
                method: 'DELETE',
                endpoint: '/api/tina/session/:session_id',
                headers: {
                    'X-API-Key': 'sua_api_key_aqui'
                }
            }
        }
    });
});

// ===== NOVA SESSÃO =====
router.post('/session/new', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { session_name } = req.body;
        const userId = req.apiKeyData.userId || req.apiKeyData._id.toString();

        console.log('🆕 Criando nova sessão para user:', userId);

        // Gerar session_id único
        const sessionId = generateSessionId(userId);

        // Criar sessão no MySQL
        await tinaService.getOrCreateSession(
            sessionId, 
            userId, 
            session_name || 'Nova Conversa'
        );

        console.log('✅ Sessão criada:', sessionId);

        // Log de sucesso
        await req.logSuccess({
            case: 'tina_new_session',
            session_id: sessionId,
            session_name: session_name || null
        });

        return response.success(res, {
            session_id: sessionId,
            session_name: session_name || 'Nova Conversa',
            message: 'Sessão criada com sucesso! Envie sua primeira mensagem.',
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro ao criar sessão:', error.message);
        await req.logError(500, error.message, { case: 'tina_new_session' });
        return response.error(res, error.message, 500);
    }
}));

// ===== ENVIAR MENSAGEM =====
router.post('/chat', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { session_id, message } = req.body;
        const userId = req.apiKeyData.userId || req.apiKeyData._id.toString();

        // Validações
        if (!session_id) {
            return response.validationError(res, [{
                field: 'session_id',
                message: 'session_id é obrigatório'
            }]);
        }

        if (!isValidSessionId(session_id)) {
            return response.validationError(res, [{
                field: 'session_id',
                message: 'session_id inválido (use apenas letras, números, _ e -)'
            }]);
        }

        if (!message || !message.trim()) {
            return response.validationError(res, [{
                field: 'message',
                message: 'Mensagem é obrigatória'
            }]);
        }

        if (message.length > 10000) {
            return response.validationError(res, [{
                field: 'message',
                message: 'Mensagem muito longa (máximo 10.000 caracteres)'
            }]);
        }

        console.log('💬 Tina recebeu mensagem:');
        console.log('- User:', userId);
        console.log('- Session:', session_id);
        console.log('- Message:', message.substring(0, 100) + (message.length > 100 ? '...' : ''));

        // Enviar para Tina (MySQL)
        const result = await tinaService.sendMessage(session_id, message, userId);

        console.log('✅ Tina respondeu!');
        console.log('- Tokens usados:', result.tokensUsed);
        console.log('- Resposta:', result.response.substring(0, 100) + '...');

        // Log de sucesso
        await req.logSuccess({
            case: 'tina_chat',
            session_id: session_id,
            message_length: message.length,
            response_length: result.response.length,
            tokens_used: result.tokensUsed,
            model: result.model
        });

        return response.success(res, {
            session_id: session_id,
            message: result.response,
            tokens_used: result.tokensUsed,
            model: result.model,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro no chat Tina:', error.message);
        await req.logError(500, error.message, { 
            case: 'tina_chat',
            session_id: req.body.session_id 
        });

        if (error.message.includes('não configurada')) {
            return response.error(res, 'Serviço temporariamente indisponível', 503);
        }

        if (error.message.includes('Acesso negado')) {
            return response.error(res, 'Você não tem acesso a esta sessão', 403);
        }

        if (error.message.includes('limite')) {
            return response.error(res, error.message, 429);
        }

        return response.error(res, error.message, 500);
    }
}));

// ===== LISTAR SESSÕES DO USUÁRIO =====
router.get('/sessions', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const userId = req.apiKeyData.userId || req.apiKeyData._id.toString();
        const limit = parseInt(req.query.limit) || 10;

        console.log('📋 Listando sessões do user:', userId);

        // Buscar do MySQL
        const sessions = await tinaService.getUserSessions(userId, limit);

        console.log('✅ Encontradas', sessions.length, 'sessões');

        // Log de sucesso
        await req.logSuccess({
            case: 'tina_list_sessions',
            sessions_count: sessions.length
        });

        return response.success(res, {
            sessions: sessions.map(s => ({
                session_id: s.id,
                session_name: s.session_name || 'Conversa sem nome',
                created_at: s.created_at,
                last_access: s.last_access,
                message_count: s.message_count,
                total_tokens: s.total_tokens
            })),
            total: sessions.length,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro ao listar sessões:', error.message);
        await req.logError(500, error.message, { case: 'tina_list_sessions' });
        return response.error(res, error.message, 500);
    }
}));

// ===== BUSCAR HISTÓRICO DE UMA SESSÃO =====
router.get('/history/:session_id', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { session_id } = req.params;
        const userId = req.apiKeyData.userId || req.apiKeyData._id.toString();

        if (!isValidSessionId(session_id)) {
            return response.validationError(res, [{
                field: 'session_id',
                message: 'session_id inválido'
            }]);
        }

        console.log('📜 Buscando histórico da sessão:', session_id);

        // Buscar do MySQL (valida ownership)
        const history = await tinaService.getFullHistory(session_id, userId);

        console.log('✅ Histórico encontrado:', history.length, 'mensagens');

        // Log de sucesso
        await req.logSuccess({
            case: 'tina_get_history',
            session_id: session_id,
            messages_count: history.length
        });

        return response.success(res, {
            session_id: session_id,
            messages: history.map(m => ({
                role: m.role,
                content: m.content,
                created_at: m.created_at,
                tokens_used: m.tokens_used
            })),
            total_messages: history.length,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro ao buscar histórico:', error.message);
        await req.logError(500, error.message, { 
            case: 'tina_get_history',
            session_id: req.params.session_id 
        });

        if (error.message.includes('Acesso negado')) {
            return response.error(res, 'Você não tem acesso a esta sessão', 403);
        }

        return response.error(res, error.message, 500);
    }
}));

// ===== DELETAR SESSÃO =====
router.delete('/session/:session_id', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { session_id } = req.params;
        const userId = req.apiKeyData.userId || req.apiKeyData._id.toString();

        if (!isValidSessionId(session_id)) {
            return response.validationError(res, [{
                field: 'session_id',
                message: 'session_id inválido'
            }]);
        }

        console.log('🗑️  Deletando sessão:', session_id);

        // Deletar do MySQL (valida ownership)
        const result = await tinaService.deleteSession(session_id, userId);

        console.log('✅ Sessão deletada com sucesso');

        // Log de sucesso
        await req.logSuccess({
            case: 'tina_delete_session',
            session_id: session_id
        });

        return response.success(res, {
            message: 'Sessão deletada com sucesso',
            session_id: session_id,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro ao deletar sessão:', error.message);
        await req.logError(500, error.message, { 
            case: 'tina_delete_session',
            session_id: req.params.session_id 
        });

        if (error.message.includes('Acesso negado')) {
            return response.error(res, 'Você não tem acesso a esta sessão', 403);
        }

        return response.error(res, error.message, 500);
    }
}));

// ===== STATS DA SESSÃO =====
router.get('/stats/:session_id', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { session_id } = req.params;
        const userId = req.apiKeyData.userId || req.apiKeyData._id.toString();

        if (!isValidSessionId(session_id)) {
            return response.validationError(res, [{
                field: 'session_id',
                message: 'session_id inválido'
            }]);
        }

        console.log('📊 Buscando stats da sessão:', session_id);

        // Verificar ownership
        const history = await tinaService.getFullHistory(session_id, userId);
        
        // Buscar stats
        const stats = await tinaService.getSessionStats(session_id);

        console.log('✅ Stats encontradas');

        // Log de sucesso
        await req.logSuccess({
            case: 'tina_session_stats',
            session_id: session_id
        });

        return response.success(res, {
            session_id: session_id,
            stats: stats,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro ao buscar stats:', error.message);
        await req.logError(500, error.message, { 
            case: 'tina_session_stats',
            session_id: req.params.session_id 
        });

        if (error.message.includes('Acesso negado')) {
            return response.error(res, 'Você não tem acesso a esta sessão', 403);
        }

        return response.error(res, error.message, 500);
    }
}));

module.exports = router;
