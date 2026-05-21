// ===== ROUTES/CURRENCY.JS =====
const express = require('express');
const router = express.Router();
const axios = require('axios');
const authenticateApiKey = require('../middleware/auth');
const response = require('../utils/responseHandler');
const constants = require('../config/constants');

router.get('/info', (req, res) => {
    response.success(res, {
        endpoint: '/api/currency',
        description: 'Cotação de moedas em tempo real',
        features: [
            'Conversão entre qualquer par de moedas',
            'Conversão com valor personalizado',
            'Suporte a MZN, BRL, USD, EUR e mais'
        ],
        cost: `${constants.COSTS.CURRENCY || 2} crédito(s) por consulta`,
        usage: {
            pair: {
                method: 'GET',
                endpoint: '/api/currency/convert?from=USD&to=MZN',
                headers: { 'X-API-Key': 'sua_api_key_aqui' }
            },
            with_amount: {
                method: 'GET',
                endpoint: '/api/currency/convert?from=USD&to=MZN&amount=100',
                headers: { 'X-API-Key': 'sua_api_key_aqui' }
            }
        }
    });
});

router.get('/convert', authenticateApiKey, response.asyncHandler(async (req, res) => {
    const { from, to, amount = 1 } = req.query;

    if (!from || !to) {
        return response.validationError(res, [{
            field: 'from/to',
            message: 'Parâmetros from e to são obrigatórios. Ex: from=USD&to=MZN'
        }]);
    }

    if (isNaN(amount) || Number(amount) <= 0) {
        return response.validationError(res, [{
            field: 'amount',
            message: 'Valor deve ser um número positivo'
        }]);
    }

    try {
        const { data } = await axios.get(
            `https://v6.exchangerate-api.com/v6/${process.env.EXCHANGERATE_API_KEY}/pair/${from.toUpperCase()}/${to.toUpperCase()}`
        );

        if (data.result !== 'success') {
            return response.error(res, 'Par de moedas inválido', 400);
        }

        const rate = data.conversion_rate;
        const converted = (Number(amount) * rate).toFixed(2);

        await req.logSuccess({
            case: 'currency_convert',
            from: from.toUpperCase(),
            to: to.toUpperCase(),
            amount: Number(amount)
        });

        return response.success(res, {
            from: from.toUpperCase(),
            to: to.toUpperCase(),
            rate,
            amount: Number(amount),
            result: Number(converted),
            last_updated: data.time_last_update_utc,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        await req.logError(500, error.message, { case: 'currency_convert' });

        if (error.response?.status === 404) {
            return response.error(res, 'Par de moedas não encontrado', 404);
        }

        return response.error(res, error.message, 500);
    }
}));

module.exports = router;
