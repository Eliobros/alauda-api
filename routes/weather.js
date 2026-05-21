// ===== ROUTES/WEATHER.JS =====
const express = require('express');
const router = express.Router();
const axios = require('axios');
const authenticateApiKey = require('../middleware/auth');
const response = require('../utils/responseHandler');
const constants = require('../config/constants');

router.get('/info', (req, res) => {
    response.success(res, {
        endpoint: '/api/weather',
        description: 'Previsão do tempo usando OpenWeatherMap',
        features: [
            'Clima atual por cidade',
            'Clima atual por coordenadas',
            'Temperatura, humidade, vento e mais',
            'Descrição em português'
        ],
        cost: `${constants.COSTS.WEATHER || 5} crédito(s) por consulta`,
        usage: {
            by_city: {
                method: 'GET',
                endpoint: '/api/weather/current?city=Maputo',
                headers: { 'X-API-Key': 'sua_api_key_aqui' }
            },
            by_coords: {
                method: 'GET',
                endpoint: '/api/weather/current?lat=-25.9&lon=32.5',
                headers: { 'X-API-Key': 'sua_api_key_aqui' }
            }
        }
    });
});

router.get('/current', authenticateApiKey, response.asyncHandler(async (req, res) => {
    const { city, lat, lon } = req.query;

    if (!city && (!lat || !lon)) {
        return response.validationError(res, [{
            field: 'city ou lat/lon',
            message: 'Informe uma cidade ou coordenadas (lat e lon)'
        }]);
    }

    try {
        const params = {
            appid: process.env.OPENWEATHER_API_KEY,
            units: 'metric',
            lang: 'pt'
        };

        if (city) {
            params.q = city;
        } else {
            params.lat = lat;
            params.lon = lon;
        }

        const { data } = await axios.get(
            'https://api.openweathermap.org/data/2.5/weather',
            { params }
        );

        const result = {
            city: data.name,
            country: data.sys.country,
            coordinates: {
                lat: data.coord.lat,
                lon: data.coord.lon
            },
            weather: {
                description: data.weather[0].description,
                icon: `https://openweathermap.org/img/wn/${data.weather[0].icon}@2x.png`
            },
            temperature: {
                current: data.main.temp,
                feels_like: data.main.feels_like,
                min: data.main.temp_min,
                max: data.main.temp_max
            },
            humidity: data.main.humidity,
            pressure: data.main.pressure,
            wind: {
                speed: data.wind.speed,
                deg: data.wind.deg
            },
            visibility: data.visibility,
            clouds: data.clouds.all,
            sunrise: new Date(data.sys.sunrise * 1000).toISOString(),
            sunset: new Date(data.sys.sunset * 1000).toISOString()
        };

        await req.logSuccess({
            case: 'weather_current',
            city: result.city,
            country: result.country
        });

        return response.success(res, {
            weather: result,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        await req.logError(500, error.message, { case: 'weather_current' });

        if (error.response?.status === 404) {
            return response.error(res, 'Cidade não encontrada', 404);
        }

        return response.error(res, error.message, 500);
    }
}));

module.exports = router;
