const ytdl = require('@distube/ytdl-core');
const SpotifyWebApi = require('spotify-web-api-node');
const fs = require('fs');

async function searchYouTube(query) {
    // Usa a API do YouTube para buscar
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    
    // Pega o primeiro resultado (simplificado - em produção use youtube-search-api)
    // Por enquanto vamos usar um vídeo de teste conhecido
    return 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'; // Rick Astley pra testar
}

async function test() {
    try {
        // 1. Configura Spotify API
        const spotifyApi = new SpotifyWebApi({
            clientId: '945324e21e04420d8f1a3d72b891dee4',
            clientSecret: '407c5fcbb52a467cb56aeefb1cf00a8f'
        });

        console.log('🔑 Autenticando no Spotify...');
        const auth = await spotifyApi.clientCredentialsGrant();
        spotifyApi.setAccessToken(auth.body.access_token);

        // 2. Busca música no Spotify
        console.log('🔍 Buscando no Spotify...');
        const result = await spotifyApi.searchTracks('Mr Brightside The Killers', { limit: 1 });
        const track = result.body.tracks.items[0];
        
        console.log('✅ Encontrado:', track.name, '-', track.artists[0].name);

        // 3. Busca e baixa do YouTube
        const query = `${track.name} ${track.artists[0].name} audio`;
        console.log('🔍 Buscando no YouTube:', query);
        
        const videoUrl = await searchYouTube(query);
        console.log('📥 Baixando do YouTube...');

        const stream = ytdl(videoUrl, { 
            quality: 'highestaudio',
            filter: 'audioonly'
        });

        const output = fs.createWriteStream('test-audio.mp3');
        stream.pipe(output);

        stream.on('end', () => {
            console.log('✅ Download completo! Arquivo: test-audio.mp3');
        });

        stream.on('error', (err) => {
            console.error('❌ Erro no download:', err.message);
        });

    } catch (error) {
        console.error('❌ Erro:', error.message);
    }
}

test();
