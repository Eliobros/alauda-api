// ===== MODELS/MYSQL/TINAMESSAGE.JS =====
// Model para mensagens da Tina

const mysql = require('../../config/mysql');

class TinaMessage {
  /**
   * Criar nova mensagem
   */
  static async create(sessionId, role, content, tokensUsed = 0, model = null) {
    const result = await mysql.query(
      `INSERT INTO tina_messages (session_id, role, content, tokens_used, model) 
       VALUES (?, ?, ?, ?, ?)`,
      [sessionId, role, content, tokensUsed, model]
    );
    return result;
  }
  
  /**
   * Buscar mensagens de uma sessão
   */
  static async findBySessionId(sessionId, limit = null) {
    let sql = `
      SELECT * FROM tina_messages 
      WHERE session_id = ? 
      ORDER BY created_at DESC
    `;
    
    const params = [sessionId];
    
    if (limit) {
      sql += ' LIMIT ?';
      params.push(limit);
    }
    
    const results = await mysql.query(sql, params);
    
    // Se tem limit, inverter para ordem cronológica
    return limit ? results.reverse() : results;
  }
  
  /**
   * Obter estatísticas de uma sessão
   */
  static async getStats(sessionId) {
    const [stats] = await mysql.query(
      `SELECT 
        COUNT(*) as total_messages,
        SUM(tokens_used) as total_tokens,
        SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) as user_messages,
        SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END) as assistant_messages,
        MIN(created_at) as first_message,
        MAX(created_at) as last_message
       FROM tina_messages 
       WHERE session_id = ?`,
      [sessionId]
    );
    return stats;
  }
  
  /**
   * Deletar todas mensagens de uma sessão
   */
  static async deleteBySessionId(sessionId) {
    const result = await mysql.query(
      'DELETE FROM tina_messages WHERE session_id = ?',
      [sessionId]
    );
    return result;
  }
  
  /**
   * Contar mensagens de um usuário (via sessions)
   */
  static async countByUserId(userId) {
    const [result] = await mysql.query(
      `SELECT COUNT(*) as count 
       FROM tina_messages m
       JOIN tina_sessions s ON m.session_id = s.id
       WHERE s.user_id = ?`,
      [userId]
    );
    return result.count;
  }
}

module.exports = TinaMessage;
