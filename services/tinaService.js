// ===== SERVICES/TINASERVICE.JS =====
// Serviço da Tina IA - Integração com Gemini + MySQL

const { GoogleGenerativeAI } = require('@google/generative-ai');
const TINA_INSTRUCTION = require('../config/tina-instruction');
const TinaSession = require('../models/mysql/TinaSession');
const TinaMessage = require('../models/mysql/TinaMessage');
const { functionDeclarations, executeFunction } = require('./tinaFunctions');

const CONFIG = {
  MODEL: 'gemini-2.5-flash',
  TEMPERATURE: 0.7,
  MAX_TOKENS: 2000,
  SESSION_TIMEOUT: 2 * 60 * 60 * 1000, // 2 horas
  CLEANUP_INTERVAL: 60 * 60 * 1000, // 1 hora
  MAX_HISTORY_MESSAGES: 20,
  MAX_MESSAGE_LENGTH: 10000
};

class TinaService {
  constructor() {
    if (!process.env.GEMINI_API_KEY) {
      console.warn('⚠️  GEMINI_API_KEY não configurada! Tina não funcionará.');
      this.enabled = false;
      return;
    }

    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.enabled = true;

    // Cache de conversas ativas em memória
    this.activeChats = new Map();

    // Limpar sessões antigas a cada 1 hora
    this.cleanupInterval = setInterval(
      () => this.cleanupOldSessions(),
      CONFIG.CLEANUP_INTERVAL
    );

    console.log('✅ Tina IA inicializada (MySQL)! 🤖');
  }

  /**
   * Criar ou recuperar sessão do MySQL
   */
  async getOrCreateSession(sessionId, userId = null, sessionName = null) {
    try {
      let session = await TinaSession.findById(sessionId);

      if (!session) {
        await TinaSession.create(sessionId, userId, sessionName);
        console.log('🆕 Nova sessão criada:', sessionId);
        return { sessionId, isNew: true };
      }

      await TinaSession.updateAccess(sessionId);
      return { sessionId, isNew: false };

    } catch (error) {
      console.error('❌ Erro ao criar/recuperar sessão:', error);
      throw error;
    }
  }

  /**
   * Buscar histórico de mensagens do MySQL
   */
  async getHistory(sessionId, limit = CONFIG.MAX_HISTORY_MESSAGES) {
    try {
      const messages = await TinaMessage.findBySessionId(sessionId, limit);

      // Converter para formato do Gemini (assistant -> model)
      return messages.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : msg.role,
        parts: [{ text: msg.content }]
      }));

    } catch (error) {
      console.error('❌ Erro ao buscar histórico:', error);
      return [];
    }
  }

  /**
   * Criar chat com histórico do MySQL (com cache)
   */
  async getOrCreateChat(sessionId) {
    // Se já está no cache, retornar
    if (this.activeChats.has(sessionId)) {
      return this.activeChats.get(sessionId);
    }

    // Buscar histórico do MySQL
    const history = await this.getHistory(sessionId);

    const model = this.genAI.getGenerativeModel({
      model: CONFIG.MODEL,
      systemInstruction: TINA_INSTRUCTION + '\n\nVocê tem acesso a funções para consultar dados reais da plataforma (usuários, pagamentos, API keys, uso, etc). Quando o usuário pedir informações sobre dados da plataforma, USE as funções disponíveis para buscar dados reais do banco de dados. Nunca invente dados — sempre use as funções.',
      generationConfig: {
        temperature: CONFIG.TEMPERATURE,
        maxOutputTokens: CONFIG.MAX_TOKENS,
      },
      tools: [{ functionDeclarations }]
    });

    const chat = model.startChat({ history });

    // Cachear por 30 minutos
    this.activeChats.set(sessionId, chat);

    setTimeout(() => {
      this.activeChats.delete(sessionId);
    }, 30 * 60 * 1000);

    return chat;
  }

  /**
   * Enviar mensagem para a Tina
   */
  async sendMessage(sessionId, message, userId = null, sessionName = null) {
    if (!this.enabled) {
      throw new Error('Tina IA não está configurada (falta GEMINI_API_KEY)');
    }

    // Validação
    if (!message?.trim() || message.length > CONFIG.MAX_MESSAGE_LENGTH) {
      throw new Error('Mensagem inválida ou muito longa');
    }

    try {
      // Criar/atualizar sessão no MySQL
      await this.getOrCreateSession(sessionId, userId, sessionName);

      // Salvar mensagem do usuário no MySQL
      await TinaMessage.create(sessionId, 'user', message);

      // Obter chat com contexto
      const chat = await this.getOrCreateChat(sessionId);

      // Enviar para Gemini
      let result = await chat.sendMessage(message);
      let response;
      let totalFunctionCalls = 0;

      // Loop para processar Function Calls (pode haver múltiplas chamadas encadeadas)
      while (true) {
        const candidate = result.response.candidates?.[0];
        const part = candidate?.content?.parts?.[0];

        // Se o Gemini retornou uma chamada de função
        if (part?.functionCall) {
          totalFunctionCalls++;
          const { name, args } = part.functionCall;
          console.log(`🔧 Tina chamou função: ${name}`, JSON.stringify(args));

          // Executar a função
          const functionResult = await executeFunction(name, args || {});

          // Enviar o resultado de volta ao Gemini
          result = await chat.sendMessage([{
            functionResponse: {
              name: name,
              response: functionResult
            }
          }]);

          // Limite de segurança para evitar loops infinitos
          if (totalFunctionCalls >= 5) {
            console.warn('⚠️ Limite de function calls atingido (5)');
            break;
          }
        } else {
          // Gemini retornou texto final
          break;
        }
      }

      response = result.response.text();

      // Calcular tokens aproximados
      const tokensUsed = Math.ceil((message.length + response.length) / 4);

      // Salvar resposta da IA no MySQL
      await TinaMessage.create(
        sessionId,
        'assistant',
        response,
        tokensUsed,
        CONFIG.MODEL
      );

      return {
        success: true,
        response,
        sessionId,
        tokensUsed,
        model: CONFIG.MODEL
      };

    } catch (error) {
      console.error('❌ Erro na Tina:', error.message);
      throw error;
    }
  }

  /**
   * Buscar conversas de um usuário
   */
  async getUserSessions(userId, limit = 10) {
    try {
      return await TinaSession.findByUserId(userId, limit);
    } catch (error) {
      console.error('❌ Erro ao buscar sessões:', error);
      return [];
    }
  }

  /**
   * Obter histórico completo de uma sessão
   */
  async getFullHistory(sessionId, userId = null) {
    try {
      // Verificar ownership se userId fornecido
      if (userId) {
        const session = await TinaSession.findById(sessionId);
        if (!session || session.user_id !== userId) {
          throw new Error('Acesso negado');
        }
      }

      return await TinaMessage.findBySessionId(sessionId);

    } catch (error) {
      console.error('❌ Erro ao buscar histórico completo:', error);
      throw error;
    }
  }

  /**
   * Deletar sessão (soft delete)
   */
  async deleteSession(sessionId, userId = null) {
    try {
      // Verificar ownership se userId fornecido
      if (userId) {
        const session = await TinaSession.findById(sessionId);
        if (!session || session.user_id !== userId) {
          throw new Error('Acesso negado');
        }
      }

      await TinaSession.delete(sessionId);

      // Remover do cache
      this.activeChats.delete(sessionId);

      return { success: true, message: 'Sessão deletada' };

    } catch (error) {
      console.error('❌ Erro ao deletar sessão:', error);
      throw error;
    }
  }

  /**
   * Estatísticas de uma sessão
   */
  async getSessionStats(sessionId) {
    try {
      return await TinaMessage.getStats(sessionId);
    } catch (error) {
      console.error('❌ Erro ao buscar stats:', error);
      return null;
    }
  }

  /**
   * Limpar sessões antigas (executado periodicamente)
   */
  async cleanupOldSessions() {
    const mysql = require('../config/mysql');

    try {
      const result = await mysql.query(
        `UPDATE tina_sessions
         SET is_active = FALSE
         WHERE last_access < DATE_SUB(NOW(), INTERVAL ? MILLISECOND)`,
        [CONFIG.SESSION_TIMEOUT]
      );

      if (result.affectedRows > 0) {
        console.log(`🧹 Tina: ${result.affectedRows} sessões inativas desativadas`);
      }

    } catch (error) {
      console.error('❌ Erro no cleanup:', error);
    }
  }

  /**
   * Estatísticas gerais do serviço
   */
  async getStats() {
    const mysql = require('../config/mysql');

    try {
      const [stats] = await mysql.query(`
        SELECT
          COUNT(DISTINCT s.id) as total_sessions,
          COUNT(DISTINCT s.user_id) as total_users,
          COUNT(m.id) as total_messages,
          SUM(m.tokens_used) as total_tokens
        FROM tina_sessions s
        LEFT JOIN tina_messages m ON s.id = m.session_id
        WHERE s.is_active = TRUE
      `);

      return {
        enabled: this.enabled,
        model: CONFIG.MODEL,
        activeCacheSize: this.activeChats.size,
        database: stats
      };

    } catch (error) {
      console.error('❌ Erro ao buscar stats:', error);
      return {
        enabled: this.enabled,
        model: CONFIG.MODEL,
        activeCacheSize: this.activeChats.size
      };
    }
  }

  /**
   * Shutdown gracioso
   */
  async shutdown() {
    clearInterval(this.cleanupInterval);
    this.activeChats.clear();
    console.log('🛑 Tina IA encerrada');
  }
}

// Singleton - uma única instância para toda a aplicação
module.exports = new TinaService();
