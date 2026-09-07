import re

class PipelineError(Exception): pass
class AccessBlocked(PipelineError): pass

def normalize_segments(items):
    result = []
    for item in items:
        text = str(item.get("text", item.get("content", ""))).strip()
        start = float(item.get("start", item.get("from", 0)))
        end = float(item.get("end", item.get("to", start)))
        if start < 0 or end < start:
            raise PipelineError("字幕时间范围无效")
        if text:
            result.append({"start": start, "end": end, "text": text})
    return sorted(result, key=lambda s: s["start"])


def note_score(note):
    """Candidate detection only, never treats likes/length as proof of accuracy."""
    text = note["text"]
    markers = bool(re.search(r"总结|笔记|摘要|要点|课代表|省流", text))
    timestamps = len(re.findall(r"\b\d{1,2}[:：]\d{2}(?:[:：]\d{2})?\b", text))
    bullets = len(re.findall(r"(?m)^\s*(?:\d+[.、）)]|[一二三四五六七八九十]+[、：]|[-•])", text))
    return (2 if len(text) >= 250 else 0) + (2 if markers else 0) + min(3, timestamps) + min(3, bullets)


