// ===== ROUTES/REMOVE.JS =====
// Remover fundo de imagens usando Remove.bg API

const express = require('express');
const router = express.Router();
const axios = require('axios');
const FormData = require('form-data');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const authenticateApiKey = require('../middleware/auth');
const response = require('../utils/responseHandler');
const constants = require('../config/constants');

// Configurar Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_SECRET_KEY
});

// Configuração do Multer para upload de imagens
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 12 * 1024 * 1024 // 12MB
    },
    fileFilter: (req, file, cb) => {
        const allowedFormats = [
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/webp',
            'image/bmp'
        ];

        if (allowedFormats.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Formato de imagem não suportado. Use: JPG, PNG, WEBP, BMP'));
        }
    }
});

/**
 * Faz upload da imagem processada para Cloudinary
 */
async function uploadToCloudinary(imageBuffer, originalName) {
    try {
        return new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                {
                    folder: 'alauda-api/removed-backgrounds',
                    resource_type: 'image',
                    format: 'png',
                    public_id: `bg-removed-${Date.now()}-${Math.random().toString(36).substring(7)}`
                },
                (error, result) => {
                    if (error) {
                        console.error('❌ Erro upload Cloudinary:', error);
                        reject(new Error('Erro ao fazer upload da imagem processada'));
                    } else {
                        resolve({
                            url: result.secure_url,
                            public_id: result.public_id,
                            width: result.width,
                            height: result.height,
                            format: result.format,
                            size: result.bytes
                        });
                    }
                }
            );

            // Envia o buffer para o Cloudinary
            uploadStream.end(imageBuffer);
        });

    } catch (error) {
        console.error('❌ Erro ao processar upload Cloudinary:', error);
        throw new Error('Erro ao fazer upload da imagem');
    }
}

/**
 * Valida URL de imagem
 */
function isValidImageUrl(url) {
    if (!url || typeof url !== 'string') return false;
    
    try {
        new URL(url);
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.bmp'];
        return imageExtensions.some(ext => url.toLowerCase().includes(ext));
    } catch {
        return false;
    }
}

/**
 * Determina tamanho baseado no plano
 */
function getSizeByPlan(plan) {
    const sizes = {
        'free': 'preview',      // Baixa resolução (grátis)
        'basic': 'regular',     // Resolução normal
        'pro': 'hd',           // HD
        'premium': '4k'        // Ultra HD/4K
    };
    
    return sizes[plan] || 'regular';
}

/**
 * Remove fundo usando Remove.bg API (via buffer)
 */
async function removerFundoBuffer(imageBuffer, plan) {
    try {
        const formData = new FormData();
        formData.append('image_file', imageBuffer, {
            filename: 'image.png',
            contentType: 'image/png'
        });
        formData.append('size', getSizeByPlan(plan));

        const removeBgResponse = await axios.post(
            'https://api.remove.bg/v1.0/removebg',
            formData,
            {
                headers: {
                    ...formData.getHeaders(),
                    'X-Api-Key': process.env.REMOVEBG_API_KEY
                },
                responseType: 'arraybuffer',
                timeout: 60000 // 60 segundos
            }
        );

        return {
            success: true,
            imageBuffer: Buffer.from(removeBgResponse.data),
            size: removeBgResponse.data.length,
            format: 'png',
            credits_charged: removeBgResponse.headers['x-credits-charged'] || 1
        };

    } catch (error) {
        console.error('❌ Erro Remove.bg (buffer):', error.message);

        if (error.response) {
            const errorData = error.response.data ? error.response.data.toString() : 'Erro desconhecido';
            
            if (error.response.status === 403) {
                throw new Error('API Key do Remove.bg inválida ou limite excedido');
            }
            if (error.response.status === 400) {
                throw new Error('Imagem inválida ou corrompida');
            }
            
            throw new Error(`Erro da API Remove.bg: ${error.response.status}`);
        }

        throw new Error('Erro ao processar imagem. Tente novamente.');
    }
}

/**
 * Remove fundo usando Remove.bg API (via URL)
 */
async function removerFundoUrl(imageUrl, plan) {
    try {
        const formData = new FormData();
        formData.append('image_url', imageUrl);
        formData.append('size', getSizeByPlan(plan));

        const removeBgResponse = await axios.post(
            'https://api.remove.bg/v1.0/removebg',
            formData,
            {
                headers: {
                    ...formData.getHeaders(),
                    'X-Api-Key': process.env.REMOVEBG_API_KEY
                },
                responseType: 'arraybuffer',
                timeout: 60000
            }
        );

        return {
            success: true,
            imageBuffer: Buffer.from(removeBgResponse.data),
            size: removeBgResponse.data.length,
            format: 'png',
            credits_charged: removeBgResponse.headers['x-credits-charged'] || 1
        };

    } catch (error) {
        console.error('❌ Erro Remove.bg (URL):', error.message);

        if (error.response) {
            if (error.response.status === 403) {
                throw new Error('API Key do Remove.bg inválida ou limite excedido');
            }
            if (error.response.status === 400) {
                throw new Error('URL de imagem inválida ou inacessível');
            }
            
            throw new Error(`Erro da API Remove.bg: ${error.response.status}`);
        }

        throw new Error('Erro ao processar imagem. Tente novamente.');
    }
}

// ===== ROTAS =====

router.get('/info', (req, res) => {
    response.success(res, {
        endpoint: '/api/remove',
        description: 'Remoção de fundo de imagens usando IA',
        features: [
            'Remoção automática de fundo',
            'Upload de arquivo ou URL',
            'Qualidade baseada no plano',
            'Formato PNG com transparência',
            'Processamento rápido (< 10s)'
        ],
        limitations: [
            'Tamanho máximo: 12MB',
            'Formatos: JPG, PNG, WEBP, BMP',
            'Qualidade varia por plano'
        ],
        cost: `${constants.COSTS.REMOVE_BG || 10} crédito(s) por imagem`,
        quality_by_plan: {
            free: 'Preview (baixa resolução)',
            basic: 'Regular',
            pro: 'HD',
            premium: '4K/Ultra HD'
        },
        usage: {
            upload: {
                method: 'POST',
                endpoint: '/api/remove/background',
                headers: {
                    'X-API-Key': 'sua_api_key_aqui',
                    'Content-Type': 'multipart/form-data'
                },
                body: 'arquivo de imagem (campo: image)'
            },
            url: {
                method: 'POST',
                endpoint: '/api/remove/background-url',
                headers: {
                    'X-API-Key': 'sua_api_key_aqui',
                    'Content-Type': 'application/json'
                },
                body: {
                    url: 'https://exemplo.com/imagem.jpg'
                }
            }
        }
    });
});

// ===== REMOVER FUNDO (UPLOAD) =====
router.post('/background', authenticateApiKey, upload.single('image'), response.asyncHandler(async (req, res) => {
    try {
        // Verifica API Key do Remove.bg
        if (!process.env.REMOVEBG_API_KEY) {
            return response.error(res, 'Serviço temporariamente indisponível. Entre em contato com o suporte.', 503);
        }

        // Verifica se arquivo foi enviado
        if (!req.file) {
            return response.validationError(res, [{
                field: 'image',
                message: 'Arquivo de imagem é obrigatório'
            }]);
        }

        console.log('🖼️ Removendo fundo de imagem...');
        console.log('- Arquivo:', req.file.originalname);
        console.log('- Tamanho:', (req.file.size / 1024 / 1024).toFixed(2), 'MB');
        console.log('- Tipo:', req.file.mimetype);
        console.log('- Plano:', req.apiKeyData.plan);
        console.log('- Qualidade:', getSizeByPlan(req.apiKeyData.plan));

        // Processa imagem
        const resultado = await removerFundoBuffer(req.file.buffer, req.apiKeyData.plan);

        // Upload para Cloudinary
        console.log('☁️ Fazendo upload para Cloudinary...');
        const cloudinaryResult = await uploadToCloudinary(resultado.imageBuffer, req.file.originalname);
        console.log('✅ Upload concluído:', cloudinaryResult.url);

        // Log de sucesso
        await req.logSuccess({
            case: 'remove_bg',
            method: 'upload',
            original_size: req.file.size,
            result_size: resultado.size,
            plan: req.apiKeyData.plan,
            quality: getSizeByPlan(req.apiKeyData.plan),
            cloudinary_url: cloudinaryResult.url
        });

        return response.success(res, {
            download_url: cloudinaryResult.url,
            thumbnail: cloudinaryResult.url.replace('/upload/', '/upload/w_300,h_300,c_fit/'),
            width: cloudinaryResult.width,
            height: cloudinaryResult.height,
            size: cloudinaryResult.size,
            size_mb: (cloudinaryResult.size / 1024 / 1024).toFixed(2),
            format: 'png',
            quality: getSizeByPlan(req.apiKeyData.plan),
            cloudinary_id: cloudinaryResult.public_id,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro na rota Remove.bg (upload):', error);
        await req.logError(500, error.message, { case: 'remove_bg', method: 'upload' });

        if (error.message.includes('Formato')) {
            return response.error(res, error.message, 400);
        }
        if (error.message.includes('API Key')) {
            return response.error(res, error.message, 503);
        }

        return response.error(res, error.message, 500);
    }
}));

// ===== REMOVER FUNDO (URL) =====
router.post('/background-url', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { url } = req.body;

        // Verifica API Key do Remove.bg
        if (!process.env.REMOVEBG_API_KEY) {
            return response.error(res, 'Serviço temporariamente indisponível. Entre em contato com o suporte.', 503);
        }

        // Validações
        if (!url) {
            return response.validationError(res, [{
                field: 'url',
                message: 'URL da imagem é obrigatória'
            }]);
        }

        if (!isValidImageUrl(url)) {
            return response.validationError(res, [{
                field: 'url',
                message: 'URL inválida. Deve ser um link direto para imagem (JPG, PNG, WEBP, BMP)'
            }]);
        }
	console.log('🔑 REMOVEBG_API_KEY:', process.env.REMOVEBG_API_KEY ? 'Configurada ✅' : 'NÃO CONFIGURADA ❌');
        console.log('🖼️ Removendo fundo de imagem (URL)...');
        console.log('- URL:', url);
        console.log('- Plano:', req.apiKeyData.plan);
        console.log('- Qualidade:', getSizeByPlan(req.apiKeyData.plan));

        // Processa imagem
        const resultado = await removerFundoUrl(url, req.apiKeyData.plan);
        console.log('✅ Fundo removido com sucesso');

        // Upload para Cloudinary
        console.log('☁️ Fazendo upload para Cloudinary...');
        const cloudinaryResult = await uploadToCloudinary(resultado.imageBuffer, 'image-from-url');
        console.log('✅ Upload concluído:', cloudinaryResult.url);

/*
        // Upload para Cloudinary
        console.log('☁️ Fazendo upload para Cloudinary...');
        const cloudinaryResult = await uploadToCloudinary(resultado.imageBuffer, 'image-from-url');
        console.log('✅ Upload concluído:', cloudinaryResult.url);
*/
        // Log de sucesso
        await req.logSuccess({
            case: 'remove_bg',
            method: 'url',
            url: url,
            result_size: resultado.size,
            plan: req.apiKeyData.plan,
            quality: getSizeByPlan(req.apiKeyData.plan),
            cloudinary_url: cloudinaryResult.url
        });

        return response.success(res, {
            download_url: cloudinaryResult.url,
            thumbnail: cloudinaryResult.url.replace('/upload/', '/upload/w_300,h_300,c_fit/'),
            width: cloudinaryResult.width,
            height: cloudinaryResult.height,
            size: cloudinaryResult.size,
            size_mb: (cloudinaryResult.size / 1024 / 1024).toFixed(2),
            format: 'png',
            quality: getSizeByPlan(req.apiKeyData.plan),
            cloudinary_id: cloudinaryResult.public_id,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro na rota Remove.bg (URL):', error);
        await req.logError(500, error.message, { case: 'remove_bg', method: 'url' });

        if (error.message.includes('URL inválida')) {
            return response.error(res, error.message, 400);
        }
        if (error.message.includes('API Key')) {
            return response.error(res, error.message, 503);
        }

        return response.error(res, error.message, 500);
    }
}));

module.exports = router;
