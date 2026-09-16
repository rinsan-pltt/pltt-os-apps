"""ElevenLabs narration (TTS) + music generation for the Long Video audio
pipeline. Narration uses eleven_v3 via the `/with-timestamps` endpoint so the
per-character alignment can be folded into word-level caption cues; music
uses the Eleven Music API (`music_v2`), sized to the run's total duration.
"""

from __future__ import annotations

import base64
import logging
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger("pltt_creative_video.elevenlabs")

_BASE = "https://api.elevenlabs.io/v1"

# A widely-used ElevenLabs premade voice ("Rachel") — a sensible default when
# the user hasn't picked one in the audio settings dialog.
DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"

_MUSIC_MIN_MS = 3000
_MUSIC_MAX_MS = 600000


async def generate_narration(
    api_key: str,
    text: str,
    voice_id: str = DEFAULT_VOICE_ID,
    language_code: Optional[str] = None,
) -> Tuple[bytes, List[Dict[str, Any]]]:
    """Returns (mp3 bytes, word-level caption cues: [{"text", "start", "end"}]).

    `language_code` (ISO 639-1, e.g. "en"/"ko") forces the pronunciation/
    accent ElevenLabs' multilingual model uses — left unset falls back to its
    own language auto-detection from the text."""
    body: Dict[str, Any] = {"text": text, "model_id": "eleven_v3"}
    if language_code:
        body["language_code"] = language_code
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            f"{_BASE}/text-to-speech/{voice_id}/with-timestamps",
            headers={"xi-api-key": api_key},
            json=body,
        )
        r.raise_for_status()
        data = r.json()

    audio = base64.b64decode(data["audio_base64"])
    alignment = data.get("alignment") or data.get("normalized_alignment") or {}
    words = _words_from_alignment(
        alignment.get("characters") or [],
        alignment.get("character_start_times_seconds") or [],
        alignment.get("character_end_times_seconds") or [],
    )
    return audio, words


def _words_from_alignment(
    chars: List[str], starts: List[float], ends: List[float]
) -> List[Dict[str, Any]]:
    """Folds ElevenLabs' character-level alignment into word-level cues by
    grouping non-whitespace runs, so caption lines can be built from them."""
    words: List[Dict[str, Any]] = []
    buf = ""
    w_start: Optional[float] = None
    w_end: Optional[float] = None
    for ch, s, e in zip(chars, starts, ends):
        if ch.isspace():
            if buf:
                words.append({"text": buf, "start": w_start, "end": w_end})
                buf = ""
                w_start = None
            continue
        if w_start is None:
            w_start = s
        buf += ch
        w_end = e
    if buf:
        words.append({"text": buf, "start": w_start, "end": w_end})
    return words


def group_captions(
    words: List[Dict[str, Any]], max_chars: int = 34
) -> List[Dict[str, Any]]:
    """Chunks word cues into short caption lines (~max_chars) for burning one
    line at a time, rather than a fresh line per single word."""
    lines: List[Dict[str, Any]] = []
    buf: List[Dict[str, Any]] = []
    length = 0
    for w in words:
        added = len(w["text"]) + (1 if buf else 0)
        if buf and length + added > max_chars:
            lines.append(_line_from_words(buf))
            buf = []
            length = 0
            added = len(w["text"])
        buf.append(w)
        length += added
    if buf:
        lines.append(_line_from_words(buf))
    return lines


def _line_from_words(words: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "text": " ".join(w["text"] for w in words),
        "start": words[0]["start"],
        "end": words[-1]["end"],
    }


async def generate_music(api_key: str, prompt: str, duration_ms: int) -> bytes:
    duration_ms = max(_MUSIC_MIN_MS, min(_MUSIC_MAX_MS, duration_ms))
    async with httpx.AsyncClient(timeout=180) as client:
        r = await client.post(
            f"{_BASE}/music",
            headers={"xi-api-key": api_key},
            json={"prompt": prompt, "music_length_ms": duration_ms, "model_id": "music_v2"},
        )
        r.raise_for_status()
        return r.content
