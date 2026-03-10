// ===== MODELS/MYSQL/TINASESSION.JS =====
// Model para sessões de conversa da Tina

const mysql = require('../../config/mysql');

class TinaSession {
  /**
   * Criar nova sessão
   */
  static async create(sessionId, userId = null, sessionName = null) {
    const result = await mysql.query(
      'INSERT INTO tina_sessions (id, user_id, session_name) VALUES (?, ?, ?)',
      [sessionId, userId, sessionName]
    );
    return result;
  }
  
  /**
   * Buscar sessão por ID
   */
  static async findById(sessionId) {
    const results = await mysql.query(
      'SELECT * FROM tina_sessions WHERE id = ?',
      [sessionId]
    );
    return results[0] || null;
  }
  
  /**
   * Buscar sessões de um usuário
   */
  static async findByUserId(userId, limit = 10) {
    const results = await mysql.query(
      `SELECT 
        s.id,
        s.user_id,
        s.session_name,
        s.created_at,
        s.last_access,
        s.is_active,
        COUNT(m.id) as message_count,
        SUM(m.tokens_used) as total_tokens
       FROM tina_sessions s
       LEFT JOIN tina_messages m ON s.id = m.session_id
       WHERE s.user_id = ? AND s.is_active = TRUE
       GROUP BY s.id
       ORDER BY s.last_access DESC 
       LIMIT ?`,
      [userId, limit]
    );
    return results;
  }
  
  /**
   * Atualizar último acesso
   */
  static async updateAccess(sessionId) {
    const result = await mysql.query(
      'UPDATE tina_sessions SET last_access = NOW() WHERE id = ?',
      [sessionId]
    );
    return result;
  }
  
  /**
   * Deletar sessão (soft delete)
   */
  static async delete(sessionId) {
    const result = await mysql.query(
      'UPDATE tina_sessions SET is_active = FALSE WHERE id = ?',
      [sessionId]
    );
    return result;
  }
  
  /**
   * Contar sessões ativas de um usuário
   */
  static async countByUserId(userId) {
    const [result] = await mysql.query(
      'SELECT COUNT(*) as count FROM tina_sessions WHERE user_id = ? AND is_active = TRUE',
      [userId]
    );
    return result.count;
  }
}

module.exports = TinaSession;
