// ===== ROUTES/YOUTUBE.JS =====
// YouTube Downloader para Alauda API

const express = require('express');
const router = express.Router();
const axios = require('axios');
const authenticateApiKey = require('../middleware/auth');
const response = require('../utils/responseHandler');
const constants = require('../config/constants');

// User-Agent de browser real — o YouTube bloqueia requests sem UA
const YT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

/**
 * Busca vídeos no YouTube (scraping do próprio YouTube, sem chave externa)
 * Extrai os resultados do JSON `ytInitialData` da página de resultados.
 */
async function searchYouTube(query, maxResults = 10) {
    try {
        const { data } = await axios.get('https://www.youtube.com/results', {
            params: { search_query: query },
            headers: {
                'User-Agent': YT_UA,
                'Accept-Language': 'pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            timeout: 15000
        });

        // Extrai o JSON `ytInitialData` embutido na página
        const match = data.match(/var ytInitialData = (\{.*?\});<\/script>/s);
        if (!match) {
            throw new Error('Não foi possível ler os resultados do YouTube');
        }

        const initialData = JSON.parse(match[1]);
        const videos = [];

        // Percorre o JSON procurando todos os videoRenderer
        const walk = (obj) => {
            if (!obj || typeof obj !== 'object') return;

            if (obj.videoRenderer) {
                const vr = obj.videoRenderer;
                const videoId = vr.videoId;
                if (!videoId) return;

                const title = vr.title?.runs?.[0]?.text || vr.title?.simpleText || '';
                const length = vr.lengthText?.simpleText || null;
                const views = vr.viewCountText?.simpleText || null;
                const published = vr.publishedTimeText?.simpleText || null;
                const channel = vr.ownerText?.runs?.[0]?.text || null;
                const channelId = vr.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || null;
                const thumb = vr.thumbnail?.thumbnails?.[0]?.url || null;

                // Remove parâmetros de tracking da thumbnail
                const cleanThumb = thumb ? thumb.split('?')[0] : null;

                videos.push({
                    id: videoId,
                    title,
                    url: `https://www.youtube.com/watch?v=${videoId}`,
                    thumbnail: cleanThumb,
                    duration: length,
                    views,
                    published,
                    channel,
                    channel_id: channelId
                });
                return;
            }

            if (Array.isArray(obj)) {
                obj.forEach(walk);
            } else {
                Object.values(obj).forEach(walk);
            }
        };

        walk(initialData);

        if (videos.length === 0) {
            throw new Error('Nenhum resultado encontrado');
        }

        return {
            success: true,
            query,
            count: videos.length,
            videos: videos.slice(0, maxResults)
        };

    } catch (error) {
        console.error('❌ Erro ao buscar no YouTube:', error.message);

        if (error.response?.status === 429) {
            throw new Error('Limite de requisições atingido. Tente novamente em alguns minutos.');
        }
        if (error.message.includes('Nenhum resultado') || error.message.includes('ler os resultados')) {
            throw error;
        }
        throw new Error('Erro ao buscar vídeos no YouTube');
    }
}

/**
 * Valida URL do YouTube
 */
function isValidYouTubeUrl(url) {
    if (!url || typeof url !== 'string') return false;
    // Aceita: youtube.com/watch?v=, youtu.be/, youtube.com/shorts/
    const patterns = [
        /^https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]+/,
        /^https?:\/\/youtu\.be\/[\w-]+/,
        /^https?:\/\/(www\.)?youtube\.com\/shorts\/[\w-]+/
    ];
    return patterns.some(pattern => pattern.test(url));
}

/**
 * Baixa vídeo/áudio do YouTube via RapidAPI
 */
async function downloadYouTube(url, format = 'mp3', quality = '128') {
    try {
        // 1️⃣ Primeira requisição: iniciar processamento
        const downloadResponse = await axios.get(
            'https://youtube-info-download-api.p.rapidapi.com/ajax/download.php',
            {
                params: {
                    format: format,
                    url: url,
                    audio_quality: quality,
                    add_info: '0',
                    allow_extended_duration: 'false',
                    no_merge: 'false',
                    audio_language: 'en'
                },
                headers: {
                    'x-rapidapi-host': 'youtube-info-download-api.p.rapidapi.com',
                    'x-rapidapi-key': '581eef45eemsh242fbe5e00e1e11p187affjsne6cd8fd6a1d2'
                },
                timeout: 30000
            }
        );

        if (!downloadResponse.data.success) {
            throw new Error(downloadResponse.data.message || 'Erro ao processar vídeo');
        }

        const data = downloadResponse.data;
        console.log('📥 Resposta inicial:', { id: data.id, title: data.title });

        // 2️⃣ Segunda requisição: pegar link de download (AUTOMÁTICO)
        let downloadUrl = null;
        let alternativeUrls = [];
        
        if (data.progress_url) {
            console.log('🔗 Buscando link em:', data.progress_url);
            
            // Tenta até 15 vezes (45 segundos total)
            for (let i = 0; i < 50; i++) {
                try {
                    const progressResponse = await axios.get(data.progress_url, {
                        timeout: 10000
                    });
                    
                    const progress = progressResponse.data.progress || 0;
                    const progressPercent = (progress / 10).toFixed(1);
                    
                    console.log(`⏳ Tentativa ${i + 1}/15 - Progresso: ${progressPercent}%`);

                    // Se encontrou o link, pega e sai
                    if (progressResponse.data.download_url) {
                        downloadUrl = progressResponse.data.download_url;
                        alternativeUrls = progressResponse.data.alternative_download_urls || [];
                        console.log('✅ Link encontrado:', downloadUrl);
                        break;
                    }

                    // Se já terminou mas não tem link, espera mais um pouco
                    if (progress >= 1000) {
                        console.log('⚠️ Processamento completo, aguardando link...');
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        continue;
                    }

                    // Aguarda 3 segundos antes da próxima tentativa
                    if (i < 14) {
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    }

                } catch (progressError) {
                    console.log(`⚠️ Erro na tentativa ${i + 1}:`, progressError.message);
                    if (i < 14) {
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                }
            }

            if (!downloadUrl) {
                console.log('❌ Link não disponível após 15 tentativas');
            }
        }

        return {
            success: true,
            video: {
                id: data.id,
                title: data.title || 'Sem título',
                thumbnail: data.info?.image || null,
                format: format,
                quality: quality,
                download: {
                    url: downloadUrl,
                    alternative_urls: alternativeUrls.map(alt => ({
                        type: alt.type,
                        url: alt.url,
                        ssl: alt.has_ssl
                    })),
                    progress_url: data.progress_url
                },
                cache_hash: data.cachehash || null
            }
        };

    } catch (error) {
        console.error('❌ Erro ao baixar YouTube:', error.message);

        if (error.response) {
            if (error.response.status === 429) {
                throw new Error('Limite de requisições atingido. Tente novamente em alguns minutos.');
            }
            throw new Error(`Erro da API: ${error.response.status}`);
        } else if (error.request) {
            throw new Error('Sem resposta da API do YouTube');
        } else {
            throw new Error(error.message);
        }
    }
}

// ===== ROTAS =====

router.get('/info', (req, res) => {
    response.success(res, {
        endpoint: '/api/youtube',
        description: 'YouTube video/audio downloader',
        features: [
            'Busca de vídeos',
            'Download de áudio (MP3)',
            'Download de vídeo',
            'Qualidade selecionável',
            'Suporte a shorts',
            'URLs alternativas',
            'Batch download (PRO/PREMIUM)'
        ],
        search: {
            method: 'POST',
            endpoint: '/api/youtube/search',
            headers: {
                'X-API-Key': 'sua_api_key_aqui',
                'Content-Type': 'application/json'
            },
            body: {
                query: 'Rick Astley',
                max_results: 10
            }
        },
        formats: ['mp3', 'mp4'],
        qualities: {
            audio: ['128', '192', '256', '320'],
            video: ['360', '480', '720', '1080']
        },
        cost: `${constants.COSTS.YOUTUBE_DOWNLOAD || 2} crédito(s) por download`,
        usage: {
            method: 'POST',
            endpoint: '/api/youtube/download',
            headers: {
                'X-API-Key': 'sua_api_key_aqui',
                'Content-Type': 'application/json'
            },
            body: {
                url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                format: 'mp3',
                quality: '128'
            }
        }
    });
});

router.post('/search', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { query, max_results = 10 } = req.body;

        if (!query || typeof query !== 'string' || query.trim().length === 0) {
            return response.validationError(res, [{
                field: 'query',
                message: 'Query de busca é obrigatória'
            }]);
        }

        const maxResults = Math.min(Math.max(Number(max_results) || 10, 1), 25);

        console.log(`🔍 Buscando no YouTube: "${query}" (máx ${maxResults})`);

        const result = await searchYouTube(query.trim(), maxResults);

        await req.logSuccess({
            case: 'youtube_search',
            query: query,
            results: result.count
        });

        return response.success(res, {
            query: result.query,
            count: result.count,
            videos: result.videos,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro na busca do YouTube:', error);
        await req.logError(500, error.message, { case: 'youtube_search' });

        if (error.message.includes('Limite')) {
            return response.error(res, error.message, 429);
        }
        return response.error(res, error.message, 500);
    }
}));

router.post('/download', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { url, format = 'mp3', quality = '128' } = req.body;

        if (!url) {
            return response.validationError(res, [{
                field: 'url',
                message: 'URL do YouTube é obrigatória'
            }]);
        }

        if (!isValidYouTubeUrl(url)) {
            return response.validationError(res, [{
                field: 'url',
                message: 'URL do YouTube inválida. Use: youtube.com/watch?v=, youtu.be/ ou youtube.com/shorts/'
            }]);
        }

        // Valida formato
        const validFormats = ['mp3', 'mp4'];
        if (!validFormats.includes(format)) {
            return response.validationError(res, [{
                field: 'format',
                message: `Formato inválido. Use: ${validFormats.join(', ')}`
            }]);
        }

        console.log(`🎬 Processando: ${url} (${format}/${quality})`);

        const result = await downloadYouTube(url, format, quality);

        await req.logSuccess({
            case: 'youtube_download',
            video_id: result.video.id,
            title: result.video.title,
            format: format,
            quality: quality,
            has_download_url: !!result.video.download.url
        });

        return response.success(res, {
    ...result.video,
    credits_remaining: req.apiKeyData.credits
});

    } catch (error) {
        console.error('❌ Erro na rota YouTube:', error);
        await req.logError(500, error.message, { case: 'youtube_download' });

        if (error.message.includes('timeout')) {
            return response.error(res, 'Timeout ao processar vídeo. Tente novamente.', 504);
        }
        if (error.message.includes('Limite de requisições')) {
            return response.error(res, error.message, 429);
        }
        return response.error(res, error.message, 500);
    }
}));

router.post('/info-only', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return response.validationError(res, [{
                field: 'url',
                message: 'URL do YouTube é obrigatória'
            }]);
        }

        if (!isValidYouTubeUrl(url)) {
            return response.validationError(res, [{
                field: 'url',
                message: 'URL do YouTube inválida'
            }]);
        }

        const result = await downloadYouTube(url);
        
        // Remove links de download (info only)
        delete result.video.download;

        await req.logSuccess({
            case: 'youtube_info',
            video_id: result.video.id,
            title: result.video.title,
            info_only: true
        });

        return response.info(res, {
            ...result.video,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        await req.logError(500, error.message, { case: 'youtube_info' });
        return response.error(res, error.message, 500);
    }
}));

router.post('/batch', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { urls, format = 'mp3', quality = '128' } = req.body;

        if (!urls || !Array.isArray(urls)) {
            return response.validationError(res, [{
                field: 'urls',
                message: 'Forneça um array de URLs'
            }]);
        }

        if (urls.length === 0) {
            return response.validationError(res, [{
                field: 'urls',
                message: 'Array de URLs está vazio'
            }]);
        }

        if (urls.length > 10) {
            return response.validationError(res, [{
                field: 'urls',
                message: 'Máximo de 10 URLs por vez'
            }]);
        }

        if (!['pro', 'premium'].includes(req.apiKeyData.plan)) {
            return response.error(res, 'Batch download disponível apenas para planos PRO e PREMIUM', 403);
        }

        const totalCreditsNeeded = urls.length * (constants.COSTS.YOUTUBE_DOWNLOAD || 2);
        if (!req.apiKeyData.hasCredits(totalCreditsNeeded)) {
            return response.insufficientCredits(res, totalCreditsNeeded, req.apiKeyData.credits);
        }

        const results = [];
        let successCount = 0;
        let failCount = 0;

        for (const url of urls) {
            try {
                if (!isValidYouTubeUrl(url)) {
                    results.push({ url, success: false, error: 'URL inválida' });
                    failCount++;
                    continue;
                }

                const result = await downloadYouTube(url, format, quality);
                results.push({ url, success: true, data: result.video });
                successCount++;

                await req.apiKeyData.consumeCredits(constants.COSTS.YOUTUBE_DOWNLOAD || 2);

            } catch (error) {
                results.push({ url, success: false, error: error.message });
                failCount++;
            }
        }

        await req.logSuccess({
            case: 'youtube_batch',
            batch: true,
            total: urls.length,
            success: successCount,
            failed: failCount,
            format: format
        });

        return response.success(res, {
            total: urls.length,
            successful: successCount,
            failed: failCount,
            results,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        await req.logError(500, error.message, { case: 'youtube_batch' });
        return response.error(res, error.message, 500);
    }
}));

module.exports = router;
