// ===== ROUTES/PHOTOS.JS =====
const express = require('express');
const router = express.Router();
const axios = require('axios');
const authenticateApiKey = require('../middleware/auth');
const response = require('../utils/responseHandler');
const constants = require('../config/constants');

router.get('/info', (req, res) => {
    response.success(res, {
        endpoint: '/api/photos',
        description: 'Busca de fotos usando Pexels',
        features: [
            'Busca por palavra-chave',
            'Múltiplos tamanhos de imagem',
            'Informações do fotógrafo',
            'Paginação de resultados'
        ],
        cost: `${constants.COSTS.PHOTO_SEARCH || 3} crédito(s) por busca`,
        usage: {
            search: {
                method: 'GET',
                endpoint: '/api/photos/search?query=nature&per_page=10&page=1',
                headers: { 'X-API-Key': 'sua_api_key_aqui' }
            }
        }
    });
});

router.get('/search', authenticateApiKey, response.asyncHandler(async (req, res) => {
    const { query, per_page = 10, page = 1 } = req.query;

    if (!query) {
        return response.validationError(res, [{
            field: 'query',
            message: 'Parâmetro query é obrigatório'
        }]);
    }

    if (per_page > 50) {
        return response.validationError(res, [{
            field: 'per_page',
            message: 'Máximo de 50 fotos por página'
        }]);
    }

    try {
        const { data } = await axios.get('https://api.pexels.com/v1/search', {
            headers: { Authorization: process.env.PEXELS_API_KEY },
            params: { query, per_page, page }
        });

        const photos = data.photos.map(photo => ({
            id: photo.id,
            url: photo.url,
            alt: photo.alt,
            avg_color: photo.avg_color,
            photographer: {
                name: photo.photographer,
                url: photo.photographer_url
            },
            src: {
                original: photo.src.original,
                large: photo.src.large,
                medium: photo.src.medium,
                small: photo.src.small,
                tiny: photo.src.tiny
            },
            dimensions: {
                width: photo.width,
                height: photo.height
            }
        }));

        await req.logSuccess({
            case: 'photo_search',
            query,
            total_results: data.total_results,
            returned: photos.length
        });

        return response.success(res, {
            query,
            page: Number(page),
            per_page: Number(per_page),
            total_results: data.total_results,
            photos,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        await req.logError(500, error.message, { case: 'photo_search', query });

        if (error.response?.status === 401) {
            return response.error(res, 'Chave Pexels inválida', 401);
        }

        return response.error(res, error.message, 500);
    }
}));

module.exports = router;
