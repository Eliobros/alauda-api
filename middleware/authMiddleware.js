// ===== MIDDLEWARE/AUTHMIDDLEWARE.JS =====
// Middleware de autenticação JWT

const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authMiddleware = async (req, res, next) => {
    try {
        // Pega token do header
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'Token não fornecido',
                message: 'Use: Authorization: Bearer <token>'
            });
        }

        const token = authHeader.substring(7); // Remove "Bearer "

        // Verifica token
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'alauda_secret_key_2024');

        // Busca usuário
        const user = await User.findById(decoded.userId);

        if (!user || !user.active) {
            return res.status(401).json({
                success: false,
                error: 'Usuário não encontrado ou inativo'
            });
        }

        // Adiciona user no request
        req.user = {
            userId: user._id.toString(),
            name: user.name,
            email: user.email,
            phone: user.phone
        };

        next();

    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                error: 'Token inválido'
            });
        }

        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                error: 'Token expirado',
                message: 'Faça login novamente'
            });
        }

        console.error('❌ Erro no authMiddleware:', error);
        return res.status(500).json({
            success: false,
            error: 'Erro ao validar autenticação'
        });
    }
};

module.exports = authMiddleware;
