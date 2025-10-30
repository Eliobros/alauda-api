// ===== ROUTES/AUTH.JS =====
// Rotas de autenticação (registro e login)

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');

const JWT_SECRET = process.env.JWT_SECRET || 'alauda_secret_key_2024';
const JWT_EXPIRES = '30d'; // Token válido por 30 dias

/**
 * POST /api/auth/register
 * Registra novo usuário
 */
router.post('/register', async (req, res) => {
    try {
        const { name, email, password, phone } = req.body;

        // Validações
        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Campos obrigatórios: name, email, password'
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Senha deve ter pelo menos 6 caracteres'
            });
        }

        // Verifica se email já existe
        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                error: 'Email já cadastrado'
            });
        }

        // Hash da senha
        const hashedPassword = await bcrypt.hash(password, 10);

        // Cria usuário
        const user = new User({
            name: name.trim(),
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            phone: phone ? phone.trim() : null
        });

        await user.save();

        // Gera token JWT
        const token = jwt.sign(
            { 
                userId: user._id.toString(),
                email: user.email 
            },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES }
        );

        console.log(`✅ Novo usuário registrado: ${user.email}`);

        res.status(201).json({
            success: true,
            message: 'Usuário registrado com sucesso',
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                createdAt: user.createdAt
            }
        });

    } catch (error) {
        console.error('❌ Erro no registro:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao registrar usuário',
            message: error.message
        });
    }
});

/**
 * POST /api/auth/login
 * Faz login do usuário
 */
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validações
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email e senha são obrigatórios'
            });
        }

        // Busca usuário
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Email ou senha inválidos'
            });
        }

        // Verifica se está ativo
        if (!user.active) {
            return res.status(403).json({
                success: false,
                error: 'Conta desativada. Entre em contato com o suporte.'
            });
        }

        // Valida senha
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({
                success: false,
                error: 'Email ou senha inválidos'
            });
        }

        // Registra login
        await user.recordLogin();

        // Gera token JWT
        const token = jwt.sign(
            { 
                userId: user._id.toString(),
                email: user.email 
            },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES }
        );

        console.log(`✅ Login bem-sucedido: ${user.email}`);

        res.json({
            success: true,
            message: 'Login realizado com sucesso',
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                lastLogin: user.lastLogin,
                loginCount: user.loginCount
            }
        });

    } catch (error) {
        console.error('❌ Erro no login:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao fazer login',
            message: error.message
        });
    }
});

/**
 * GET /api/auth/me
 * Retorna dados do usuário autenticado
 */
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Usuário não encontrado'
            });
        }

        res.json({
            success: true,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                totalApiKeys: user.totalApiKeys,
                lastLogin: user.lastLogin,
                loginCount: user.loginCount,
                createdAt: user.createdAt
            }
        });

    } catch (error) {
        console.error('❌ Erro ao buscar usuário:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao buscar dados do usuário'
        });
    }
});

/**
 * PUT /api/auth/update
 * Atualiza dados do usuário
 */
router.put('/update', authMiddleware, async (req, res) => {
    try {
        const { name, phone } = req.body;
        const user = await User.findById(req.user.userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Usuário não encontrado'
            });
        }

        // Atualiza campos permitidos
        if (name) user.name = name.trim();
        if (phone) user.phone = phone.trim();

        await user.save();

        console.log(`✅ Usuário atualizado: ${user.email}`);

        res.json({
            success: true,
            message: 'Dados atualizados com sucesso',
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone
            }
        });

    } catch (error) {
        console.error('❌ Erro ao atualizar usuário:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao atualizar dados'
        });
    }
});

/**
 * POST /api/auth/change-password
 * Altera senha do usuário
 */
router.post('/change-password', authMiddleware, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                error: 'Senha atual e nova senha são obrigatórias'
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Nova senha deve ter pelo menos 6 caracteres'
            });
        }

        const user = await User.findById(req.user.userId);

        // Valida senha atual
        const validPassword = await bcrypt.compare(currentPassword, user.password);
        if (!validPassword) {
            return res.status(401).json({
                success: false,
                error: 'Senha atual incorreta'
            });
        }

        // Hash nova senha
        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();

        console.log(`✅ Senha alterada: ${user.email}`);

        res.json({
            success: true,
            message: 'Senha alterada com sucesso'
        });

    } catch (error) {
        console.error('❌ Erro ao alterar senha:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao alterar senha'
        });
    }
});

module.exports = router;
