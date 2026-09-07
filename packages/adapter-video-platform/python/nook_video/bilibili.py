# Adapted from the user-owned bilibili-video-to-text collector, 2026-09-07.
"""Small read-only Bilibili adapter. Endpoints verified against yt-dlp's extractor.
No automatic login, challenge solving or posting. Cookies use a scoped cookie jar.
"""
import hashlib
import http.cookiejar
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from .core import AccessBlocked, PipelineError, normalize_segments
from .notes import COMMENT_SCHEMA, note_reference, parse_note_content
from .progress import report_progress

MIXIN = (46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13)


def sign(params, key, timestamp):
    values = dict(params, wts=int(timestamp))
    values = {k: ''.join(c for c in str(v) if c not in "!'()*") for k, v in sorted(values.items())}
    values["w_rid"] = hashlib.md5((urllib.parse.urlencode(values, quote_via=urllib.parse.quote) + key).encode()).hexdigest()
    return values


class Bilibili:
    def __init__(self, cookie_file=None, interval=2.0):
        jar = http.cookiejar.MozillaCookieJar()
        if cookie_file:
            jar.load(str(Path(cookie_file).expanduser()), ignore_discard=True)
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        self.interval = interval
        self.last = 0.0
        self.key = None
        self.key_time = 0.0

    def get_json(self, url):
        for attempt in range(3):
            time.sleep(max(0, self.interval - (time.monotonic() - self.last)))
            self.last = time.monotonic()
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0", "Referer": "https://www.bilibili.com/"})
            try:
                with self.opener.open(req, timeout=30) as response:
                    return json.load(response)
            except urllib.error.HTTPError as exc:
                if exc.code in (401, 403, 412, 429):
                    raise AccessBlocked(f"B站 HTTP {exc.code}：请检查登录态或稍后重试") from None
                if exc.code < 500:
                    raise PipelineError(f"B站 HTTP {exc.code}") from None
                reason = f'HTTP {exc.code}'
            except (urllib.error.URLError, TimeoutError, OSError):
                reason = '连接超时或网络中断'
            except (ValueError, UnicodeError):
                raise PipelineError("B站未返回有效 JSON，可能被风控拦截") from None
            if attempt < 2:
                report_progress(f'B站请求失败（{reason}），{2 ** attempt} 秒后重试（{attempt + 1}/2）')
                time.sleep(2 ** attempt)
        raise PipelineError("B站网络请求失败，已重试 3 次")

    def api(self, path, params, signed=False):
        if signed:
            if not self.key or time.monotonic() - self.key_time > 30:
                nav = self.get_json("https://api.bilibili.com/x/web-interface/nav")
                images = nav.get("data", {}).get("wbi_img", {})
                if not images:
                    raise AccessBlocked("无法获取 B站 WBI 信息，请检查登录态")
                source = ''.join(Path(urllib.parse.urlparse(images[k]).path).stem for k in ("img_url", "sub_url"))
                if len(source) < 64:
                    raise PipelineError("WBI 信息格式已改变")
                self.key = ''.join(source[i] for i in MIXIN)
                self.key_time = time.monotonic()
            params = sign(params, self.key, time.time())
        data = self.get_json("https://api.bilibili.com" + path + "?" + urllib.parse.urlencode(params))
        code = data.get("code")
        if code in (-101, -111, -352, -401, -403, -412, -509):
            raise AccessBlocked(f"B站返回 {code}：登录失效或请求受限，请检查 Cookie / 稍后重试")
        if code != 0:
            raise PipelineError(f"B站接口失败（code={code}）")
        return data.get("data") or {}

    def profile(self, mid):
        return self.api("/x/web-interface/card", {"mid": mid})["card"]

    def video_page(self, mid, page):
        return self.api("/x/space/wbi/arc/search", {"mid": mid, "pn": page, "ps": 30, "order": "pubdate"}, signed=True)

    def video(self, bvid):
        info = self.api("/x/web-interface/view", {"bvid": bvid})
        return {k: info[k] for k in ("bvid", "aid", "title", "owner", "pubdate", "desc", "pages")}

    def comments(self, aid, max_pages=5, reply_pages=3):
        notes, seen = [], set()
        exhausted = False
        note_errors = []
        def add(reply):
            rid = str(reply["rpid"])
            if rid in seen:
                return
            seen.add(rid)
            note = {"id": rid, "root": str(reply.get("root", 0)),
                          "author": reply.get("member", {}).get("uname", ""),
                          "author_id": str(reply.get("member", {}).get("mid", "")),
                          "text": reply.get("content", {}).get("message", ""),
                          "likes": reply.get("like", 0), "ctime": reply.get("ctime")}
            cvid = note_reference(reply)
            is_note = bool(reply.get('reply_control', {}).get('is_note') or cvid)
            note.update(is_note=is_note, note_cvid=cvid)
            if is_note:
                note['preview'] = note['text']
                note['note_expanded'] = False
                try:
                    if not cvid:
                        raise PipelineError('笔记卡片缺少 cvid')
                    article = self.api('/x/note/publish/info', {'cvid': cvid})
                    if str(article.get('arc', {}).get('oid')) != str(aid):
                        raise PipelineError('公开笔记关联视频与当前视频不符')
                    if str(article.get('author', {}).get('mid')) != note['author_id']:
                        raise PipelineError('公开笔记作者与评论作者不符')
                    parsed = parse_note_content(article.get('content'))
                    note.update(text=parsed['text'], markdown=parsed['markdown'],
                                note_expanded=True, incomplete=parsed['incomplete'],
                                note_url=f'https://www.bilibili.com/read/cv{cvid}',
                                note_title=article.get('title'), note_content=article['content'])
                except AccessBlocked:
                    raise
                except PipelineError as exc:
                    note['note_error'] = str(exc)
                    note_errors.append({'id': rid, 'error': str(exc)})
            notes.append(note)
            return note
        threads_truncated = False
        for pn in range(1, max_pages + 1):
            data = self.api("/x/v2/reply", {"oid": aid, "type": 1, "sort": 2, "pn": pn, "ps": 20})
            replies = data.get("replies") or []
            roots = replies + (data.get("hots") or []) + list((data.get("top_replies") or []))
            upper = data.get("upper") or {}
            if upper.get("top"):
                roots.append(upper["top"])
            for root in roots:
                if str(root["rpid"]) in seen:
                    continue
                root_note = add(root)
                for child in root.get("replies") or []:
                    add(child)
                # Candidate threads only; other subthreads remain outside scan coverage.
                from .core import note_score
                if (root_note.get("is_note") or note_score(root_note) >= 4) and root.get("rcount", 0):
                    count = root.get("rcount", 0)
                    for rpn in range(1, min(reply_pages, (count + 19) // 20) + 1):
                        children = self.api("/x/v2/reply/reply", {"oid": aid, "type": 1, "root": root["rpid"], "pn": rpn, "ps": 20})
                        for child in children.get("replies") or []:
                            add(child)
                    root_note["thread_incomplete"] = count > reply_pages * 20
                    threads_truncated |= root_note["thread_incomplete"]
            total = data.get("page", {}).get("count")
            if not replies or (total is not None and pn * 20 >= total):
                exhausted = True
                break
        return {"schema_version": COMMENT_SCHEMA, "items": notes, "scan": {"root_pages": pn, "note_errors": note_errors, "root_exhausted": exhausted,
                "candidate_threads_truncated": threads_truncated, "scope": "热门一级评论、置顶及候选笔记楼内回复；非全评论扫描"}}

    def subtitle(self, bvid, page):
        data = self.api("/x/player/wbi/v2", {"bvid": bvid, "cid": page["cid"]}, signed=True)
        tracks = data.get("subtitle", {}).get("subtitles") or []
        if not tracks and data.get("need_login_subtitle"):
            raise AccessBlocked("字幕需要登录，请配置 BILI_COOKIE_FILE")
        tracks = [s for s in tracks if s.get("subtitle_url") and "zh" in s.get("lan", "")]
        tracks.sort(key=lambda s: (s.get("lan", "").startswith("ai-"), s.get("lan") != "zh-CN"))
        for track in tracks:
            url = track["subtitle_url"]
            if url.startswith("//"):
                url = "https:" + url
            host = urllib.parse.urlparse(url).hostname or ""
            if not (host.endswith(".hdslb.com") or host.endswith(".bilibili.com")) or not url.startswith("https://"):
                raise PipelineError("字幕 URL 不属于预期的 HTTPS B站域名")
            segments = normalize_segments(self.get_json(url).get("body", []))
            if segments:
                return {"source": "subtitle", "language": track["lan"], "segments": segments}
        return None
