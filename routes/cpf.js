// ===== ROUTES/CPF.JS =====
// Consulta de CPF para Alauda API

const express = require('express');
const router = express.Router();
const axios = require('axios');
const authenticateApiKey = require('../middleware/auth');
const response = require('../utils/responseHandler');
const constants = require('../config/constants');

/**
 * Valida formato de CPF
 */
function isValidCPF(cpf) {
    if (!cpf) return false;
    
    // Remove caracteres não numéricos
    cpf = cpf.replace(/[^\d]/g, '');
    
    // Verifica se tem 11 dígitos
    if (cpf.length !== 11) return false;
    
    // Verifica se todos os dígitos são iguais
    if (/^(\d)\1{10}$/.test(cpf)) return false;
    
    // Validação dos dígitos verificadores
    let soma = 0;
    let resto;
    
    for (let i = 1; i <= 9; i++) {
        soma += parseInt(cpf.substring(i - 1, i)) * (11 - i);
    }
    
    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cpf.substring(9, 10))) return false;
    
    soma = 0;
    for (let i = 1; i <= 10; i++) {
        soma += parseInt(cpf.substring(i - 1, i)) * (12 - i);
    }
    
    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cpf.substring(10, 11))) return false;
    
    return true;
}

/**
 * Formata CPF (123.456.789-10)
 */
function formatCPF(cpf) {
    cpf = cpf.replace(/[^\d]/g, '');
    return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

/**
 * Consulta CPF via ReceitaWS (API pública brasileira)
 */
async function consultarCPFReceitaWS(cpf) {
    try {
        const cpfLimpo = cpf.replace(/[^\d]/g, '');
        
        // ReceitaWS API - Gratuita para CPF
        const response = await axios.get(
            `https://www.receitaws.com.br/v1/cpf/${cpfLimpo}`,
            {
                timeout: 20000,
                headers: {
                    'User-Agent': 'Alauda-API/1.0'
                }
            }
        );

        const data = response.data;

        // Verifica se houve erro
        if (data.status === 'ERROR') {
            throw new Error(data.message || 'CPF não encontrado');
        }

        return {
            success: true,
            cpf: formatCPF(cpfLimpo),
            nome: data.nome || 'Não disponível',
            situacao: data.situacao || 'Desconhecida',
            data_nascimento: data.nascimento || null,
            data_inscricao: null, // ReceitaWS não fornece
            digito_verificador: null,
            fonte: 'ReceitaWS'
        };

    } catch (error) {
        console.error('❌ Erro ReceitaWS:', error.message);
        
        if (error.response && error.response.status === 404) {
            throw new Error('CPF não encontrado ou inválido');
        }
        
        throw new Error('Erro ao consultar CPF. Tente novamente.');
    }
}

/**
 * Consulta CPF via Brasil API
 */
async function consultarCPFBrasilAPI(cpf) {
    try {
        const cpfLimpo = cpf.replace(/[^\d]/g, '');
        
        const brasilApiResponse = await axios.get(
            `https://brasilapi.com.br/api/cpf/v1/${cpfLimpo}`,
            {
                timeout: 15000,
                headers: {
                    'User-Agent': 'Alauda-API/1.0'
                }
            }
        );

        const data = brasilApiResponse.data;

        return {
            success: true,
            cpf: formatCPF(cpfLimpo),
            nome: data.nome || 'Não disponível',
            situacao: data.situacao || 'Desconhecida',
            data_nascimento: data.data_nascimento || null,
            data_inscricao: data.data_inscricao || null,
            digito_verificador: data.digito_verificador || null,
            fonte: 'Brasil API'
        };

    } catch (error) {
        console.error('❌ Erro Brasil API:', error.message);
        throw error; // Propaga erro para tentar próxima fonte
    }
}

/**
 * Consulta CPF via scraping da Receita Federal (fallback)
 */
async function consultarCPFReceitaFederal(cpf) {
    try {
        const cpfLimpo = cpf.replace(/[^\d]/g, '');
        
        // A Receita Federal mudou e agora requer captcha
        // Esta implementação é um exemplo básico
        const response = await axios.post(
            'https://servicos.receita.fazenda.gov.br/Servicos/CPF/ConsultaSituacao/ConsultaPublicaExibir.asp',
            `CPF=${cpfLimpo}`,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 20000
            }
        );

        const html = response.data;

        // Parse básico do HTML (você pode usar cheerio para melhor parsing)
        const nomeMatch = html.match(/Nome:\s*<\/b>\s*([^<]+)/);
        const situacaoMatch = html.match(/Situação Cadastral:\s*<\/b>\s*([^<]+)/);
        const nascimentoMatch = html.match(/Data de Nascimento:\s*<\/b>\s*([^<]+)/);

        if (!nomeMatch) {
            throw new Error('CPF não encontrado ou inválido');
        }

        return {
            success: true,
            cpf: formatCPF(cpfLimpo),
            nome: nomeMatch[1].trim(),
            situacao: situacaoMatch ? situacaoMatch[1].trim() : 'Desconhecida',
            data_nascimento: nascimentoMatch ? nascimentoMatch[1].trim() : null,
            fonte: 'Receita Federal'
        };

    } catch (error) {
        console.error('❌ Erro Receita Federal:', error.message);
        throw new Error('CPF não encontrado ou erro ao consultar Receita Federal');
    }
}

/**
 * Consulta CPF (tenta Brasil API, depois ReceitaWS)
 */
async function consultarCPF(cpf) {
    // Tenta Brasil API primeiro
    try {
        return await consultarCPFBrasilAPI(cpf);
    } catch (brasilApiError) {
        console.log('⚠️ Brasil API falhou, tentando ReceitaWS...');
    }

    // Tenta ReceitaWS como fallback
    try {
        return await consultarCPFReceitaWS(cpf);
    } catch (receitaWSError) {
        console.error('❌ Todas as fontes falharam');
        throw new Error('CPF não encontrado em nenhuma base de dados disponível');
    }
}

// ===== ROTAS =====

router.get('/info', (req, res) => {
    response.success(res, {
        endpoint: '/api/cpf',
        description: 'Consulta de dados de CPF brasileiro',
        features: [
            'Validação de CPF',
            'Consulta de nome completo',
            'Situação cadastral',
            'Data de nascimento (quando disponível)',
            'Data de inscrição',
            'Múltiplas fontes (Brasil API + Receita Federal)'
        ],
        limitations: [
            'Apenas CPFs brasileiros válidos',
            'Disponível apenas para planos PRO e PREMIUM',
            'Dados públicos da Receita Federal',
            'Pode haver delay de até 30 segundos'
        ],
        cost: `${constants.COSTS.CPF_CONSULTA || 50} crédito(s) por consulta`,
        plans_allowed: ['pro', 'premium'],
        usage: {
            method: 'POST',
            endpoint: '/api/cpf/consultar',
            headers: {
                'X-API-Key': 'sua_api_key_aqui',
                'Content-Type': 'application/json'
            },
            body: {
                cpf: '123.456.789-10 ou 12345678910'
            }
        }
    });
});

// ===== CONSULTAR CPF =====
router.post('/consultar', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { cpf } = req.body;

        // Validação de entrada
        if (!cpf) {
            return response.validationError(res, [{
                field: 'cpf',
                message: 'CPF é obrigatório'
            }]);
        }

        // Validação de formato
        if (!isValidCPF(cpf)) {
            return response.validationError(res, [{
                field: 'cpf',
                message: 'CPF inválido. Verifique o formato e os dígitos verificadores.'
            }]);
        }

        // ===== RESTRIÇÃO DE PLANO =====
        if (!['pro', 'premium'].includes(req.apiKeyData.plan)) {
            return response.error(res, 
                '❌ Consulta de CPF disponível apenas para planos PRO e PREMIUM.\n\n' +
                'Seu plano atual: ' + req.apiKeyData.plan.toUpperCase() + '\n\n' +
                'Faça upgrade para acessar esta funcionalidade.', 
                403
            );
        }

        console.log('🔍 Consultando CPF...');
        console.log('- CPF:', formatCPF(cpf));
        console.log('- Plano:', req.apiKeyData.plan);
        console.log('- Créditos disponíveis:', req.apiKeyData.credits);

        // Consulta o CPF
        const resultado = await consultarCPF(cpf);

        // Log de sucesso
        await req.logSuccess({
            case: 'cpf_consulta',
            cpf: formatCPF(cpf),
            nome: resultado.nome,
            situacao: resultado.situacao,
            fonte: resultado.fonte
        });

        return response.success(res, {
            ...resultado,
            credits_remaining: req.apiKeyData.credits,
            plan: req.apiKeyData.plan
        });

    } catch (error) {
        console.error('❌ Erro na rota CPF:', error);
        await req.logError(500, error.message, { case: 'cpf_consulta' });

        if (error.message.includes('não encontrado')) {
            return response.error(res, error.message, 404);
        }

        return response.error(res, error.message, 500);
    }
}));

// ===== VALIDAR CPF (sem consumir créditos) =====
router.post('/validar', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { cpf } = req.body;

        if (!cpf) {
            return response.validationError(res, [{
                field: 'cpf',
                message: 'CPF é obrigatório'
            }]);
        }

        const valido = isValidCPF(cpf);
        const cpfFormatado = valido ? formatCPF(cpf) : null;

        return response.success(res, {
            cpf: cpfFormatado,
            valido: valido,
            message: valido ? 'CPF válido' : 'CPF inválido',
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        return response.error(res, error.message, 500);
    }
}));

// ===== BATCH (consultar múltiplos CPFs) =====
router.post('/batch', authenticateApiKey, response.asyncHandler(async (req, res) => {
    try {
        const { cpfs } = req.body;

        // Validações
        if (!cpfs || !Array.isArray(cpfs)) {
            return response.validationError(res, [{
                field: 'cpfs',
                message: 'Forneça um array de CPFs'
            }]);
        }

        if (cpfs.length === 0) {
            return response.validationError(res, [{
                field: 'cpfs',
                message: 'Array de CPFs está vazio'
            }]);
        }

        if (cpfs.length > 10) {
            return response.validationError(res, [{
                field: 'cpfs',
                message: 'Máximo de 10 CPFs por vez'
            }]);
        }

        // ===== RESTRIÇÃO DE PLANO =====
        if (req.apiKeyData.plan !== 'premium') {
            return response.error(res, 
                'Consulta em lote disponível apenas para plano PREMIUM', 
                403
            );
        }

        const creditCost = constants.COSTS.CPF_CONSULTA || 50;
        const totalCreditsNeeded = cpfs.length * creditCost;

        if (!req.apiKeyData.hasCredits(totalCreditsNeeded)) {
            return response.insufficientCredits(res, totalCreditsNeeded, req.apiKeyData.credits);
        }

        // Processa CPFs
        const results = [];
        let successCount = 0;
        let failCount = 0;

        for (const cpf of cpfs) {
            try {
                if (!isValidCPF(cpf)) {
                    results.push({ cpf, success: false, error: 'CPF inválido' });
                    failCount++;
                    continue;
                }

                const resultado = await consultarCPF(cpf);
                results.push({ cpf: resultado.cpf, success: true, data: resultado });
                successCount++;

                await req.apiKeyData.consumeCredits(creditCost);

            } catch (error) {
                results.push({ cpf, success: false, error: error.message });
                failCount++;
            }
        }

        await req.logSuccess({
            case: 'cpf_batch',
            total: cpfs.length,
            success: successCount,
            failed: failCount
        });

        return response.success(res, {
            total: cpfs.length,
            successful: successCount,
            failed: failCount,
            results,
            credits_remaining: req.apiKeyData.credits
        });

    } catch (error) {
        await req.logError(500, error.message, { case: 'cpf_batch' });
        return response.error(res, error.message, 500);
    }
}));

module.exports = router;
