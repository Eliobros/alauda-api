// ===== MIDDLEWARE/ADMINAUTH.JS =====
// Middleware de autenticação de ADMIN para Alauda API
// Apenas a chave do dono tem acesso: eliobrostech3@gmail.com
// (ou qualquer chave com role = 'admin' marcada manualmente no banco).

const ApiKey = require('../models/ApiKey');
const constants = require('../config/constants');

// Email do dono/admin — pode ser sobrescrito por env var
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'eliobrostech3@gmail.com').toLowerCase();

/**
 * Middleware de autenticação admin
 * Header: X-API-Key: <chave_do_admin>
 */
async function authenticateAdmin(req, res, next) {
    try {
        // ===== 1. EXTRAI API KEY (SOMENTE DO HEADER) =====
        // ⚠️ Só aceitamos do header: o body das rotas admin usa o campo
        // `apiKey` para indicar a CHAVE ALVO, então nunca use body/query aqui.
        const apiKey = req.headers['x-api-key'];

        if (!apiKey) {
            return res.status(constants.STATUS.UNAUTHORIZED).json({
                success: false,
                error: 'API key não fornecida',
                message: 'Forneça a chave do admin no header X-API-Key'
            });
        }

        // ===== 2. BUSCA NO BANCO =====
        const keyData = await ApiKey.findOne({ key: apiKey });

        if (!keyData) {
            return res.status(constants.STATUS.UNAUTHORIZED).json({
                success: false,
                error: 'API key inválida'
            });
        }

        // ===== 3. VALIDA STATUS =====
        if (!keyData.isValid()) {
            return res.status(constants.STATUS.FORBIDDEN).json({
                success: false,
                error: 'API key desativada ou expirada'
            });
        }

        // ===== 4. VERIFICA SE É ADMIN =====
        const isAdminEmail = (keyData.email || '').toLowerCase() === ADMIN_EMAIL;
        const isAdminRole = keyData.role === 'admin';

        if (!isAdminEmail && !isAdminRole) {
            console.warn(`🚫 Acesso admin negado para: ${keyData.email} (${keyData.key.substring(0, 18)}...)`);
            return res.status(constants.STATUS.FORBIDDEN).json({
                success: false,
                error: 'Acesso negado. Esta rota é restrita ao administrador.'
            });
        }

        // ===== 5. ANEXA DADOS =====
        req.adminKeyData = keyData;

        console.log(`👑 Admin autenticado: ${keyData.email} (${keyData.key.substring(0, 18)}...)`);
        next();

    } catch (error) {
        console.error('❌ Erro na autenticação admin:', error);
        res.status(constants.STATUS.SERVER_ERROR).json({
            success: false,
            error: 'Erro na autenticação admin',
            message: error.message
        });
    }
}

module.exports = authenticateAdmin;
