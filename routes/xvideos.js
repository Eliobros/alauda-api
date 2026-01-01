// ===== ROUTES/XVIDEOS.JS =====
// XVideos Search & Downloader para Alauda API

const express = require('express');
const router = express.Router();
const axios = require('axios');
const authenticateApiKey = require('../middleware/auth');
const response = require('../utils/responseHandler');
const constants = require('../config/constants');

// Configuração da API RapidAPI
const RAPIDAPI_CONFIG = {
    host: 'xvideos-api-video-downloader-search-stars-tags.p.rapidapi.com',
    key: process.env.RAPIDAPI_XVIDEOS_KEY, // Coloque no .env
    baseUrl: 'https://xvideos-api-video-downloader-search-stars-tags.p.rapidapi.com'
};

/**
 * Valida URL do XVideos
 */
function isValidXVideosUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return /^https?:\/\/(www\.)?xvideos\.com\/video\.[a-zA-Z0-9_-]+/.test(url);
}

/**
 * Busca vídeos no XVideos
 */
async function searchXVideos(query, options = {}) {
    try {
        const params = {
            query: query,
            page: options.page || 1,
            sort: options.sort || 'views',
            date: options.date || '6month',
            duration: options.duration || '10-20min'
        };

        const searchResponse = await axios.get(`${RAPIDAPI_CONFIG.baseUrl}/search`, {
            params,
            headers: {
                'x-rapidapi-host': RAPIDAPI_CONFIG.host,
                'x-rapidapi-key': RAPIDAPI_CONFIG.key
            },
            timeout: 30000
        });

        // A API retorna um array direto
        if (!searchResponse.data || !Array.isArray(searchResponse.data) || searchResponse.data.length === 0) {
            throw new Error('Nenhum resultado encontrado');
        }

        return {
            success: true,
            total: searchResponse.data.length,
            page: params.page,
            videos: searchResponse.data.map(video => ({
                title: video.title,
                url: video.video_link,
                thumbnail: video.preview,
                duration: video.duration,
                views: video.views,
                quality: video.quality,
                author: video.author,
                author_id: video.author_id
            }))
        };

    } catch (error) {
        console.error('❌ Erro ao buscar XVideos:', error.message);
        
        if (error.response) {
            throw new Error(`Erro da API RapidAPI: ${error.response.status}`);
        } else if (error.request) {
            throw new Error('Sem resposta da API RapidAPI');
        } else {
            throw new Error(error.message);
        }
    }
}

/**
 * Baixa vídeo do XVideos
 */
async function downloadXVideo(url) {
    try {
        const downloadResponse = await axios.get(`${RAPIDAPI_CONFIG.baseUrl}/download_video`, {
            params: { url },
            headers: {
                'x-rapidapi-host': RAPIDAPI_CONFIG.host,
                'x-rapidapi-key': RAPIDAPI_CONFIG.key
            },
            timeout: 60000
        });

        // A API retorna um objeto direto
        if (!downloadResponse.data || !downloadResponse.data.url) {
            throw new Error('Erro ao processar download do vídeo');
        }

        const data = downloadResponse.data;

        return {
            success: true,
            video: {
                download_url: data.url,
                resolution: data.resolution,
                filesize_mb: data.filesize,
                bitrate: data.tbr,
                video_id: data.id,
                note: data.comment || 'O arquivo estará disponível por 10 minutos após estar pronto (20-300 segundos)',
                warning: '⚠️ O vídeo pode levar de 20 a 300 segundos para ficar pronto. Se der erro 404, aguarde um pouco e tente novamente.'
            }
        };

    } catch (error) {
        console.error('❌ Erro ao baixar XVideo:', error.message);
        
        if (error.response) {
            throw new Error(`Erro da API RapidAPI: ${error.response.status}`);
        } else if (error.request) {
            throw new Error('Sem resposta da API RapidAPI');
        } else {
            throw new Error(error.message);
        }
    }
}

// ===== ROTAS =====

/**
 * GET /api/xvideos/info
 * Informações sobre o serviço
 */
router.get('/info', (req, res) => {
    response.success(res, {
        endpoint: '/api/xvideos',
        description: 'XVideos search and video downloader',
        features: [
            'Busca de vídeos por query',
            'Download de vídeos em HD',
            'Informações completas do vídeo',
            'Download automático (busca + download)'
        ],
        plans_required: ['PRO', 'PREMIUM'],
        costs: {
            search: '10 créditos por busca',
            download: '50 créditos por download',
            auto: '100 créditos (busca + download automático do primeiro resultado)'
        },
        routes: {
            search: {
                method: 'POST',
                endpoint: '/api/xvideos/search',
                description: 'Busca vídeos e retorna lista de resultados',
                cost: 10,
                body: {
                    query: 'termo de busca',
                    page: 1,
                    sort: 'views|rating|date',
                    date: 'today|week|month|3month|6month|year|all',
                    duration: '1-3min|3-10min|10-20min|20min_more'
                }
            },
            download: {
                method: 'POST',
                endpoint: '/api/xvideos/download',
                description: 'Download direto de vídeo específico',
                cost: 50,
                body: {
                    url: 'https://www.xvideos.com/video.xxxxx/titulo'
                }
            },
            auto: {
                method: 'POST',
                endpoint: '/api/xvideos/auto',
                description: 'Busca + download automático do primeiro resultado',
                cost: 100,
                body: {
                    query: 'termo de busca'
                }
            }
        },
        usage_example: {
            headers: {
                'X-API-Key': 'sua_api_key_aqui',
                'Content-Type': 'application/json'
            }
        }
    });
});

/**
 * POST /api/xvideos/search
 * Busca vídeos (10 créditos)
 */
router.post('/search', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        // Verificar plano
        if (!['pro', 'premium'].includes(req.apiKeyData.plan)) {
            return response.error(res, 'Este serviço está disponível apenas para planos PRO e PREMIUM', 403);
        }

        // Verificar créditos
        const COST = 10;
        if (!req.apiKeyData.hasCredits(COST)) {
            return response.insufficientCredits(res, COST, req.apiKeyData.credits);
        }

        const { query, page, sort, date, duration } = req.body;

        if (!query) {
            return response.validationError(res, [{ field: 'query', message: 'Query de busca é obrigatória' }]);
        }

        // Buscar vídeos
        const result = await searchXVideos(query, { page, sort, date, duration });

        // Consumir créditos
        await req.apiKeyData.consumeCredits(COST);

        await req.logSuccess({
            case: 'xvideos_search',
            query,
            results: result.videos.length,
            page: result.page
        });

        return response.success(res, {
            ...result,
            credits_used: COST,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro na rota XVideos Search:', error);
        await req.logError(500, error.message, { case: 'xvideos_search' });

        if (error.message.includes('timeout')) {
            return response.error(res, 'Timeout ao buscar vídeos. Tente novamente.', 504);
        }
        if (error.message.includes('RapidAPI')) {
            return response.serviceUnavailable(res, 'XVideos API');
        }
        return response.error(res, error.message, 500);
    }
}));

/**
 * POST /api/xvideos/download
 * Download direto de vídeo (50 créditos)
 */
router.post('/download', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        // Verificar plano
        if (!['pro', 'premium'].includes(req.apiKeyData.plan)) {
            return response.error(res, 'Este serviço está disponível apenas para planos PRO e PREMIUM', 403);
        }

        // Verificar créditos
        const COST = 50;
        if (!req.apiKeyData.hasCredits(COST)) {
            return response.insufficientCredits(res, COST, req.apiKeyData.credits);
        }

        const { url } = req.body;

        if (!url) {
            return response.validationError(res, [{ field: 'url', message: 'URL do vídeo é obrigatória' }]);
        }

        if (!isValidXVideosUrl(url)) {
            return response.validationError(res, [{
                field: 'url',
                message: 'URL do XVideos inválida. Use o formato: https://www.xvideos.com/video.xxxxx/titulo'
            }]);
        }

        // Download do vídeo
        const result = await downloadXVideo(url);

        // Consumir créditos
        await req.apiKeyData.consumeCredits(COST);

        await req.logSuccess({
            case: 'xvideos_download',
            url,
            video_id: result.video.video_id
        });

        return response.success(res, {
            ...result.video,
            credits_used: COST,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro na rota XVideos Download:', error);
        await req.logError(500, error.message, { case: 'xvideos_download' });

        if (error.message.includes('timeout')) {
            return response.error(res, 'Timeout ao baixar vídeo. Tente novamente.', 504);
        }
        if (error.message.includes('RapidAPI')) {
            return response.serviceUnavailable(res, 'XVideos API');
        }
        return response.error(res, error.message, 500);
    }
}));

/**
 * POST /api/xvideos/auto
 * Busca + Download automático do primeiro resultado (100 créditos)
 */
router.post('/auto', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        // Verificar plano
        if (!['pro', 'premium'].includes(req.apiKeyData.plan)) {
            return response.error(res, 'Este serviço está disponível apenas para planos PRO e PREMIUM', 403);
        }

        // Verificar créditos
        const COST = 100;
        if (!req.apiKeyData.hasCredits(COST)) {
            return response.insufficientCredits(res, COST, req.apiKeyData.credits);
        }

        const { query } = req.body;

        if (!query) {
            return response.validationError(res, [{ field: 'query', message: 'Query de busca é obrigatória' }]);
        }

        // 1. Buscar vídeos
        const searchResult = await searchXVideos(query);

        if (!searchResult.videos || searchResult.videos.length === 0) {
            return response.error(res, 'Nenhum vídeo encontrado para esta busca', 404);
        }

        // 2. Pegar primeiro resultado
        const firstVideo = searchResult.videos[0];

        // 3. Baixar o primeiro vídeo
        const downloadResult = await downloadXVideo(firstVideo.url);

        // Consumir créditos
        await req.apiKeyData.consumeCredits(COST);

        await req.logSuccess({
            case: 'xvideos_auto',
            query,
            video_url: firstVideo.url,
            video_id: downloadResult.video.video_id
        });

        return response.success(res, {
            query_used: query,
            search_results_total: searchResult.total,
            selected_video: firstVideo,
            ...downloadResult.video,
            credits_used: COST,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro na rota XVideos Auto:', error);
        await req.logError(500, error.message, { case: 'xvideos_auto' });

        if (error.message.includes('timeout')) {
            return response.error(res, 'Timeout ao processar requisição. Tente novamente.', 504);
        }
        if (error.message.includes('RapidAPI')) {
            return response.serviceUnavailable(res, 'XVideos API');
        }
        return response.error(res, error.message, 500);
    }
}));

module.exports = router;
