# Adapted from the user-owned bilibili-video-to-text collector, 2026-09-07.
"""Public note cards must be expanded before candidate scoring."""
import json
import math
import re
from urllib.parse import parse_qs, urlsplit

from .core import PipelineError

COMMENT_SCHEMA = 2


def note_reference(reply):
    value = reply.get('note_cvid_str') or reply.get('note_cvid')
    if value and str(value).isdigit() and int(value) > 0:
        return int(value)
    rich = reply.get('content', {}).get('rich_text', {}).get('note') or {}
    url = rich.get('click_url', '')
    cvid = parse_qs(urlsplit(url).query).get('cvid', [''])[0]
    if not cvid:
        match = re.search(r'/read/cv(\d+)', url)
        cvid = match.group(1) if match else ''
    return int(cvid) if cvid.isdigit() else None


def parse_note_content(content):
    """Decode Quill Delta without dropping unknown/image blocks silently."""
    try:
        ops = json.loads(content) if isinstance(content, str) else content
    except ValueError:
        raise PipelineError('公开笔记正文不是有效 Delta JSON') from None
    if isinstance(ops, dict):
        ops = ops.get('ops')
    if not isinstance(ops, list) or not ops:
        raise PipelineError('公开笔记缺少正文操作列表')
    plain, lines, line, incomplete = [], [], '', False
    for op in ops:
        value = op.get('insert')
        attrs = op.get('attributes') or {}
        if not isinstance(value, str):
            incomplete = True
            value = '[非文本内容，需查看原笔记]'
        plain.append(value)
        for i, part in enumerate(value.split('\n')):
            if i:
                heading = attrs.get('header')
                prefix = '#' * min(6, int(heading) + 2) + ' ' if isinstance(heading, int) else ''
                if attrs.get('list') == 'bullet': prefix = '- '
                if attrs.get('list') == 'ordered': prefix = '1. '
                lines.append(prefix + line)
                line = ''
            if part:
                if attrs.get('bold'): part = '**' + part + '**'
                line += part
    if line:
        lines.append(line)
    text = ''.join(plain).strip()
    if not text:
        raise PipelineError('公开笔记全文为空')
    return {'text': text, 'markdown': '\n\n'.join(lines), 'incomplete': incomplete}


def eligibility(candidate, metadata):
    """Depth floor is a guard, not proof of correctness or completeness."""
    if not candidate.get('expanded_note'):
        return '普通评论不自动替代笔记卡片；如需复用请手动指定'
    text = candidate['text'].strip()
    duration = sum(p.get('duration', 0) for p in metadata.get('pages', []))
    minimum = 800 if duration >= 900 else (400 if duration >= 300 else 200)
    if candidate.get('incomplete'):
        return '笔记卡片未展开、楼内续文不完整或包含未解析内容'
    if text.endswith(('...', '…')):
        return '正文疑似截断'
    if len(text) < minimum:
        return f'信息量不足：{len(text)} 字符，当前时长的初筛下限为 {minimum}'
    return None


def select_note_local(metadata, candidates):
    """Weighted rank voting over eligible cards; no model or coverage claim.

    Content length gets two votes, structure and title overlap one each,
    popularity half a vote. Ties share votes; input order never breaks ties.
    """
    eligible = []
    title = re.sub(r'[^\w]', '', metadata.get('title', '').lower())
    title_terms = {title[i:i + 2] for i in range(len(title) - 1)}
    for candidate in candidates:
        rejection = eligibility(candidate, metadata)
        candidate['screening'] = rejection or '完整笔记卡片，进入本地投票'
        if rejection:
            continue
        # Repeated lines add neither content nor structural credit.
        lines = list(dict.fromkeys(line.strip() for line in candidate['text'].splitlines() if line.strip()))
        text = '\n'.join(lines)
        compact = re.sub(r'[^\w]', '', text.lower())
        terms = {compact[i:i + 2] for i in range(len(compact) - 1)}
        markers = sum(bool(re.match(r'(?:#{1,6}\s|\d+[.、）)]|[一二三四五六七八九十]+[、：]|[-•]\s)', line))
                      for line in lines)
        candidate['assessment'] = {
            'method': 'local_vote_v1',
            'signals': {
                'information': min(len(text), 12000),
                'structure': min(len(lines), 20) + min(markers, 20),
                'relevance': len(title_terms & terms) / max(1, len(title_terms)),
                'likes': math.log1p(max(0, candidate.get('likes', 0))),
            },
            'reason': '本地规则选卡，保留笔记全文；未核验视频覆盖度或事实准确性',
        }
        eligible.append(candidate)
    if not eligible:
        return None
    weights = {'information': 2, 'structure': 1, 'relevance': 1, 'likes': 0.5}
    for candidate in eligible:
        signals = candidate['assessment']['signals']
        votes = {}
        for name, weight in weights.items():
            values = [other['assessment']['signals'][name] for other in eligible if other is not candidate]
            votes[name] = weight * sum(1 if signals[name] > value else 0.5 if signals[name] == value else 0
                                       for value in values)
        candidate['assessment'].update(votes=votes, score=sum(votes.values()))
    return min(eligible, key=lambda c: (-c['assessment']['score'],
                                      -c['assessment']['signals']['information'], tuple(c['ids'])))
