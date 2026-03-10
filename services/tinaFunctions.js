// ===== SERVICES/TINAFUNCTIONS.JS =====
// Function Calling para Tina IA - Consultas ao banco de dados

const User = require('../models/User');
const ApiKey = require('../models/ApiKey');
const Payment = require('../models/Payment');
const Usage = require('../models/Usage');
const WhatsappActivation = require('../models/WhatsappActivation');

// ============================================
// 📋 DECLARAÇÕES DE FUNÇÕES (Schema Gemini)
// ============================================

const functionDeclarations = [
  {
    name: 'contar_usuarios',
    description: 'Conta o total de usuários cadastrados na plataforma, podendo filtrar por status (ativos, inativos, verificados)',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['todos', 'ativos', 'inativos', 'verificados', 'nao_verificados'],
          description: 'Filtrar por status do usuário'
        }
      },
      required: ['status']
    }
  },
  {
    name: 'usuarios_inativos',
    description: 'Lista usuários que não fazem login há um determinado número de dias',
    parameters: {
      type: 'object',
      properties: {
        dias: {
          type: 'number',
          description: 'Número de dias sem login (ex: 30 para usuários inativos há 30 dias)'
        },
        limite: {
          type: 'number',
          description: 'Quantidade máxima de resultados (padrão: 10)'
        }
      },
      required: ['dias']
    }
  },
  {
    name: 'estatisticas_gerais',
    description: 'Retorna estatísticas gerais da plataforma: total de usuários, API keys, pagamentos, receita, etc.',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'consultar_api_keys',
    description: 'Consulta informações sobre API keys da plataforma, podendo filtrar por plano ou status',
    parameters: {
      type: 'object',
      properties: {
        filtro: {
          type: 'string',
          enum: ['todas', 'ativas', 'suspensas', 'expiradas', 'sem_creditos'],
          description: 'Filtrar API keys por status'
        },
        plano: {
          type: 'string',
          enum: ['free', 'basic', 'pro', 'premium'],
          description: 'Filtrar por plano específico (opcional)'
        }
      },
      required: ['filtro']
    }
  },
  {
    name: 'estatisticas_pagamentos',
    description: 'Retorna estatísticas de pagamentos: total arrecadado, pagamentos pendentes, aprovados, por provedor (mpesa, emola, mercadopago), etc.',
    parameters: {
      type: 'object',
      properties: {
        periodo_dias: {
          type: 'number',
          description: 'Período em dias para filtrar (ex: 7 para última semana, 30 para último mês). Se não informado, retorna todos.'
        },
        provedor: {
          type: 'string',
          enum: ['todos', 'mpesa', 'emola', 'mercadopago'],
          description: 'Filtrar por provedor de pagamento'
        }
      },
      required: []
    }
  },
  {
    name: 'top_endpoints',
    description: 'Retorna os endpoints/serviços mais utilizados da API (TikTok, Instagram, YouTube, etc.)',
    parameters: {
      type: 'object',
      properties: {
        periodo_dias: {
          type: 'number',
          description: 'Período em dias (padrão: 30)'
        },
        limite: {
          type: 'number',
          description: 'Quantidade de resultados (padrão: 10)'
        }
      },
      required: []
    }
  },
  {
    name: 'buscar_usuario',
    description: 'Busca informações de um usuário específico pelo nome ou email',
    parameters: {
      type: 'object',
      properties: {
        termo: {
          type: 'string',
          description: 'Nome ou email do usuário para buscar'
        }
      },
      required: ['termo']
    }
  },
  {
    name: 'estatisticas_whatsapp',
    description: 'Retorna estatísticas das ativações de WhatsApp: grupos ativos, total de mensagens, créditos consumidos',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'usuarios_top_consumidores',
    description: 'Lista os usuários que mais consomem créditos/requests na plataforma',
    parameters: {
      type: 'object',
      properties: {
        periodo_dias: {
          type: 'number',
          description: 'Período em dias (padrão: 30)'
        },
        limite: {
          type: 'number',
          description: 'Quantidade de resultados (padrão: 10)'
        }
      },
      required: []
    }
  },
  {
    name: 'receita_por_periodo',
    description: 'Calcula a receita (valor arrecadado) agrupada por dia, semana ou mês',
    parameters: {
      type: 'object',
      properties: {
        periodo_dias: {
          type: 'number',
          description: 'Período em dias para analisar (padrão: 30)'
        },
        agrupar_por: {
          type: 'string',
          enum: ['dia', 'semana', 'mes'],
          description: 'Como agrupar os resultados'
        }
      },
      required: ['agrupar_por']
    }
  }
];

// ============================================
// ⚙️ IMPLEMENTAÇÕES DAS FUNÇÕES
// ============================================

const functionImplementations = {

  async contar_usuarios({ status }) {
    let filter = {};

    switch (status) {
      case 'ativos': filter = { active: true }; break;
      case 'inativos': filter = { active: false }; break;
      case 'verificados': filter = { verified: true }; break;
      case 'nao_verificados': filter = { verified: false }; break;
      default: filter = {};
    }

    const total = await User.countDocuments(filter);
    return { total, filtro: status };
  },

  async usuarios_inativos({ dias, limite = 10 }) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - dias);

    const users = await User.find({
      $or: [
        { lastLogin: { $lt: cutoffDate } },
        { lastLogin: null }
      ],
      active: true
    })
      .select('name email lastLogin createdAt loginCount')
      .sort({ lastLogin: 1 })
      .limit(limite);

    return {
      total_encontrados: users.length,
      dias_inatividade: dias,
      usuarios: users.map(u => ({
        nome: u.name,
        email: u.email,
        ultimo_login: u.lastLogin ? u.lastLogin.toISOString().split('T')[0] : 'Nunca',
        cadastrado_em: u.createdAt.toISOString().split('T')[0],
        total_logins: u.loginCount
      }))
    };
  },

  async estatisticas_gerais() {
    const [
      totalUsers,
      activeUsers,
      verifiedUsers,
      totalApiKeys,
      activeApiKeys,
      totalPayments,
      approvedPayments,
      totalWhatsapp
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ active: true }),
      User.countDocuments({ verified: true }),
      ApiKey.countDocuments(),
      ApiKey.countDocuments({ active: true, suspended: false }),
      Payment.countDocuments(),
      Payment.countDocuments({ status: 'approved' }),
      WhatsappActivation.countDocuments({ isActive: true })
    ]);

    const revenueResult = await Payment.aggregate([
      { $match: { status: 'approved' } },
      { $group: { _id: '$currency', total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]);

    return {
      usuarios: { total: totalUsers, ativos: activeUsers, verificados: verifiedUsers },
      api_keys: { total: totalApiKeys, ativas: activeApiKeys },
      pagamentos: { total: totalPayments, aprovados: approvedPayments },
      receita_por_moeda: revenueResult.map(r => ({ moeda: r._id, total: r.total, quantidade: r.count })),
      whatsapp_ativacoes: totalWhatsapp
    };
  },

  async consultar_api_keys({ filtro, plano }) {
    let filter = {};

    switch (filtro) {
      case 'ativas': filter = { active: true, suspended: false }; break;
      case 'suspensas': filter = { suspended: true }; break;
      case 'expiradas': filter = { expiresAt: { $lt: new Date() }, active: true }; break;
      case 'sem_creditos': filter = { credits: { $lte: 0 }, active: true }; break;
      default: filter = {};
    }

    if (plano) filter.plan = plano;

    const total = await ApiKey.countDocuments(filter);

    const keys = await ApiKey.find(filter)
      .select('userName email plan credits totalRequests lastUsedAt suspended')
      .sort({ totalRequests: -1 })
      .limit(15);

    const planStats = await ApiKey.aggregate([
      { $match: filter },
      { $group: { _id: '$plan', count: { $sum: 1 }, total_creditos: { $sum: '$credits' }, total_requests: { $sum: '$totalRequests' } } }
    ]);

    return {
      total,
      filtro,
      por_plano: planStats.map(p => ({ plano: p._id, quantidade: p.count, creditos_totais: p.total_creditos, requests_totais: p.total_requests })),
      amostra: keys.map(k => ({
        usuario: k.userName,
        email: k.email,
        plano: k.plan,
        creditos: k.credits,
        total_requests: k.totalRequests,
        ultimo_uso: k.lastUsedAt ? k.lastUsedAt.toISOString().split('T')[0] : 'Nunca',
        suspensa: k.suspended
      }))
    };
  },

  async estatisticas_pagamentos({ periodo_dias, provedor }) {
    const match = { status: 'approved' };

    if (periodo_dias) {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - periodo_dias);
      match.created_at = { $gte: startDate };
    }

    if (provedor && provedor !== 'todos') {
      match.provider = provedor;
    }

    const stats = await Payment.aggregate([
      { $match: match },
      {
        $group: {
          _id: { provedor: '$provider', moeda: '$currency' },
          total_valor: { $sum: '$amount' },
          total_creditos: { $sum: '$credits_to_add' },
          quantidade: { $sum: 1 }
        }
      },
      { $sort: { total_valor: -1 } }
    ]);

    const pendentes = await Payment.countDocuments({ status: 'pending' });
    const rejeitados = await Payment.countDocuments({ status: 'rejected', ...(periodo_dias ? { created_at: match.created_at } : {}) });

    return {
      periodo: periodo_dias ? `Últimos ${periodo_dias} dias` : 'Todo o período',
      provedor_filtro: provedor || 'todos',
      pagamentos_aprovados: stats.map(s => ({
        provedor: s._id.provedor,
        moeda: s._id.moeda,
        valor_total: s.total_valor,
        creditos_total: s.total_creditos,
        quantidade: s.quantidade
      })),
      pendentes,
      rejeitados
    };
  },

  async top_endpoints({ periodo_dias = 30, limite = 10 }) {
    const result = await Usage.getTopCases(limite, periodo_dias);

    return {
      periodo: `Últimos ${periodo_dias} dias`,
      endpoints: result.map(r => ({
        servico: r._id,
        total_requests: r.count,
        taxa_sucesso: (r.successRate * 100).toFixed(1) + '%'
      }))
    };
  },

  async buscar_usuario({ termo }) {
    const regex = new RegExp(termo, 'i');

    const users = await User.find({
      $or: [
        { name: regex },
        { email: regex }
      ]
    })
      .select('name email phone active verified lastLogin loginCount createdAt')
      .limit(5);

    if (users.length === 0) {
      return { encontrados: 0, mensagem: 'Nenhum usuário encontrado com esse termo' };
    }

    const results = [];
    for (const user of users) {
      const apiKeys = await ApiKey.find({ userId: user._id.toString() })
        .select('plan credits totalRequests active');

      results.push({
        nome: user.name,
        email: user.email,
        telefone: user.phone || 'Não informado',
        ativo: user.active,
        verificado: user.verified,
        ultimo_login: user.lastLogin ? user.lastLogin.toISOString().split('T')[0] : 'Nunca',
        total_logins: user.loginCount,
        cadastrado_em: user.createdAt.toISOString().split('T')[0],
        api_keys: apiKeys.map(k => ({
          plano: k.plan,
          creditos: k.credits,
          requests: k.totalRequests,
          ativa: k.active
        }))
      });
    }

    return { encontrados: results.length, usuarios: results };
  },

  async estatisticas_whatsapp() {
    const [totalAtivas, totalInativas] = await Promise.all([
      WhatsappActivation.countDocuments({ isActive: true }),
      WhatsappActivation.countDocuments({ isActive: false })
    ]);

    const stats = await WhatsappActivation.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: null,
          total_mensagens: { $sum: '$totalMessages' },
          total_creditos_consumidos: { $sum: '$totalCreditsConsumed' },
          grupos: { $sum: 1 }
        }
      }
    ]);

    const topGroups = await WhatsappActivation.find({ isActive: true })
      .sort({ totalMessages: -1 })
      .limit(5)
      .select('groupName totalMessages totalCreditsConsumed lastUsedAt');

    return {
      ativacoes_ativas: totalAtivas,
      ativacoes_inativas: totalInativas,
      totais: stats.length > 0 ? {
        mensagens: stats[0].total_mensagens,
        creditos_consumidos: stats[0].total_creditos_consumidos
      } : { mensagens: 0, creditos_consumidos: 0 },
      top_grupos: topGroups.map(g => ({
        nome: g.groupName || 'Sem nome',
        mensagens: g.totalMessages,
        creditos: g.totalCreditsConsumed,
        ultimo_uso: g.lastUsedAt ? g.lastUsedAt.toISOString().split('T')[0] : 'Nunca'
      }))
    };
  },

  async usuarios_top_consumidores({ periodo_dias = 30, limite = 10 }) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodo_dias);

    const topUsers = await Usage.aggregate([
      { $match: { timestamp: { $gte: startDate } } },
      {
        $group: {
          _id: '$userId',
          total_requests: { $sum: 1 },
          total_creditos: { $sum: '$creditsUsed' },
          taxa_sucesso: { $avg: { $cond: ['$success', 1, 0] } }
        }
      },
      { $sort: { total_requests: -1 } },
      { $limit: limite }
    ]);

    const results = [];
    for (const entry of topUsers) {
      const user = await User.findById(entry._id).select('name email');
      results.push({
        nome: user ? user.name : 'Desconhecido',
        email: user ? user.email : 'N/A',
        total_requests: entry.total_requests,
        total_creditos: entry.total_creditos,
        taxa_sucesso: (entry.taxa_sucesso * 100).toFixed(1) + '%'
      });
    }

    return {
      periodo: `Últimos ${periodo_dias} dias`,
      top_consumidores: results
    };
  },

  async receita_por_periodo({ periodo_dias = 30, agrupar_por }) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodo_dias);

    let dateFormat;
    switch (agrupar_por) {
      case 'dia': dateFormat = '%Y-%m-%d'; break;
      case 'semana': dateFormat = '%Y-W%V'; break;
      case 'mes': dateFormat = '%Y-%m'; break;
      default: dateFormat = '%Y-%m-%d';
    }

    const result = await Payment.aggregate([
      { $match: { status: 'approved', created_at: { $gte: startDate } } },
      {
        $group: {
          _id: {
            periodo: { $dateToString: { format: dateFormat, date: '$created_at' } },
            moeda: '$currency'
          },
          total_valor: { $sum: '$amount' },
          total_creditos: { $sum: '$credits_to_add' },
          quantidade: { $sum: 1 }
        }
      },
      { $sort: { '_id.periodo': 1 } }
    ]);

    return {
      periodo: `Últimos ${periodo_dias} dias`,
      agrupado_por: agrupar_por,
      dados: result.map(r => ({
        periodo: r._id.periodo,
        moeda: r._id.moeda,
        valor: r.total_valor,
        creditos: r.total_creditos,
        transacoes: r.quantidade
      }))
    };
  }
};

// ============================================
// 🔧 EXECUTOR DE FUNÇÕES
// ============================================

async function executeFunction(functionName, args) {
  const fn = functionImplementations[functionName];
  if (!fn) {
    return { erro: `Função '${functionName}' não encontrada` };
  }

  try {
    console.log(`🔧 Executando função: ${functionName}`, JSON.stringify(args));
    const result = await fn(args);
    console.log(`✅ Função ${functionName} executada com sucesso`);
    return result;
  } catch (error) {
    console.error(`❌ Erro na função ${functionName}:`, error.message);
    return { erro: `Falha ao executar ${functionName}: ${error.message}` };
  }
}

module.exports = {
  functionDeclarations,
  executeFunction
};
