"""Token-based chunking with overlap, using tiktoken when available with a
character-based fallback so import/offline never breaks the pipeline."""

from newsletter_backend.api.config import settings

_enc = None
_enc_tried = False


def _encoding():
    global _enc, _enc_tried
    if _enc_tried:
        return _enc
    _enc_tried = True
    try:
        import tiktoken

        _enc = tiktoken.get_encoding("cl100k_base")
    except Exception:
        _enc = None
    return _enc


def chunk_text(text: str) -> list[tuple[str, int]]:
    """Split text into overlapping windows. Returns (chunk_text, token_count)."""
    text = text.strip()
    if not text:
        return []

    enc = _encoding()
    if enc is not None:
        tokens = enc.encode(text)
        size = settings.chunk_tokens
        step = max(1, size - settings.chunk_overlap)
        chunks: list[tuple[str, int]] = []
        for start in range(0, len(tokens), step):
            window = tokens[start : start + size]
            if not window:
                break
            piece = enc.decode(window).strip()
            if piece:
                chunks.append((piece, len(window)))
            if start + size >= len(tokens):
                break
        return chunks

    # fallback: ~4 chars per token heuristic
    size = settings.chunk_tokens * 4
    step = max(1, size - settings.chunk_overlap * 4)
    chunks = []
    for start in range(0, len(text), step):
        piece = text[start : start + size].strip()
        if piece:
            chunks.append((piece, len(piece) // 4))
        if start + size >= len(text):
            break
    return chunks


def count_tokens(text: str) -> int:
    enc = _encoding()
    return len(enc.encode(text)) if enc is not None else len(text) // 4
