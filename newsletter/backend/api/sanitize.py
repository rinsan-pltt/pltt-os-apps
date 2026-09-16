"""Shared HTML sanitizer for user-editable rich text (Tiptap output) that gets
injected into preview/export HTML. Keeps an allowlist of formatting tags and
strips scripts / event handlers / javascript: URLs."""

import re

_ALLOWED_TAGS = {
    "p", "br", "strong", "b", "em", "i", "u", "s", "mark", "a",
    "ul", "ol", "li", "span", "blockquote", "sub", "sup", "code", "hr",
}


def safe_html(html: str) -> str:
    if not html:
        return ""
    html = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", "", html)
    html = re.sub(r'(?is)\son\w+\s*=\s*"[^"]*"', "", html)
    html = re.sub(r"(?is)\son\w+\s*=\s*'[^']*'", "", html)
    html = re.sub(r"(?i)javascript:", "", html)

    def _strip(m: "re.Match[str]") -> str:
        return m.group(0) if m.group(1).lower() in _ALLOWED_TAGS else ""

    return re.sub(r"</?([a-zA-Z0-9]+)(?:\s[^>]*)?>", _strip, html)
