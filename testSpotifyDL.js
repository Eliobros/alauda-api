const { Spotify } = require('spotifydl-core');

async function test() {
    try {
        const spotify = new Spotify({
            clientId: '945324e21e04420d8f1a3d72b891dee4',
            clientSecret: '407c5fcbb52a467cb56aeefb1cf00a8f'
        });

        console.log('🔍 Testando com URL do Spotify...');
        
        // Teste com URL direta
        const url = 'https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp'; // Mr. Brightside - The Killers
        
        console.log('📥 Baixando:', url);
        const data = await spotify.getTrack(url);
        
        console.log('✅ Informações obtidas!');
        console.log('🎵 Título:', data.name);
        console.log('👤 Artista:', data.artists);
        console.log('💿 Álbum:', data.album);
        console.log('🔗 URL:', data.url);
        
        // Tenta baixar
        console.log('\n📥 Iniciando download...');
        const audio = await spotify.downloadTrack(url);
        console.log('✅ Download concluído!');
        console.log(audio);
        
    } catch (error) {
        console.error('❌ Erro:', error.message);
        console.error('Stack:', error.stack);
    }
}

test();
