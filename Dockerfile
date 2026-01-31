# Dockerfile
FROM python:3.9-slim

# Instalar Node.js 18
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Instalar dependências do sistema
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Instalar Spleeter
RUN pip install --no-cache-dir spleeter==2.4.0

# Pre-download modelos Spleeter (2 stems)
RUN echo "📦 Baixando modelos Spleeter..." && \
    mkdir -p /root/.cache/spleeter && \
    spleeter separate -p spleeter:2stems -o /tmp/test \
        https://github.com/deezer/spleeter/raw/master/audio_example.mp3 && \
    echo "✅ Modelo 2stems baixado" && \
    rm -rf /tmp/test

# Diretório de trabalho
WORKDIR /app

# Instalar dependências Node
COPY package*.json ./
RUN npm ci --only=production

# Copiar código
COPY . .

# Criar diretórios
RUN mkdir -p /app/temp/output

# Expor porta
EXPOSE 3000

# Variáveis
ENV NODE_ENV=production
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Iniciar
CMD ["node", "server.js"]
