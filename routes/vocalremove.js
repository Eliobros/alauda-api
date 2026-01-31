// ===== ROUTES/VOCALREMOVE.JS =====
// Remover vocais de músicas usando Spleeter

const express = require('express');
const router = express.Router();
const axios = require('axios');
const { execFile } = require('child_process');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const authenticateApiKey = require('../middleware/auth');
const response = require('../utils/responseHandler');
const constants = require('../config/constants');

// Configurar Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_SECRET_KEY
});

// Configuração do Multer para upload de áudio
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB
    },
    fileFilter: (req, file, cb) => {
        const allowedFormats = [
            'audio/mpeg',
            'audio/mp3',
            'audio/wav',
            'audio/ogg',
            'audio/flac',
            'audio/m4a'
        ];

        if (allowedFormats.includes(file.mimetype) || file.originalname.match(/\.(mp3|wav|ogg|flac|m4a)$/i)) {
            cb(null, true);
        } else {
            cb(new Error('Formato de áudio não suportado. Use: MP3, WAV, OGG, FLAC, M4A'));
        }
    }
});

/**
 * Faz upload do áudio processado para Cloudinary
 */
async function uploadToCloudinary(audioPath, type, originalName) {
    try {
        return new Promise((resolve, reject) => {
            cloudinary.uploader.upload(
                audioPath,
                {
                    folder: 'alauda-api/vocal-removed',
                    resource_type: 'video', // Cloudinary usa 'video' para áudio
                    format: 'mp3',
                    public_id: `${type}-${Date.now()}-${Math.random().toString(36).substring(7)}`
                },
                (error, result) => {
                    if (error) {
                        console.error('❌ Erro upload Cloudinary:', error);
                        reject(new Error('Erro ao fazer upload do áudio processado'));
                    } else {
                        resolve({
                            url: result.secure_url,
                            public_id: result.public_id,
                            duration: result.duration,
                            format: result.format,
                            size: result.bytes
                        });
                    }
                }
            );
        });

    } catch (error) {
        console.error('❌ Erro ao processar upload Cloudinary:', error);
        throw new Error('Erro ao fazer upload do áudio');
    }
}

/**
 * Valida URL de áudio
 */
function isValidAudioUrl(url) {
    if (!url || typeof url !== 'string') return false;

    try {
        new URL(url);
        const audioExtensions = ['.mp3', '.wav', '.ogg', '.flac', '.m4a'];
        return audioExtensions.some(ext => url.toLowerCase().includes(ext));
    } catch {
        return false;
    }
}

/**
 * Determina número de stems baseado no plano
 */
function getStemsByPlan(plan) {
    const stems = {
        'free': '2',      // Apenas vocals + instrumental
        'basic': '2',     // Apenas vocals + instrumental
        'pro': '4',       // Vocals + Drums + Bass + Other
        'premium': '5'    // Vocals + Drums + Bass + Piano + Other
    };

    return stems[plan] || '2';
}

/**
 * Remove vocais usando Spleeter
 */
async function removeVocals(inputPath, stems = '2') {
    const outputDir = path.join(__dirname, '..', 'temp', 'output', uuidv4());
    
    try {
        // Criar diretório de saída
        await fs.mkdir(outputDir, { recursive: true });

        return new Promise((resolve, reject) => {
            const args = [
                'separate',
                '-p', `spleeter:${stems}stems`,
                '-o', outputDir,
                inputPath
            ];

            console.log('🎵 Executando Spleeter:', args.join(' '));

            execFile('spleeter', args, { maxBuffer: 50 * 1024 * 1024 }, async (error, stdout, stderr) => {
                if (error) {
                    console.error('❌ Erro Spleeter:', stderr);
                    reject(new Error(`Spleeter falhou: ${error.message}`));
                    return;
                }

                try {
                    // Spleeter cria uma pasta com o nome do arquivo
                    const fileName = path.basename(inputPath, path.extname(inputPath));
                    const resultDir = path.join(outputDir, fileName);

                    const result = {
                        vocals: path.join(resultDir, 'vocals.wav'),
                        accompaniment: path.join(resultDir, 'accompaniment.wav')
                    };

                    // Se for 4 ou 5 stems, adicionar mais arquivos
                    if (stems === '4' || stems === '5') {
                        result.drums = path.join(resultDir, 'drums.wav');
                        result.bass = path.join(resultDir, 'bass.wav');
                        result.other = path.join(resultDir, 'other.wav');
                    }
                    
                    if (stems === '5') {
                        result.piano = path.join(resultDir, 'piano.wav');
                    }

                    // Verificar se os arquivos existem
                    const vocalsExists = await fs.access(result.vocals).then(() => true).catch(() => false);
                    const instrumentalExists = await fs.access(result.accompaniment).then(() => true).catch(() => false);

                    if (!vocalsExists || !instrumentalExists) {
                        reject(new Error('Spleeter não gerou os arquivos esperados'));
                        return;
                    }

                    console.log('✅ Spleeter concluído:', stdout);
                    resolve(result);

                } catch (parseError) {
                    reject(new Error(`Erro ao processar resultado do Spleeter: ${parseError.message}`));
                }
            });
        });

    } catch (error) {
        console.error('❌ Erro ao criar diretório:', error);
        throw new Error('Erro ao preparar processamento');
    }
}

/**
 * Limpa arquivos temporários
 */
async function cleanupFiles(...filePaths) {
    for (const filePath of filePaths) {
        try {
            await fs.unlink(filePath);
            console.log('🗑️ Arquivo temporário removido:', filePath);
        } catch (error) {
            console.warn('⚠️ Não foi possível remover:', filePath);
        }
    }
}

// ===== ROTAS =====

router.get('/info', (req, res) => {
    response.success(res, {
        endpoint: '/api/vocalremove',
        description: 'Separação de vocais e instrumentais usando IA (Spleeter)',
        features: [
            'Separação automática de vocal e instrumental',
            'Upload de arquivo ou URL',
            'Stems adicionais baseados no plano',
            'Formato WAV de alta qualidade',
            'Processamento IA treinada pelo Deezer'
        ],
        limitations: [
            'Tamanho máximo: 50MB',
            'Formatos: MP3, WAV, OGG, FLAC, M4A',
            'Tempo de processamento: 30s-3min',
            'Stems variam por plano'
        ],
        cost: `${constants.COSTS.VOCAL_REMOVE || 15} crédito(s) por música`,
        stems_by_plan: {
            free: '2 stems (Vocals + Instrumental)',
            basic: '2 stems (Vocals + Instrumental)',
            pro: '4 stems (Vocals + Drums + Bass + Other)',
            premium: '5 stems (Vocals + Drums + Bass + Piano + Other)'
        },
        usage: {
            upload: {
                method: 'POST',
                endpoint: '/api/vocalremove/separate',
                headers: {
                    'X-API-Key': 'sua_api_key_aqui',
                    'Content-Type': 'multipart/form-data'
                },
                body: 'arquivo de áudio (campo: audio)'
            },
            url: {
                method: 'POST',
                endpoint: '/api/vocalremove/separate-url',
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

// ===== REMOVER VOCAIS (UPLOAD) =====
router.post('/separate', authenticateApiKey, upload.single('audio'), response.asyncHandler(async (req, res) => {
    let tempInputPath = null;

    try {
        // Verifica se Spleeter está instalado
        try {
            await new Promise((resolve, reject) => {
                execFile('spleeter', ['--version'], (error, stdout) => {
                    if (error) reject(error);
                    else resolve(stdout);
                });
            });
        } catch (error) {
            return response.error(res, 'Serviço de separação de vocais temporariamente indisponível. Entre em contato com o suporte.', 503);
        }

        // Verifica se arquivo foi enviado
        if (!req.file) {
            return response.validationError(res, [{
                field: 'audio',
                message: 'Arquivo de áudio é obrigatório'
            }]);
        }

        console.log('🎵 Separando vocais de áudio...');
        console.log('- Arquivo:', req.file.originalname);
        console.log('- Tamanho:', (req.file.size / 1024 / 1024).toFixed(2), 'MB');
        console.log('- Tipo:', req.file.mimetype);
        console.log('- Plano:', req.apiKeyData.plan);
        console.log('- Stems:', getStemsByPlan(req.apiKeyData.plan));

        // Salvar arquivo temporariamente
        const tempDir = path.join(__dirname, '..', 'temp');
        await fs.mkdir(tempDir, { recursive: true });
        tempInputPath = path.join(tempDir, `${Date.now()}-${req.file.originalname}`);
        await fs.writeFile(tempInputPath, req.file.buffer);

        // Processar com Spleeter
        const stems = getStemsByPlan(req.apiKeyData.plan);
        console.log('⚙️ Processando com Spleeter...');
        const resultado = await removeVocals(tempInputPath, stems);
        console.log('✅ Separação concluída');

        // Upload para Cloudinary
        console.log('☁️ Fazendo upload para Cloudinary...');
        const [vocalsUpload, instrumentalUpload] = await Promise.all([
            uploadToCloudinary(resultado.vocals, 'vocals', req.file.originalname),
            uploadToCloudinary(resultado.accompaniment, 'instrumental', req.file.originalname)
        ]);
        console.log('✅ Uploads concluídos');

        // Preparar resposta baseada no plano
        const responseData = {
            vocals: {
                download_url: vocalsUpload.url,
                duration: vocalsUpload.duration,
                size: vocalsUpload.size,
                size_mb: (vocalsUpload.size / 1024 / 1024).toFixed(2),
                format: 'mp3',
                cloudinary_id: vocalsUpload.public_id
            },
            instrumental: {
                download_url: instrumentalUpload.url,
                duration: instrumentalUpload.duration,
                size: instrumentalUpload.size,
                size_mb: (instrumentalUpload.size / 1024 / 1024).toFixed(2),
                format: 'mp3',
                cloudinary_id: instrumentalUpload.public_id
            }
        };

        // Adicionar stems extras se disponíveis
        if (stems === '4' || stems === '5') {
            const [drumsUpload, bassUpload, otherUpload] = await Promise.all([
                uploadToCloudinary(resultado.drums, 'drums', req.file.originalname),
                uploadToCloudinary(resultado.bass, 'bass', req.file.originalname),
                uploadToCloudinary(resultado.other, 'other', req.file.originalname)
            ]);

            responseData.drums = {
                download_url: drumsUpload.url,
                duration: drumsUpload.duration,
                size: drumsUpload.size,
                size_mb: (drumsUpload.size / 1024 / 1024).toFixed(2),
                format: 'mp3',
                cloudinary_id: drumsUpload.public_id
            };

            responseData.bass = {
                download_url: bassUpload.url,
                duration: bassUpload.duration,
                size: bassUpload.size,
                size_mb: (bassUpload.size / 1024 / 1024).toFixed(2),
                format: 'mp3',
                cloudinary_id: bassUpload.public_id
            };

            responseData.other = {
                download_url: otherUpload.url,
                duration: otherUpload.duration,
                size: otherUpload.size,
                size_mb: (otherUpload.size / 1024 / 1024).toFixed(2),
                format: 'mp3',
                cloudinary_id: otherUpload.public_id
            };
        }

        if (stems === '5') {
            const pianoUpload = await uploadToCloudinary(resultado.piano, 'piano', req.file.originalname);
            
            responseData.piano = {
                download_url: pianoUpload.url,
                duration: pianoUpload.duration,
                size: pianoUpload.size,
                size_mb: (pianoUpload.size / 1024 / 1024).toFixed(2),
                format: 'mp3',
                cloudinary_id: pianoUpload.public_id
            };
        }

        // Limpar arquivos temporários
        await cleanupFiles(
            tempInputPath,
            resultado.vocals,
            resultado.accompaniment,
            ...(resultado.drums ? [resultado.drums] : []),
            ...(resultado.bass ? [resultado.bass] : []),
            ...(resultado.other ? [resultado.other] : []),
            ...(resultado.piano ? [resultado.piano] : [])
        );

        // Log de sucesso
        await req.logSuccess({
            case: 'vocal_remove',
            method: 'upload',
            original_size: req.file.size,
            stems: stems,
            plan: req.apiKeyData.plan
        });

        return response.success(res, {
            ...responseData,
            stems_count: stems,
            plan: req.apiKeyData.plan,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro na rota Vocal Remove (upload):', error);
        
        // Limpar arquivo temporário em caso de erro
        if (tempInputPath) {
            await cleanupFiles(tempInputPath);
        }

        await req.logError(500, error.message, { case: 'vocal_remove', method: 'upload' });

        if (error.message.includes('Formato')) {
            return response.error(res, error.message, 400);
        }
        if (error.message.includes('Spleeter')) {
            return response.error(res, 'Erro ao processar áudio. Verifique se o arquivo está corrompido.', 500);
        }

        return response.error(res, error.message, 500);
    }
}));

// ===== REMOVER VOCAIS (URL) =====
router.post('/separate-url', authenticateApiKey, response.asyncHandler(async (req, res) => {
    let tempInputPath = null;

    try {
        const { url } = req.body;

        // Verifica se Spleeter está instalado
        try {
            await new Promise((resolve, reject) => {
                execFile('spleeter', ['--version'], (error, stdout) => {
                    if (error) reject(error);
                    else resolve(stdout);
                });
            });
        } catch (error) {
            return response.error(res, 'Serviço de separação de vocais temporariamente indisponível. Entre em contato com o suporte.', 503);
        }

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
                message: 'URL inválida. Deve ser um link direto para áudio (MP3, WAV, OGG, FLAC, M4A)'
            }]);
        }

        console.log('🎵 Separando vocais de áudio (URL)...');
        console.log('- URL:', url);
        console.log('- Plano:', req.apiKeyData.plan);
        console.log('- Stems:', getStemsByPlan(req.apiKeyData.plan));

        // Download do áudio
        console.log('⬇️ Baixando áudio...');
        const audioResponse = await axios.get(url, { 
            responseType: 'arraybuffer',
            timeout: 60000,
            maxContentLength: 50 * 1024 * 1024
        });

        // Salvar arquivo temporariamente
        const tempDir = path.join(__dirname, '..', 'temp');
        await fs.mkdir(tempDir, { recursive: true });
        tempInputPath = path.join(tempDir, `${Date.now()}-audio-from-url.mp3`);
        await fs.writeFile(tempInputPath, audioResponse.data);
        console.log('✅ Áudio baixado:', (audioResponse.data.length / 1024 / 1024).toFixed(2), 'MB');

        // Processar com Spleeter
        const stems = getStemsByPlan(req.apiKeyData.plan);
        console.log('⚙️ Processando com Spleeter...');
        const resultado = await removeVocals(tempInputPath, stems);
        console.log('✅ Separação concluída');

        // Upload para Cloudinary
        console.log('☁️ Fazendo upload para Cloudinary...');
        const [vocalsUpload, instrumentalUpload] = await Promise.all([
            uploadToCloudinary(resultado.vocals, 'vocals', 'audio-from-url'),
            uploadToCloudinary(resultado.accompaniment, 'instrumental', 'audio-from-url')
        ]);
        console.log('✅ Uploads concluídos');

        // Preparar resposta baseada no plano
        const responseData = {
            vocals: {
                download_url: vocalsUpload.url,
                duration: vocalsUpload.duration,
                size: vocalsUpload.size,
                size_mb: (vocalsUpload.size / 1024 / 1024).toFixed(2),
                format: 'mp3',
                cloudinary_id: vocalsUpload.public_id
            },
            instrumental: {
                download_url: instrumentalUpload.url,
                duration: instrumentalUpload.duration,
                size: instrumentalUpload.size,
                size_mb: (instrumentalUpload.size / 1024 / 1024).toFixed(2),
                format: 'mp3',
                cloudinary_id: instrumentalUpload.public_id
            }
        };

        // Adicionar stems extras se disponíveis
        if (stems === '4' || stems === '5') {
            const [drumsUpload, bassUpload, otherUpload] = await Promise.all([
                uploadToCloudinary(resultado.drums, 'drums', 'audio-from-url'),
                uploadToCloudinary(resultado.bass, 'bass', 'audio-from-url'),
                uploadToCloudinary(resultado.other, 'other', 'audio-from-url')
            ]);

            responseData.drums = {
                download_url: drumsUpload.url,
                duration: drumsUpload.duration,
                size: drumsUpload.size,
                size_mb: (drumsUpload.size / 1024 / 1024).toFixed(2),
                format: 'mp3',
                cloudinary_id: drumsUpload.public_id
            };

            responseData.bass = {
                download_url: bassUpload.url,
                duration: bassUpload.duration,
                size: bassUpload.size,
                size_mb: (bassUpload.size / 1024 / 1024).toFixed(2),
                format: 'mp3',
                cloudinary_id: bassUpload.public_id
            };

            responseData.other = {
                download_url: otherUpload.url,
                duration: otherUpload.duration,
                size: otherUpload.size,
                size_mb: (otherUpload.size / 1024 / 1024).toFixed(2),
                format: 'mp3',
                cloudinary_id: otherUpload.public_id
            };
        }

        if (stems === '5') {
            const pianoUpload = await uploadToCloudinary(resultado.piano, 'piano', 'audio-from-url');
            
            responseData.piano = {
                download_url: pianoUpload.url,
                duration: pianoUpload.duration,
                size: pianoUpload.size,
                size_mb: (pianoUpload.size / 1024 / 1024).toFixed(2),
                format: 'mp3',
                cloudinary_id: pianoUpload.public_id
            };
        }

        // Limpar arquivos temporários
        await cleanupFiles(
            tempInputPath,
            resultado.vocals,
            resultado.accompaniment,
            ...(resultado.drums ? [resultado.drums] : []),
            ...(resultado.bass ? [resultado.bass] : []),
            ...(resultado.other ? [resultado.other] : []),
            ...(resultado.piano ? [resultado.piano] : [])
        );

        // Log de sucesso
        await req.logSuccess({
            case: 'vocal_remove',
            method: 'url',
            url: url,
            stems: stems,
            plan: req.apiKeyData.plan
        });

        return response.success(res, {
            ...responseData,
            stems_count: stems,
            plan: req.apiKeyData.plan,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        console.error('❌ Erro na rota Vocal Remove (URL):', error);
        
        // Limpar arquivo temporário em caso de erro
        if (tempInputPath) {
            await cleanupFiles(tempInputPath);
        }

        await req.logError(500, error.message, { case: 'vocal_remove', method: 'url' });

        if (error.message.includes('URL inválida')) {
            return response.error(res, error.message, 400);
        }
        if (error.message.includes('Spleeter')) {
            return response.error(res, 'Erro ao processar áudio. Verifique se a URL está acessível.', 500);
        }

        return response.error(res, error.message, 500);
    }
}));

module.exports = router;
