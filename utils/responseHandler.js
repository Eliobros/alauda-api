// ===== UTILS/RESPONSEHANDLER.JS =====
// Padronização de respostas da Alauda API

const constants = require('../config/constants');

/**
 * Resposta de sucesso padrão
 */
function success(res, data = {}, message = null, statusCode = 200) {
    const response = {
        success: true,
        ...(message && { message }),
        data: data,
        timestamp: new Date().toISOString()
    };
    
    return res.status(statusCode).json(response);
}

/**
 * Resposta de erro padrão
 */
function error(res, errorMessage, statusCode = 500, details = null) {
    const response = {
        success: false,
        error: errorMessage,
        ...(details && { details }),
        timestamp: new Date().toISOString()
    };
    
    // Log do erro (apenas em desenvolvimento)
    if (process.env.NODE_ENV === 'development') {
        console.error('❌ Error Response:', response);
    }
    
    return res.status(statusCode).json(response);
}

/**
 * Resposta de validação (bad request)
 */
function validationError(res, errors) {
    return res.status(constants.STATUS.BAD_REQUEST).json({
        success: false,
        error: 'Erro de validação',
        errors: errors,
        timestamp: new Date().toISOString()
    });
}

/**
 * Resposta não autorizado
 */
function unauthorized(res, message = constants.ERRORS.INVALID_API_KEY) {
    return res.status(constants.STATUS.UNAUTHORIZED).json({
        success: false,
        error: message,
        timestamp: new Date().toISOString()
    });
}

/**
 * Resposta de créditos insuficientes
 */
function insufficientCredits(res, creditsNeeded, creditsAvailable) {
    return res.status(constants.STATUS.PAYMENT_REQUIRED).json({
        success: false,
        error: constants.ERRORS.NO_CREDITS,
        credits_needed: creditsNeeded,
        credits_available: creditsAvailable,
        message: 'Recarregue sua conta para continuar usando a API',
        timestamp: new Date().toISOString()
    });
}

/**
 * Resposta de rate limit
 */
function rateLimitExceeded(res, limit, resetTime) {
    return res.status(constants.STATUS.TOO_MANY_REQUESTS).json({
        success: false,
        error: constants.ERRORS.RATE_LIMIT,
        limit: limit,
        reset_at: resetTime,
        message: 'Você atingiu o limite de requisições. Tente novamente mais tarde.',
        timestamp: new Date().toISOString()
    });
}

/**
 * Resposta de recurso não encontrado
 */
function notFound(res, resource = 'Recurso') {
    return res.status(constants.STATUS.NOT_FOUND).json({
        success: false,
        error: `${resource} não encontrado`,
        timestamp: new Date().toISOString()
    });
}

/**
 * Resposta de serviço indisponível
 */
function serviceUnavailable(res, service = 'Serviço') {
    return res.status(constants.STATUS.SERVICE_UNAVAILABLE).json({
        success: false,
        error: constants.ERRORS.SERVICE_UNAVAILABLE,
        service: service,
        message: 'Tente novamente em alguns instantes',
        timestamp: new Date().toISOString()
    });
}

/**
 * Resposta com dados paginados
 */
function paginated(res, data, pagination) {
    return res.status(200).json({
        success: true,
        data: data,
        pagination: {
            page: pagination.page || 1,
            limit: pagination.limit || 10,
            total: pagination.total || 0,
            pages: Math.ceil((pagination.total || 0) / (pagination.limit || 10))
        },
        timestamp: new Date().toISOString()
    });
}

/**
 * Resposta de download/redirect
 */
function download(res, downloadData) {
    // Remove credits_remaining dos dados se existir (será adicionado na raiz)
    const { credits_remaining, ...data } = downloadData;
    
    return res.status(200).json({
        success: true,
        data: data,
        ...(credits_remaining !== undefined && { credits_remaining }),
        timestamp: new Date().toISOString()
    });
}
/**
 * Resposta de informações (sem download)
 */
function info(res, infoData) {
    return res.status(200).json({
        success: true,
        data: infoData,
        credits_remaining: infoData.credits_remaining,
        timestamp: new Date().toISOString()
    });
}

/**
 * Resposta de criação de recurso
 */
function created(res, data, message = 'Recurso criado com sucesso') {
    return res.status(constants.STATUS.CREATED).json({
        success: true,
        message: message,
        data: data,
        timestamp: new Date().toISOString()
    });
}

/**
 * Resposta de atualização de recurso
 */
function updated(res, data, message = 'Recurso atualizado com sucesso') {
    return res.status(200).json({
        success: true,
        message: message,
        data: data,
        timestamp: new Date().toISOString()
    });
}

/**
 * Resposta de deleção de recurso
 */
function deleted(res, message = 'Recurso removido com sucesso') {
    return res.status(200).json({
        success: true,
        message: message,
        timestamp: new Date().toISOString()
    });
}

/**
 * Wrapper para try/catch em rotas
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Formata erro do Mongoose
 */
function formatMongooseError(err) {
    if (err.name === 'ValidationError') {
        const errors = Object.values(err.errors).map(e => ({
            field: e.path,
            message: e.message
        }));
        return { message: 'Erro de validação', errors };
    }
    
    if (err.code === 11000) {
        const field = Object.keys(err.keyPattern)[0];
        return { message: `${field} já existe`, field };
    }
    
    return { message: err.message };
}

module.exports = {
    success,
    error,
    validationError,
    unauthorized,
    insufficientCredits,
    rateLimitExceeded,
    notFound,
    serviceUnavailable,
    paginated,
    download,
    info,
    created,
    updated,
    deleted,
    asyncHandler,
    formatMongooseError
};
