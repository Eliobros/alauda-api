// ===== ROUTES/INSTAGRAM.JS ===== (CORRIGIDO)
const express = require('express');
const router = express.Router();
const axios = require('axios');
const authenticateApiKey = require('../middleware/auth');
const response = require('../utils/responseHandler');
const constants = require('../config/constants');

/**
 * Valida URL do Instagram
 */
function isValidInstagramUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return constants.PATTERNS.INSTAGRAM_URL.test(url);
}

/**
 * Baixa post/reel do Instagram via RapidAPI
 */
async function downloadInstagram(url) {
    try {
        const rapidApiResponse = await axios.get(
            'https://instagram-downloader-download-instagram-videos-stories1.p.rapidapi.com/get-info-rapidapi',
            {
                params: { url: url },
                headers: {
                    'x-rapidapi-host': 'instagram-downloader-download-instagram-videos-stories1.p.rapidapi.com',
                    'x-rapidapi-key': process.env.RAPIDAPI_KEY || '581eef45eemsh242fbe5e00e1e11p187affjsne6cd8fd6a1d2'
                },
                timeout: 30000
            }
        );

        const data = rapidApiResponse.data;

        if (data.error) {
            throw new Error(data.message || 'Erro ao processar post do Instagram');
        }

        // ✅ MAPEAMENTO CORRETO PARA O FORMATO DO response.download()
        return {
            success: true,
            post: {
                title: data.caption || 'Instagram Post',
                url: data.download_url,  // ← URL DE DOWNLOAD, não a URL original
                thumbnail: data.thumb,
                duration: data.duration || null,
                size: null,  // RapidAPI não fornece
                format: data.type === 'video' ? 'mp4' : 'jpg',
                quality: 'HD',
                // Dados extras (não usados no response.download, mas úteis)
                original_url: data.shortcode,
                type: data.type,
                caption: data.caption,
                hosting: data.hosting
            }
        };

    } catch (error) {
        console.error('❌ Erro ao baixar Instagram:', error.message);

        if (error.response) {
            throw new Error(`Erro da API: ${error.response.status} - ${error.response.data?.message || 'Erro desconhecido'}`);
        } else if (error.request) {
            throw new Error('Sem resposta da API RapidAPI');
        } else {
            throw new Error(error.message);
        }
    }
}

// ===== ROTAS =====

router.get('/info', (req, res) => {
    response.success(res, {
        endpoint: '/api/instagram',
        description: 'Instagram post/reel downloader',
        features: [
            'Download de posts',
            'Download de reels',
            'Download de IGTV',
            'Thumbnail em HD',
            'Caption completa',
            'Suporte a vídeos e imagens'
        ],
        limitations: [
            'Posts públicos apenas',
            'Rate limit: conforme plano RapidAPI'
        ],
        cost: `${constants.COSTS.INSTAGRAM_DOWNLOAD} crédito(s) por download`,
        usage: {
            method: 'POST',
            endpoint: '/api/instagram/download',
            headers: {
                'X-API-Key': 'sua_api_key_aqui',
                'Content-Type': 'application/json'
            },
            body: {
                url: 'https://www.instagram.com/p/SHORTCODE/ ou /reel/SHORTCODE/'
            }
        }
    });
});

router.post('/download', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return response.validationError(res, [{ field: 'url', message: 'URL do Instagram é obrigatória' }]);
        }
        if (!isValidInstagramUrl(url)) {
            return response.validationError(res, [{
                field: 'url',
                message: 'URL do Instagram inválida. Use: https://www.instagram.com/p/SHORTCODE/ ou /reel/SHORTCODE/'
            }]);
        }

        const result = await downloadInstagram(url);

        await req.logSuccess({
            case: 'instagram_download',
            url: result.post.original_url,
            type: result.post.type
        });

        // ✅ AGORA O MAPEAMENTO ESTÁ CORRETO
        return response.download(res, {
            ...result.post,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro na rota Instagram:', error);
        await req.logError(500, error.message, { case: 'instagram_download' });

        if (error.message.includes('timeout')) {
            return response.error(res, 'Timeout ao processar post. Tente novamente.', 504);
        }
        if (error.message.includes('403') || error.message.includes('401')) {
            return response.error(res, 'Acesso negado. Verifique se o post é público.', 403);
        }
        return response.error(res, error.message, 500);
    }
}));

router.post('/info-only', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return response.validationError(res, [{ field: 'url', message: 'URL do Instagram é obrigatória' }]);
        if (!isValidInstagramUrl(url)) return response.validationError(res, [{ field: 'url', message: 'URL do Instagram inválida' }]);

        const result = await downloadInstagram(url);

        // Remove link de download
        delete result.post.url;
        delete result.post.download_url;

        await req.logSuccess({
            case: 'instagram_info',
            url: result.post.original_url,
            type: result.post.type,
            info_only: true
        });

        return response.info(res, {
            ...result.post,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        await req.logError(500, error.message, { case: 'instagram_info' });
        return response.error(res, error.message, 500);
    }
}));

router.post('/batch', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { urls } = req.body;

        if (!urls || !Array.isArray(urls)) {
            return response.validationError(res, [{ field: 'urls', message: 'Forneça um array de URLs' }]);
        }
        if (urls.length === 0) {
            return response.validationError(res, [{ field: 'urls', message: 'Array de URLs está vazio' }]);
        }
        if (urls.length > 10) {
            return response.validationError(res, [{ field: 'urls', message: 'Máximo de 10 URLs por vez' }]);
        }

        if (!['pro', 'premium'].includes(req.apiKeyData.plan)) {
            return response.error(res, 'Batch download disponível apenas para planos PRO e PREMIUM', 403);
        }

        const totalCreditsNeeded = urls.length * constants.COSTS.INSTAGRAM_DOWNLOAD;
        if (!req.apiKeyData.hasCredits(totalCreditsNeeded)) {
            return response.insufficientCredits(res, totalCreditsNeeded, req.apiKeyData.credits);
        }

        const results = [];
        let successCount = 0;
        let failCount = 0;

        for (const url of urls) {
            try {
                if (!isValidInstagramUrl(url)) {
                    results.push({ url, success: false, error: 'URL inválida' });
                    failCount++;
                    continue;
                }

                const result = await downloadInstagram(url);
                results.push({ url, success: true, data: result.post });
                successCount++;

                await req.apiKeyData.consumeCredits(constants.COSTS.INSTAGRAM_DOWNLOAD);

            } catch (error) {
                results.push({ url, success: false, error: error.message });
                failCount++;
            }
        }

        await req.logSuccess({
            case: 'instagram_batch',
            batch: true,
            total: urls.length,
            success: successCount,
            failed: failCount
        });

        return response.success(res, {
            total: urls.length,
            successful: successCount,
            failed: failCount,
            results,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        await req.logError(500, error.message, { case: 'instagram_batch' });
        return response.error(res, error.message, 500);
    }
}));

module.exports = router;
