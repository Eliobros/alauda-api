// ===== ROUTES/TIKTOK.JS =====
// TikTok Downloader para Alauda API

const express = require('express');
const router = express.Router();
const axios = require('axios');
const authenticateApiKey = require('../middleware/auth');
const response = require('../utils/responseHandler');
const constants = require('../config/constants');

/**
 * Valida URL do TikTok
 */
function isValidTikTokUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return constants.PATTERNS.TIKTOK_URL.test(url);
}

/**
 * Baixa vídeo do TikTok via TikWM API
 */
async function downloadTikTok(url) {
    try {
        const tikwmResponse = await axios.post(
            constants.SERVICES.TIKTOK.url,
            { url: url, hd: 1 },
            {
                timeout: constants.SERVICES.TIKTOK.timeout,
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Alauda-API/1.0'
                }
            }
        );

        if (tikwmResponse.data.code !== 0) {
            throw new Error(tikwmResponse.data.msg || 'Erro ao processar vídeo');
        }

        const data = tikwmResponse.data.data;

        return {
            success: true,
            video: {
                id: data.id,
                title: data.title || 'Sem título',
                cover: data.cover ? `https://www.tikwm.com${data.cover}` : null,
                duration: data.duration || 0,
                download: {
                    no_watermark: data.play ? `https://www.tikwm.com${data.play}` : null,
                    watermark: data.wmplay ? `https://www.tikwm.com${data.wmplay}` : null,
                    hd: data.hdplay ? `https://www.tikwm.com${data.hdplay}` : null
                },
                audio: data.music ? `https://www.tikwm.com${data.music}` : null,
                music: data.music_info ? {
                    title: data.music_info.title,
                    author: data.music_info.author,
                    duration: data.music_info.duration,
                    url: data.music_info.play
                } : null,
                stats: {
                    plays: data.play_count || 0,
                    likes: data.digg_count || 0,
                    comments: data.comment_count || 0,
                    shares: data.share_count || 0,
                    downloads: data.download_count || 0,
                    favorites: data.collect_count || 0
                },
                author: {
                    id: data.author?.id,
                    username: data.author?.unique_id,
                    nickname: data.author?.nickname,
                    avatar: data.author?.avatar ? `https://www.tikwm.com${data.author.avatar}` : null
                },
                region: data.region,
                create_time: data.create_time
            }
        };

    } catch (error) {
        console.error('❌ Erro ao baixar TikTok:', error.message);

        if (error.response) {
            throw new Error(`Erro da API TikWM: ${error.response.status}`);
        } else if (error.request) {
            throw new Error('Sem resposta da API TikWM');
        } else {
            throw new Error(error.message);
        }
    }
}

// ===== ROTAS =====

router.get('/info', (req, res) => {
    response.success(res, {
        endpoint: '/api/tiktok',
        description: 'TikTok video downloader',
        features: [
            'Download sem marca d\'água',
            'Download HD',
            'Áudio separado',
            'Estatísticas do vídeo',
            'Informações do autor'
        ],
        cost: `${constants.COSTS.TIKTOK_DOWNLOAD} crédito(s) por download`,
        usage: {
            method: 'POST',
            endpoint: '/api/tiktok/download',
            headers: {
                'X-API-Key': 'sua_api_key_aqui',
                'Content-Type': 'application/json'
            },
            body: {
                url: 'https://www.tiktok.com/@user/video/123456789'
            }
        }
    });
});

router.post('/download', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return response.validationError(res, [{ field: 'url', message: 'URL do TikTok é obrigatória' }]);
        }
        if (!isValidTikTokUrl(url)) {
            return response.validationError(res, [{
                field: 'url',
                message: 'URL do TikTok inválida. Use o formato: https://www.tiktok.com/@user/video/123456789'
            }]);
        }

        const result = await downloadTikTok(url);

        await req.logSuccess({
            case: 'tiktok_download',
            video_id: result.video.id,
            title: result.video.title,
            author: result.video.author.username
        });

        return response.download(res, {
            ...result.video,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro na rota TikTok:', error);
        await req.logError(500, error.message, { case: 'tiktok_download' });

        if (error.message.includes('timeout')) {
            return response.error(res, 'Timeout ao processar vídeo. Tente novamente.', 504);
        }
        if (error.message.includes('TikWM')) {
            return response.serviceUnavailable(res, 'TikTok');
        }
        return response.error(res, error.message, 500);
    }
}));

router.post('/info-only', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return response.validationError(res, [{ field: 'url', message: 'URL do TikTok é obrigatória' }]);
        if (!isValidTikTokUrl(url)) return response.validationError(res, [{ field: 'url', message: 'URL do TikTok inválida' }]);

        const result = await downloadTikTok(url);

        delete result.video.download;
        delete result.video.audio;

        await req.logSuccess({
            case: 'tiktok_download',
            video_id: result.video.id,
            title: result.video.title,
            info_only: true
        });

        return response.info(res, {
            ...result.video,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        await req.logError(500, error.message, { case: 'tiktok_download' });
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

        const totalCreditsNeeded = urls.length * constants.COSTS.TIKTOK_DOWNLOAD;
        if (!req.apiKeyData.hasCredits(totalCreditsNeeded)) {
            return response.insufficientCredits(res, totalCreditsNeeded, req.apiKeyData.credits);
        }

        const results = [];
        let successCount = 0;
        let failCount = 0;

        for (const url of urls) {
            try {
                if (!isValidTikTokUrl(url)) {
                    results.push({ url, success: false, error: 'URL inválida' });
                    failCount++;
                    continue;
                }

                const result = await downloadTikTok(url);
                results.push({ url, success: true, data: result.video });
                successCount++;

                await req.apiKeyData.consumeCredits(1);

            } catch (error) {
                results.push({ url, success: false, error: error.message });
                failCount++;
            }
        }

        await req.logSuccess({
            case: 'tiktok_download',
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
        await req.logError(500, error.message, { case: 'tiktok_download' });
        return response.error(res, error.message, 500);
    }
}));

module.exports = router;
