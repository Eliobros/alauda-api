#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Instagram Downloader para Alauda API
Usando Instaloader
By: Zëüs Lykraios
"""

import sys
import json
import instaloader
from datetime import datetime
import tempfile
import os
import shutil

def extract_shortcode(url):
    """Extrai o shortcode da URL do Instagram"""
    # https://www.instagram.com/p/SHORTCODE/
    # https://www.instagram.com/reel/SHORTCODE/
    # https://instagram.com/p/SHORTCODE/
    
    if '/p/' in url:
        shortcode = url.split('/p/')[1].split('/')[0].split('?')[0]
    elif '/reel/' in url:
        shortcode = url.split('/reel/')[1].split('/')[0].split('?')[0]
    elif '/tv/' in url:
        shortcode = url.split('/tv/')[1].split('/')[0].split('?')[0]
    else:
        raise ValueError("URL inválida do Instagram")
    
    return shortcode

def download_instagram_post(url):
    """Baixa post/reel do Instagram"""
    try:
        # Cria instância do Instaloader
        L = instaloader.Instaloader(
            download_pictures=True,
            download_videos=True,
            download_video_thumbnails=False,
            download_geotags=False,
            download_comments=False,
            save_metadata=False,
            compress_json=False,
            post_metadata_txt_pattern='',
            quiet=True
        )
        
        # Extrai shortcode da URL
        shortcode = extract_shortcode(url)
        
        # Baixa o post
        post = instaloader.Post.from_shortcode(L.context, shortcode)
        
        # Cria diretório temporário
        temp_dir = tempfile.mkdtemp()
        
        # Baixa o conteúdo
        L.download_post(post, target=temp_dir)
        
        # Lista arquivos baixados
        files = os.listdir(temp_dir)
        media_files = []
        
        for file in files:
            file_path = os.path.join(temp_dir, file)
            if file.endswith(('.jpg', '.mp4', '.png')):
                media_files.append(file_path)
        
        # Monta resposta
        result = {
            'success': True,
            'post': {
                'shortcode': post.shortcode,
                'url': f"https://www.instagram.com/p/{post.shortcode}/",
                'type': 'video' if post.is_video else 'image',
                'caption': post.caption if post.caption else 'Sem legenda',
                'media': {
                    'url': post.video_url if post.is_video else post.url,
                    'thumbnail': post.url if post.is_video else None,
                    'local_files': media_files
                },
                'stats': {
                    'likes': post.likes,
                    'comments': post.comments,
                    'views': post.video_view_count if post.is_video else None
                },
                'author': {
                    'username': post.owner_username,
                    'profile_pic': post.owner_profile.profile_pic_url if hasattr(post, 'owner_profile') else None,
                    'is_verified': post.owner_profile.is_verified if hasattr(post, 'owner_profile') else False
                },
                'created_at': post.date_utc.isoformat(),
                'location': post.location.name if post.location else None,
                'hashtags': list(post.caption_hashtags) if post.caption else [],
                'mentions': list(post.caption_mentions) if post.caption else [],
                'is_video': post.is_video,
                'sidecar': []
            }
        }
        
        # Se for carrossel (múltiplas mídias)
        if post.typename == 'GraphSidecar':
            result['post']['type'] = 'carousel'
            sidecar_nodes = post.get_sidecar_nodes()
            for idx, node in enumerate(sidecar_nodes):
                result['post']['sidecar'].append({
                    'index': idx + 1,
                    'type': 'video' if node.is_video else 'image',
                    'url': node.video_url if node.is_video else node.display_url
                })
        
        # Limpa diretório temporário
        shutil.rmtree(temp_dir, ignore_errors=True)
        
        return result
        
    except instaloader.exceptions.ProfileNotExistsException:
        return {
            'success': False,
            'error': 'Perfil não encontrado'
        }
    except instaloader.exceptions.PrivateProfileNotFollowedException:
        return {
            'success': False,
            'error': 'Post privado. Não é possível baixar sem autenticação.'
        }
    except instaloader.exceptions.LoginRequiredException:
        return {
            'success': False,
            'error': 'Login necessário para este conteúdo'
        }
    except instaloader.exceptions.PostChangedException:
        return {
            'success': False,
            'error': 'Post foi modificado ou deletado'
        }
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }

def main():
    """Função principal"""
    if len(sys.argv) < 2:
        print(json.dumps({
            'success': False,
            'error': 'URL não fornecida'
        }))
        sys.exit(1)
    
    url = sys.argv[1]
    
    # Valida URL
    if not ('instagram.com' in url and ('/p/' in url or '/reel/' in url or '/tv/' in url)):
        print(json.dumps({
            'success': False,
            'error': 'URL inválida do Instagram'
        }))
        sys.exit(1)
    
    # Baixa o post
    result = download_instagram_post(url)
    
    # Retorna resultado como JSON
    print(json.dumps(result, ensure_ascii=False))
    
    sys.exit(0 if result['success'] else 1)

if __name__ == '__main__':
    main()
