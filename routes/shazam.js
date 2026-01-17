// ===== ROUTES/SHAZAM.JS =====
// Shazam Music Recognition para Alauda API

const express = require('express');
const router = express.Router();
const axios = require('axios');
const FormData = require('form-data');
const multer = require('multer');
const authenticateApiKey = require('../middleware/auth');
const response = require('../utils/responseHandler');
const constants = require('../config/constants');

// Configuração do Multer para upload de arquivos
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB
    },
    fileFilter: (req, file, cb) => {
        const allowedFormats = [
            'audio/mpeg',      // MP3
            'audio/mp3',
            'audio/wav',       // WAV
            'audio/wave',
            'audio/x-wav',
            'audio/mp4',       // M4A
            'audio/m4a',
            'audio/x-m4a',
            'audio/ogg',       // OGG
            'audio/aac',       // AAC
            'audio/flac',      // FLAC
            'audio/webm'       // WEBM
        ];

        if (allowedFormats.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Formato de áudio não suportado. Use: MP3, WAV, M4A, OGG, AAC, FLAC, WEBM'));
        }
    }
});

/**
 * Valida URL de áudio
 */
function isValidAudioUrl(url) {
    if (!url || typeof url !== 'string') return false;

    try {
        new URL(url);
        const audioExtensions = ['.mp3', '.wav', '.m4a', '.ogg', '.aac', '.flac', '.webm'];
        return audioExtensions.some(ext => url.toLowerCase().includes(ext));
    } catch {
        return false;
    }
}

/**
 * Identifica música via RapidAPI Shazam (com buffer de áudio)
 */
async function identifyMusicFromBuffer(audioBuffer, originalName) {
    try {
        const formData = new FormData();
        formData.append('upload_file', audioBuffer, {
            filename: originalName || 'audio.mp3',
            contentType: 'audio/mpeg'
        });

        const rapidApiResponse = await axios.post(
            'https://shazam-api6.p.rapidapi.com/shazam/recognize/',
            formData,
            {
                headers: {
                    ...formData.getHeaders(),
                    'x-rapidapi-host': 'shazam-api6.p.rapidapi.com',
                    'x-rapidapi-key': process.env.RAPIDAPI_KEY || '581eef45eemsh242fbe5e00e1e11p187affjsne6cd8fd6a1d2'
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                timeout: 60000 // 60 segundos
            }
        );

        const data = rapidApiResponse.data;

        if (!data || !data.track) {
            throw new Error('Música não reconhecida. Tente com um áudio mais claro ou mais longo.');
        }

        return {
            success: true,
            music: {
                title: data.track.title || 'Desconhecido',
                artist: data.track.subtitle || 'Artista Desconhecido',
                album: data.track.sections?.[0]?.metadata?.find(m => m.title === 'Album')?.text || null,
                release_date: data.track.sections?.[0]?.metadata?.find(m => m.title === 'Released')?.text || null,
                genre: data.track.genres?.primary || null,
                cover_art: data.track.images?.coverart || data.track.share?.image || null,
                preview_url: data.track.hub?.actions?.find(a => a.type === 'uri')?.uri || null,
                shazam_url: data.track.url || null,
                apple_music: data.track.hub?.providers?.find(p => p.type === 'APPLEMUSIC')?.actions?.[0]?.uri || null,
                spotify: data.track.hub?.providers?.find(p => p.type === 'SPOTIFY')?.actions?.[0]?.uri || null,
                youtube: data.track.hub?.providers?.find(p => p.type === 'YOUTUBE')?.actions?.[0]?.uri || null,
                lyrics: data.track.sections?.find(s => s.type === 'LYRICS')?.text?.join('\n') || null,
                isrc: data.track.isrc || null
            }
        };

    } catch (error) {
        console.error('❌ Erro ao identificar música:', error.message);

        if (error.response) {
            throw new Error(`Erro da API Shazam: ${error.response.status} - ${error.response.data?.message || 'Erro desconhecido'}`);
        } else if (error.request) {
            throw new Error('Sem resposta da API Shazam. Tente novamente.');
        } else {
            throw new Error(error.message);
        }
    }
}

/**
 * Baixa áudio de URL e identifica
 */
async function identifyMusicFromUrl(url) {
    try {
        // Baixa o áudio
        const audioResponse = await axios.get(url, {
            responseType: 'arraybuffer',
            maxContentLength: 50 * 1024 * 1024, // 50MB
            timeout: 30000
        });

        const audioBuffer = Buffer.from(audioResponse.data);
        const filename = url.split('/').pop() || 'audio.mp3';

        return await identifyMusicFromBuffer(audioBuffer, filename);

    } catch (error) {
        console.error('❌ Erro ao baixar/identificar áudio:', error.message);

        if (error.message.includes('maxContentLength')) {
            throw new Error('Arquivo de áudio muito grande (máximo 50MB)');
        }

        throw new Error(`Erro ao processar URL: ${error.message}`);
    }
}

// ===== ROTAS =====

router.get('/info', (req, res) => {
    response.success(res, {
        endpoint: '/api/shazam',
        description: 'Reconhecimento de música usando Shazam',
        features: [
            'Identificação por upload de arquivo',
            'Identificação por URL de áudio',
            'Informações completas da música',
            'Links para streaming (Spotify, Apple Music, YouTube)',
            'Letra da música (quando disponível)',
            'Arte de capa em alta qualidade'
        ],
        limitations: [
            'Tamanho máximo: 50MB',
            'Formatos: MP3, WAV, M4A, OGG, AAC, FLAC, WEBM',
            'Áudio deve ter pelo menos 5-10 segundos',
            'Áudio deve estar claro (sem muito ruído)'
        ],
        cost: `${constants.COSTS.SHAZAM_IDENTIFY || 20} crédito(s) por identificação`,
        usage: {
            upload: {
                method: 'POST',
                endpoint: '/api/shazam/identify',
                headers: {
                    'X-API-Key': 'sua_api_key_aqui',
                    'Content-Type': 'multipart/form-data'
                },
                body: 'arquivo de áudio (campo: audio_file)'
            },
            url: {
                method: 'POST',
                endpoint: '/api/shazam/identify-url',
                headers: {
                    'X-API-Key': 'sua_api_key_aqui',
                    'Content-Type': 'application/json'
                },
                body: {
                    url: 'https://exemplo.com/musica.mp3'
                }
            }
        }
    });
});

// ===== IDENTIFICAR POR UPLOAD =====
router.post('/identify',
    // 🔍 DEBUG MIDDLEWARE
    (req, res, next) => {
        console.log('\n🔍 === DEBUG SHAZAM UPLOAD ===');
        console.log('📋 Headers:', {
            'content-type': req.headers['content-type'],
            'content-length': req.headers['content-length'],
            'x-api-key': req.headers['x-api-key'] ? 'presente' : 'ausente'
        });
        console.log('📦 Body keys:', Object.keys(req.body));
        console.log('📁 Files:', req.files ? 'presente' : 'ausente');
        console.log('================================\n');
        next();
    },
    // AUTENTICAÇÃO
    authenticateApiKey,
    // UPLOAD
    upload.single('audio_file'),
    // HANDLER
    response.asyncHandler(async (req, res) => {
        try {
            // Verifica se arquivo foi enviado
            if (!req.file) {
                console.log('❌ Nenhum arquivo recebido!');
                console.log('- req.file:', req.file);
                console.log('- req.body:', req.body);
                return response.validationError(res, [{
                    field: 'audio_file',
                    message: 'Arquivo de áudio é obrigatório'
                }]);
            }

            console.log('✅ Arquivo recebido com sucesso!');
            console.log('📄 Arquivo:', req.file.originalname);
            console.log('📏 Tamanho:', (req.file.size / 1024 / 1024).toFixed(2), 'MB');
            console.log('🎵 Tipo:', req.file.mimetype);

            // Identifica a música
            const result = await identifyMusicFromBuffer(req.file.buffer, req.file.originalname);

            console.log('🎉 Música identificada:', result.music.title, '-', result.music.artist);

            // Log de sucesso
            await req.logSuccess({
                case: 'shazam_identify',
                method: 'upload',
                file_size: req.file.size,
                music_title: result.music.title,
                music_artist: result.music.artist
            });

            return response.success(res, {
                track: result.music,
                credits_remaining: req.apiKeyData.credits
            });

        } catch (error) {
            console.error('❌ Erro na rota Shazam (upload):', error.message);
            await req.logError(500, error.message, { case: 'shazam_identify', method: 'upload' });

            if (error.message.includes('Formato')) {
                return response.error(res, error.message, 400);
            }
            if (error.message.includes('não reconhecida')) {
                return response.error(res, error.message, 404);
            }

            return response.error(res, error.message, 500);
        }
    })
);

// ===== IDENTIFICAR POR URL =====
router.post('/identify-url', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { url } = req.body;

        // Validações
        if (!url) {
            return response.validationError(res, [{
                field: 'url',
                message: 'URL do áudio é obrigatória'
            }]);
        }

        if (!isValidAudioUrl(url)) {
            return response.validationError(res, [{
                field: 'url',
                message: 'URL inválida. Deve ser um link direto para arquivo de áudio (MP3, WAV, M4A, etc)'
            }]);
        }

        console.log('🎵 Identificando música por URL...');
        console.log('- URL:', url);

        // Identifica a música
        const result = await identifyMusicFromUrl(url);

        // Log de sucesso
        await req.logSuccess({
            case: 'shazam_identify',
            method: 'url',
            url: url,
            music_title: result.music.title,
            music_artist: result.music.artist
        });

        return response.success(res, {
            track: result.music,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro na rota Shazam (URL):', error);
        await req.logError(500, error.message, { case: 'shazam_identify', method: 'url' });

        if (error.message.includes('muito grande')) {
            return response.error(res, error.message, 413);
        }
        if (error.message.includes('não reconhecida')) {
            return response.error(res, error.message, 404);
        }

        return response.error(res, error.message, 500);
    }
}));

module.exports = router;
