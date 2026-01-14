// ===== ROUTES/FACEBOOK.JS =====
// Facebook Video/Reel Downloader para Alauda API

const express = require('express');
const router = express.Router();
const axios = require('axios');
const authenticateApiKey = require('../middleware/auth');
const response = require('../utils/responseHandler');
const constants = require('../config/constants');

/**
 * Valida URL do Facebook
 */
function isValidFacebookUrl(url) {
    if (!url || typeof url !== 'string') return false;
    // Aceita: facebook.com/watch, facebook.com/reel, facebook.com/share, fb.watch
    const facebookPattern = /^https?:\/\/(www\.)?(facebook\.com\/(watch|reel|share|video)|fb\.watch)/i;
    return facebookPattern.test(url);
}

/**
 * Converte URLs do Facebook para formato compatível com a API
 * A API só aceita /share/r/... então precisamos converter /reel/... 
 */
function convertToShareFormat(url) {
    // Se já está no formato /share/r/, retorna como está
    if (url.includes('/share/r/')) {
        return url;
    }
    
    // Extrai o ID do reel e converte para formato /share/r/
    const reelMatch = url.match(/\/reel\/(\d+)/);
    if (reelMatch) {
        // Infelizmente não conseguimos converter automaticamente
        // porque o formato /share/r/ usa um código diferente
        return url; // Retorna original e deixa a API tentar processar
    }
    
    return url;
}

/**
 * Baixa vídeo/reel do Facebook via RapidAPI
 */
async function downloadFacebook(url) {
    try {
        const rapidApiResponse = await axios.post(
            'https://facebook-media-downloader1.p.rapidapi.com/get_media',
            { url: url },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-rapidapi-host': 'facebook-media-downloader1.p.rapidapi.com',
                    'x-rapidapi-key': process.env.RAPIDAPI_KEY || '581eef45eemsh242fbe5e00e1e11p187affjsne6cd8fd6a1d2'
                },
                timeout: 30000
            }
        );

        const data = rapidApiResponse.data;

        // Verifica se houve erro
        if (data.status !== 200 || !data.direct_media_url) {
            throw new Error('Erro ao processar vídeo do Facebook. Verifique se o vídeo é público.');
        }

        // ✅ RETORNA MÚLTIPLAS QUALIDADES
        return {
            success: true,
            post: {
                title: data.title || 'Facebook Video',
                
                // URL padrão (prioriza SD se existir, pois geralmente tem áudio)
                url: data.sd_url || data.direct_media_url,
                
                // URLs de diferentes qualidades
                url_hd: data.hd_url || data.direct_media_url,  // HD (pode não ter áudio)
                url_sd: data.sd_url || null,  // SD (geralmente COM áudio)
                
                // Aviso importante sobre áudio
                audio_warning: !data.sd_url 
                    ? "⚠️ Vídeo pode estar sem áudio. Use outra URL do Facebook ou tente /share/r/ format"
                    : "✅ Use 'url_sd' para garantir áudio no vídeo",
                
                thumbnail: data.thumbnail || null,
                duration: null,
                size: null,
                format: data.media_type === 'video' ? 'mp4' : 'unknown',
                quality: data.sd_url ? 'SD (com áudio)' : 'HD (possível sem áudio)',
                
                // Dados extras
                original_url: url,
                media_type: data.media_type
            }
        };

    } catch (error) {
        console.error('❌ Erro ao baixar Facebook:', error.message);

        if (error.response) {
            const status = error.response.status;
            const errorMsg = error.response.data?.message || 'Erro desconhecido';
            throw new Error(`Erro da API: ${status} - ${errorMsg}`);
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
        endpoint: '/api/facebook',
        description: 'Facebook video/reel downloader',
        features: [
            'Download de vídeos públicos',
            'Download de Reels do Facebook',
            'Download de vídeos de páginas',
            'Thumbnail em HD',
            'Suporte a múltiplos formatos de URL'
        ],
        limitations: [
            'Vídeos públicos apenas',
            'Não funciona com vídeos privados ou de grupos fechados',
            'Rate limit: 1000 requests/mês (plano FREE)'
        ],
        cost: `${constants.COSTS.FACEBOOK_DOWNLOAD || 1} crédito(s) por download`,
        usage: {
            method: 'POST',
            endpoint: '/api/facebook/download',
            headers: {
                'X-API-Key': 'sua_api_key_aqui',
                'Content-Type': 'application/json'
            },
            body: {
                url: 'https://www.facebook.com/watch?v=... ou https://www.facebook.com/share/v/...'
            }
        },
        supported_urls: [
            'https://www.facebook.com/watch?v=...',
            'https://www.facebook.com/share/r/... (RECOMENDADO)',
            'https://www.facebook.com/share/v/...',
            'https://fb.watch/...',
            'NOTA: URLs do tipo /reel/... podem não funcionar. Use o botão "Compartilhar" > "Copiar link" para obter a URL correta.'
        ]
    });
});

router.post('/download', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { url } = req.body;

        // Validações
        if (!url) {
            return response.validationError(res, [{ 
                field: 'url', 
                message: 'URL do Facebook é obrigatória' 
            }]);
        }

        if (!isValidFacebookUrl(url)) {
            return response.validationError(res, [{
                field: 'url',
                message: 'URL do Facebook inválida. Use: https://www.facebook.com/watch?v=... ou /reel/... ou /share/v/...'
            }]);
        }

        // Download
        const result = await downloadFacebook(url);

        // Log de sucesso
        await req.logSuccess({
            case: 'facebook_download',
            url: result.post.original_url,
            type: result.post.media_type
        });

        // Resposta
        return response.download(res, {
            ...result.post,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro na rota Facebook:', error);
        await req.logError(500, error.message, { case: 'facebook_download' });

        // Tratamento de erros específicos
        if (error.message.includes('timeout')) {
            return response.error(res, 'Timeout ao processar vídeo. Tente novamente.', 504);
        }
        if (error.message.includes('403') || error.message.includes('401')) {
            return response.error(res, 'Acesso negado. Verifique se o vídeo é público.', 403);
        }
        if (error.message.includes('404')) {
            return response.error(res, 'Vídeo não encontrado. Verifique a URL.', 404);
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
                message: 'URL do Facebook é obrigatória' 
            }]);
        }

        if (!isValidFacebookUrl(url)) {
            return response.validationError(res, [{ 
                field: 'url', 
                message: 'URL do Facebook inválida' 
            }]);
        }

        const result = await downloadFacebook(url);

        // Remove link de download (apenas informações)
        delete result.post.url;

        await req.logSuccess({
            case: 'facebook_info',
            url: result.post.original_url,
            type: result.post.media_type,
            info_only: true
        });

        return response.info(res, {
            ...result.post,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        await req.logError(500, error.message, { case: 'facebook_info' });
        return response.error(res, error.message, 500);
    }
}));

router.post('/batch', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { urls } = req.body;

        // Validações
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

        // Verifica se o plano permite batch
        if (!['pro', 'premium'].includes(req.apiKeyData.plan)) {
            return response.error(res, 'Batch download disponível apenas para planos PRO e PREMIUM', 403);
        }

        // Verifica créditos
        const creditCost = constants.COSTS.FACEBOOK_DOWNLOAD || 1;
        const totalCreditsNeeded = urls.length * creditCost;

        if (!req.apiKeyData.hasCredits(totalCreditsNeeded)) {
            return response.insufficientCredits(res, totalCreditsNeeded, req.apiKeyData.credits);
        }

        // Processa URLs
        const results = [];
        let successCount = 0;
        let failCount = 0;

        for (const url of urls) {
            try {
                if (!isValidFacebookUrl(url)) {
                    results.push({ url, success: false, error: 'URL inválida' });
                    failCount++;
                    continue;
                }

                const result = await downloadFacebook(url);
                results.push({ url, success: true, data: result.post });
                successCount++;

                // Consome créditos
                await req.apiKeyData.consumeCredits(creditCost);

            } catch (error) {
                results.push({ url, success: false, error: error.message });
                failCount++;
            }
        }

        // Log
        await req.logSuccess({
            case: 'facebook_batch',
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
        await req.logError(500, error.message, { case: 'facebook_batch' });
        return response.error(res, error.message, 500);
    }
}));

module.exports = router;
