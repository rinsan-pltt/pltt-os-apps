"""ffmpeg helpers for extracting a video's first frame as a thumbnail."""

from __future__ import annotations

import shutil
import subprocess


def find_ffmpeg() -> str | None:
    """System ffmpeg first; fall back to the static binary bundled with
    imageio-ffmpeg when that package is installed."""
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def extract_first_frame(ffmpeg: str, video_path: str, out_path: str) -> None:
    """Grab the video's very first decodable frame as a JPEG at `out_path`.
    Blocking (run it in a thread). Raises RuntimeError with the tail of
    ffmpeg's stderr on failure."""
    cmd = [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
        "-i", video_path, "-frames:v", "1", "-q:v", "2",
        out_path,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise RuntimeError(
            f"ffmpeg thumbnail extraction failed: {(proc.stderr or '').strip()[-1000:]}"
        )
