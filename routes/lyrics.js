// ===== ROUTES/LYRICS.JS =====
// Lyrics Downloader para Alauda API

const express = require('express');
const router = express.Router();
const axios = require('axios');
const authenticateApiKey = require('../middleware/auth');
const response = require('../utils/responseHandler');
const constants = require('../config/constants');

/**
 * Busca letra da música via Lyrics.ovh API
 */
async function getLyrics(artist, title) {
    try {
        const lyricsResponse = await axios.get(
            `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
            {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Alauda-API/1.0'
                }
            }
        );

        if (!lyricsResponse.data.lyrics) {
            throw new Error('Letra não encontrada');
        }

        return {
            success: true,
            artist: artist,
            title: title,
            lyrics: lyricsResponse.data.lyrics.trim()
        };

    } catch (error) {
        console.error('❌ Erro ao buscar letra:', error.message);

        if (error.response?.status === 404) {
            throw new Error('Letra não encontrada para esta música');
        } else if (error.request) {
            throw new Error('Sem resposta da API de Lyrics');
        } else {
            throw new Error(error.message);
        }
    }
}

/**
 * Busca informações da música no Genius (metadados)
 */
async function searchGenius(query) {
    try {
        const geniusResponse = await axios.get(
            `https://genius-song-lyrics1.p.rapidapi.com/search/`,
            {
                params: {
                    q: query,
                    per_page: 5,
                    page: 1
                },
                headers: {
                    'x-rapidapi-host': 'genius-song-lyrics1.p.rapidapi.com',
                    'x-rapidapi-key': process.env.RAPIDAPI_KEY || 'sua_key_aqui'
                },
                timeout: 10000
            }
        );

        if (!geniusResponse.data.hits || geniusResponse.data.hits.length === 0) {
            return null;
        }

        const hits = geniusResponse.data.hits.map(hit => ({
            id: hit.result.id,
            title: hit.result.title,
            artist: hit.result.primary_artist.name,
            full_title: hit.result.full_title,
            url: hit.result.url,
            cover: hit.result.song_art_image_url,
            release_date: hit.result.release_date_for_display,
            stats: {
                pageviews: hit.result.stats?.pageviews || 0
            }
        }));

        return hits;

    } catch (error) {
        console.error('❌ Erro ao buscar no Genius:', error.message);
        return null;
    }
}

// ===== ROTAS =====

router.get('/info', (req, res) => {
    response.success(res, {
        endpoint: '/api/lyrics',
        description: 'Buscar letras de músicas',
        features: [
            'Busca por artista e título',
            'Busca inteligente com sugestões',
            'Metadados da música (Genius)',
            'Suporte a múltiplos idiomas'
        ],
        cost: `${constants.COSTS.LYRICS_SEARCH || 1} crédito(s) por busca`,
        usage: {
            method: 'POST',
            endpoint: '/api/lyrics/search',
            headers: {
                'X-API-Key': 'sua_api_key_aqui',
                'Content-Type': 'application/json'
            },
            body: {
                artist: 'Emicida',
                title: 'AmarElo'
            }
        }
    });
});

// Buscar letra por artista + título
router.post('/search', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { artist, title } = req.body;

        if (!artist || !title) {
            return response.validationError(res, [
                { field: 'artist', message: 'Nome do artista é obrigatório' },
                { field: 'title', message: 'Título da música é obrigatório' }
            ]);
        }

        // Buscar letra
        const lyricsData = await getLyrics(artist, title);

        // Buscar metadados no Genius (opcional, não consome créditos extras)
        const geniusData = await searchGenius(`${artist} ${title}`);
        const metadata = geniusData && geniusData.length > 0 ? geniusData[0] : null;

        await req.logSuccess({
            case: 'lyrics_search',
            artist: artist,
            title: title,
            found: true
        });

        return response.success(res, {
            ...lyricsData,
            metadata: metadata,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro na rota lyrics:', error);
        await req.logError(500, error.message, { case: 'lyrics_search' });

        if (error.message.includes('não encontrada')) {
            return response.error(res, 'Letra não encontrada. Verifique o nome do artista e título.', 404);
        }
        if (error.message.includes('timeout')) {
            return response.error(res, 'Timeout ao buscar letra. Tente novamente.', 504);
        }
        return response.error(res, error.message, 500);
    }
}));

// Buscar sugestões de músicas (só metadados, não consome créditos)
router.post('/suggestions', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { query } = req.body;

        if (!query) {
            return response.validationError(res, [
                { field: 'query', message: 'Query de busca é obrigatória' }
            ]);
        }

        const suggestions = await searchGenius(query);

        if (!suggestions || suggestions.length === 0) {
            return response.error(res, 'Nenhuma música encontrada', 404);
        }

        await req.logSuccess({
            case: 'lyrics_suggestions',
            query: query,
            results: suggestions.length
        });

        return response.success(res, {
            query: query,
            total: suggestions.length,
            suggestions: suggestions,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        await req.logError(500, error.message, { case: 'lyrics_suggestions' });
        return response.error(res, error.message, 500);
    }
}));

// Batch search de letras
router.post('/batch', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { songs } = req.body;

        if (!songs || !Array.isArray(songs)) {
            return response.validationError(res, [
                { field: 'songs', message: 'Forneça um array de músicas [{artist, title}]' }
            ]);
        }
        if (songs.length === 0) {
            return response.validationError(res, [
                { field: 'songs', message: 'Array de músicas está vazio' }
            ]);
        }
        if (songs.length > 10) {
            return response.validationError(res, [
                { field: 'songs', message: 'Máximo de 10 músicas por vez' }
            ]);
        }

        if (!['pro', 'premium'].includes(req.apiKeyData.plan)) {
            return response.error(res, 'Batch search disponível apenas para planos PRO e PREMIUM', 403);
        }

        const totalCreditsNeeded = songs.length * (constants.COSTS.LYRICS_SEARCH || 1);
        if (!req.apiKeyData.hasCredits(totalCreditsNeeded)) {
            return response.insufficientCredits(res, totalCreditsNeeded, req.apiKeyData.credits);
        }

        const results = [];
        let successCount = 0;
        let failCount = 0;

        for (const song of songs) {
            try {
                if (!song.artist || !song.title) {
                    results.push({ 
                        artist: song.artist, 
                        title: song.title, 
                        success: false, 
                        error: 'Artist e title são obrigatórios' 
                    });
                    failCount++;
                    continue;
                }

                const lyricsData = await getLyrics(song.artist, song.title);
                results.push({ 
                    artist: song.artist,
                    title: song.title,
                    success: true, 
                    data: lyricsData 
                });
                successCount++;

                await req.apiKeyData.consumeCredits(1);

            } catch (error) {
                results.push({ 
                    artist: song.artist,
                    title: song.title,
                    success: false, 
                    error: error.message 
                });
                failCount++;
            }
        }

        await req.logSuccess({
            case: 'lyrics_batch',
            total: songs.length,
            success: successCount,
            failed: failCount
        });

        return response.success(res, {
            total: songs.length,
            successful: successCount,
            failed: failCount,
            results,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        await req.logError(500, error.message, { case: 'lyrics_batch' });
        return response.error(res, error.message, 500);
    }
}));

module.exports = router;
