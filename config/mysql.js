// ===== CONFIG/MYSQL.JS =====
// Configuração do MySQL para Alauda API (Tina IA)

const mysql = require('mysql2/promise');

const config = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: process.env.MYSQL_PORT || 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'alauda_api',
  
  // Connection pool
  connectionLimit: 10,
  queueLimit: 0,
  
  // Timeouts
  connectTimeout: 10000,
  
  // Charset
  charset: 'utf8mb4',
  
  // Timezone
  timezone: '+00:00',
  
  // Wait for connections
  waitForConnections: true,
  
  // Flags
  multipleStatements: false,
  dateStrings: false
};

// Criar pool de conexões
const pool = mysql.createPool(config);

// Testar conexão na inicialização
(async () => {
  try {
    const connection = await pool.getConnection();
    console.log('✅ MySQL conectado!');
    connection.release();
  } catch (error) {
    console.error('❌ Erro ao conectar MySQL:', error.message);
  }
})();

// Helper para queries simples
const query = async (sql, params = []) => {
  try {
    const [results] = await pool.execute(sql, params);
    return results;
  } catch (error) {
    console.error('❌ Query MySQL falhou:', error.message);
    throw error;
  }
};

// Helper para transações
const transaction = async (callback) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// Helper para bulk inserts
const bulkInsert = async (table, columns, values) => {
  if (!values || values.length === 0) return { affectedRows: 0 };
  
  const placeholders = values.map(() => 
    `(${columns.map(() => '?').join(',')})`
  ).join(',');
  
  const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES ${placeholders}`;
  const flatValues = values.flat();
  
  const [result] = await pool.execute(sql, flatValues);
  return result;
};

// Shutdown gracioso
const shutdown = async () => {
  try {
    await pool.end();
    console.log('🛑 MySQL pool fechado');
  } catch (error) {
    console.error('❌ Erro ao fechar MySQL:', error.message);
  }
};

module.exports = {
  pool,
  query,
  transaction,
  bulkInsert,
  shutdown,
  config
};
