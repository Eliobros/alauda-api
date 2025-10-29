// ===== ROUTES/SPOTIFY.JS =====
// Spotify Downloader via SoundCloud para Alauda API

const express = require('express');
const router = express.Router();
const axios = require('axios');
const authenticateApiKey = require('../middleware/auth');
const response = require('../utils/responseHandler');
const constants = require('../config/constants');

const RAPIDAPI_KEY = '581eef45eemsh242fbe5e00e1e11p187affjsne6cd8fd6a1d2';
const RAPIDAPI_HOST = 'spotify-scraper.p.rapidapi.com';

/**
 * Busca música no Spotify
 */
async function searchSpotify(query) {
    try {
        console.log(`🔍 Buscando no Spotify: "${query}"`);

        const searchResponse = await axios.get(
            'https://spotify-scraper.p.rapidapi.com/v1/search',
            {
                params: {
                    term: query,
                    type: 'track',
                    limit: 10
                },
                headers: {
                    'x-rapidapi-host': RAPIDAPI_HOST,
                    'x-rapidapi-key': RAPIDAPI_KEY
                },
                timeout: 15000
            }
        );

        console.log('✅ Busca concluída');

        return {
            success: true,
            tracks: searchResponse.data
        };

    } catch (error) {
        console.error('❌ Erro ao buscar no Spotify:', error.message);

        if (error.response?.status === 429) {
            throw new Error('Limite de requisições atingido. Tente novamente em alguns minutos.');
        }
        throw new Error('Erro ao buscar música');
    }
}

/**
 * Baixa música via SoundCloud
 */
async function downloadSpotify(track, quality = 'sq') {
    try {
        console.log(`🎵 Baixando: ${track}`);

        const downloadResponse = await axios.get(
            'https://spotify-scraper.p.rapidapi.com/v1/track/download/soundcloud',
            {
                params: {
                    track: track,
                    quality: quality
                },
                headers: {
                    'x-rapidapi-host': RAPIDAPI_HOST,
                    'x-rapidapi-key': RAPIDAPI_KEY
                },
                timeout: 30000
            }
        );

        console.log('✅ Download pronto');

        if (!downloadResponse.data.status) {
            throw new Error('Não foi possível processar a música');
        }

        return {
            success: true,
            data: downloadResponse.data
        };

    } catch (error) {
        console.error('❌ Erro ao baixar:', error.message);

        if (error.response?.status === 429) {
            throw new Error('Limite de requisições atingido. Tente novamente em alguns minutos.');
        }
        throw new Error('Erro ao baixar música');
    }
}

// ===== ROTAS =====

/**
 * GET /api/spotify/info
 */
router.get('/info', (req, res) => {
    response.success(res, {
        endpoint: '/api/spotify',
        description: 'Spotify music downloader via SoundCloud',
        features: [
            'Busca de músicas',
            'Download de áudio (MP3/Opus)',
            'Informações completas',
            'Via SoundCloud (mais estável)'
        ],
        cost: {
            search: `${constants.COSTS.SPOTIFY_SEARCH || 1} crédito(s)`,
            download: `${constants.COSTS.SPOTIFY_DOWNLOAD || 3} crédito(s)`
        }
    });
});

/**
 * POST /api/spotify/search
 */
router.post('/search', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { query } = req.body;

        if (!query || typeof query !== 'string' || query.trim().length === 0) {
            return response.validationError(res, [{
                field: 'query',
                message: 'Query de busca é obrigatória'
            }]);
        }

        console.log(`🎵 Buscando: "${query}"`);

        const result = await searchSpotify(query);

        await req.logSuccess({
            case: 'spotify_search',
            query: query
        });

        return response.success(res, {
            query: query,
            tracks: result.tracks,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro na busca:', error);
        await req.logError(500, error.message, { case: 'spotify_search' });

        if (error.message.includes('Limite')) {
            return response.error(res, error.message, 429);
        }
        return response.error(res, error.message, 500);
    }
}));

/**
 * POST /api/spotify/download
 */
router.post('/download', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { songId, track, quality = 'sq' } = req.body;

        const trackQuery = songId || track;

        if (!trackQuery) {
            return response.validationError(res, [{
                field: 'songId',
                message: 'Nome da música ou artista é obrigatório (ex: "Photograph Ed Sheeran")'
            }]);
        }

        console.log(`🎵 Processando: ${trackQuery}`);

        const result = await downloadSpotify(trackQuery, quality);

        await req.logSuccess({
            case: 'spotify_download',
            track: trackQuery
        });

        return response.success(res, {
            ...result.data,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro no download:', error);
        await req.logError(500, error.message, { case: 'spotify_download' });

        if (error.message.includes('Limite')) {
            return response.error(res, error.message, 429);
        }
        return response.error(res, error.message, 500);
    }
}));

module.exports = router;
