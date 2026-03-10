// ===== CONFIG/INDEX.JS =====
// Exporta todas as conexões de banco

const mongodb = require('./database');
const mysql = require('./mysql');

// Helper para verificar se bancos estão conectados
const checkConnections = async () => {
  const status = {
    mongodb: false,
    mysql: false
  };
  
  try {
    // Verificar MongoDB
    const mongoose = require('mongoose');
    status.mongodb = mongoose.connection.readyState === 1;
    
    // Verificar MySQL
    await mysql.pool.query('SELECT 1');
    status.mysql = true;
  } catch (error) {
    console.error('❌ Erro ao verificar conexões:', error.message);
  }
  
  return status;
};

module.exports = {
  // Conexões
  mongodb,
  mysql,
  
  // Helpers
  checkConnections,
  
  // Atalhos úteis
  mongo: mongodb,
  db: {
    mongo: mongodb,
    mysql: mysql
  }
};
