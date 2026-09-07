"""Nook-owned collector process. stdout carries exactly one JSON-safe DTO."""
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from nook_video.bilibili import Bilibili
from nook_video.core import PipelineError


def video_ref(value):
    if re.fullmatch(r'BV[0-9A-Za-z]{10}', value):
        return 'bilibili', value, 'https://www.bilibili.com/video/' + value
    url = urlparse(value)
    if url.scheme not in ('https', 'http') or url.username or url.password:
        raise PipelineError('请提供单个 Bilibili 或 YouTube 视频链接。')
    if url.hostname in ('bilibili.com', 'www.bilibili.com', 'm.bilibili.com'):
        match = re.fullmatch(r'/video/(BV[0-9A-Za-z]{10})/?', url.path)
        if match:
            return video_ref(match[1])
    if url.hostname in ('www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'):
        parts = url.path.strip('/').split('/')
        ident = parts[0] if url.hostname == 'youtu.be' else parse_qs(url.query).get('v', [''])[0] if url.path == '/watch' else parts[1] if len(parts) == 2 and parts[0] in ('shorts', 'live', 'embed') else ''
        if re.fullmatch(r'[A-Za-z0-9_-]{11}', ident):
            return 'youtube', ident, 'https://www.youtube.com/watch?v=' + ident
    raise PipelineError('仅支持 Bilibili / YouTube 单视频链接或 BV 号。')


def cached(folder, name, fetch):
    path = folder / name
    if path.exists():
        return json.loads(path.read_text(encoding='utf-8'))
    value = fetch()
    if value is not None:
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
        temporary.replace(path)
    return value


def bili(ident, url, folder, notes):
    client = Bilibili(os.getenv('BILI_COOKIE_FILE'))
    meta = cached(folder, 'metadata.json', lambda: client.video(ident))
    candidates, warnings, lines = [], [], []
    if notes:
        try:
            comments = cached(folder, 'comments.json', lambda: client.comments(meta['aid'], 5, 3))
            for item in comments['items']:
                if item.get('note_expanded'):
                    candidates.append({'id': item['id'], 'author': item.get('author', ''), 'markdown': item.get('markdown') or item['text'], 'text': item['text'], 'likes': item.get('likes', 0), 'complete': not item.get('incomplete') and not item.get('thread_incomplete')})
            warnings.append('评论采集范围为前 5 页热门一级评论、置顶及候选楼内最多 3 页回复，并非全部评论。')
        except PipelineError as exc:
            # Stop this collection on access limits; do not switch networks or identities.
            raise PipelineError('评论笔记采集未完成：' + str(exc)) from None
    for page in meta['pages']:
        try:
            data = cached(folder, 'transcript-p%d.json' % page['page'], lambda: client.subtitle(ident, page))
            if not data:
                warnings.append('P%d 没有可用字幕。' % page['page'])
                continue
            for segment in data['segments']:
                lines.append('[P%d %.1fs] %s' % (page['page'], segment['start'], segment['text']))
        except PipelineError as exc:
            if not candidates:
                raise
            warnings.append(str(exc)); break
    return {'url': url, 'title': meta['title'], 'author': meta['owner'].get('name', ''), 'transcript': '\n'.join(lines), 'candidates': candidates, 'warnings': warnings}


def youtube(ident, url, folder):
    def acquire():
        if sys.version_info < (3, 10):
            raise PipelineError('YouTube 采集需要 Python 3.10 或更新版本，请检查插件 python 配置。')
        try:
            from yt_dlp import YoutubeDL
            from yt_dlp.utils import DownloadError
        except ImportError:
            raise PipelineError('YouTube 采集需要在插件使用的 Python 环境安装 yt-dlp；详见 Nook README。') from None
        options = {'quiet': True, 'no_warnings': True, 'noplaylist': True, 'skip_download': True, 'socket_timeout': 30, 'retries': 2}
        if os.getenv('YOUTUBE_COOKIE_FILE'):
            options['cookiefile'] = os.environ['YOUTUBE_COOKIE_FILE']
        with YoutubeDL(options) as downloader:
            try:
                info = downloader.extract_info(url, download=False)
            except DownloadError as exc:
                message = str(exc).lower()
                if 'sign in' in message or 'login' in message:
                    raise PipelineError('YouTube 要求登录验证，请显式配置 YOUTUBE_COOKIE_FILE 后重试。') from None
                raise PipelineError('YouTube 视频信息获取失败，请检查网络、视频可访问性和平台登录状态。') from None
            if info.get('id') != ident:
                raise PipelineError('下载器返回了不同的视频。')
            for kind in ('subtitles', 'automatic_captions'):
                tracks = info.get(kind) or {}
                for language in ('zh', 'en'):
                    for name, formats in tracks.items():
                        if name != language and not name.startswith(language + '-'):
                            continue
                        for track in formats:
                            if track.get('ext') == 'json3' and track.get('url'):
                                with downloader.urlopen(track['url']) as response:
                                    body = response.read(20_000_001)
                                if len(body) > 20_000_000:
                                    raise PipelineError('字幕文件过大。')
                                value = json.loads(body)
                                lines = []
                                for event in value.get('events', []):
                                    text = ''.join(segment.get('utf8', '') for segment in event.get('segs', [])).strip()
                                    if text:
                                        lines.append('[%.1fs] %s' % (float(event.get('tStartMs', 0))/1000, text))
                                return {'url': url, 'title': info.get('title') or ident, 'author': info.get('uploader') or '', 'transcript': '\n'.join(lines), 'candidates': [], 'warnings': ['使用自动字幕，可能有识别错误。'] if kind == 'automatic_captions' else []}
        raise PipelineError('没有可用的中文或英文字幕。当前版本需要字幕，暂不自动下载音频转写。')
    return cached(folder, 'youtube.json', acquire)


def main():
    request = json.load(sys.stdin)
    platform, ident, url = video_ref(request['url'])
    folder = Path(request['root']) / (platform + '-' + ident)
    folder.mkdir(parents=True, exist_ok=True)
    material = bili(ident, url, folder, request['notes']) if platform == 'bilibili' else youtube(ident, url, folder)
    if not material['transcript'] and not material['candidates']:
        raise PipelineError('未取得字幕或完整笔记卡片。')
    print(json.dumps({'ok': True, 'value': material}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    try:
        main()
    except PipelineError as exc:
        print(json.dumps({'ok': False, 'error': str(exc)}, ensure_ascii=False), flush=True)
    except Exception:
        print(json.dumps({'ok': False, 'error': '采集失败，请检查网络、Python 依赖与平台登录状态。'}, ensure_ascii=False), flush=True)
