"""Generate Karplus-Strong electric-guitar pluck samples (6 open strings)."""

from __future__ import annotations

import math
import random
import struct
import wave
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parents[1] / "public" / "audio" / "guitar" / "builtin"
SR = 44100
DURATION = 2.2

# Standard tuning open strings
SAMPLES = [
    ("e2.wav", 82.4069, 40),
    ("a2.wav", 110.0, 45),
    ("d3.wav", 146.8324, 50),
    ("g3.wav", 195.9977, 55),
    ("b3.wav", 246.9417, 59),
    ("e4.wav", 329.6276, 64),
]


def karplus_strong(freq: float, duration: float = DURATION, sr: int = SR) -> list[int]:
    n = max(2, int(sr / freq))
    buf = [random.uniform(-1, 1) for _ in range(n)]
    total = int(sr * duration)
    out: list[float] = []
    for i in range(total):
        sample = buf[0]
        out.append(sample)
        nxt = 0.9965 * 0.5 * (buf[0] + buf[1])
        buf = buf[1:] + [nxt]

    attack = int(sr * 0.004)
    release_start = int(sr * 0.35)
    release_len = max(1, total - release_start)
    pcm: list[int] = []
    for i, v in enumerate(out):
        env = 1.0
        if i < attack:
            env = i / attack
        elif i > release_start:
            env = max(0.0, 1.0 - (i - release_start) / release_len)
        val = max(-1.0, min(1.0, v * env * 0.72))
        pcm.append(int(val * 32767))
    return pcm


def write_wav(path: Path, pcm: list[int]) -> None:
    with wave.open(str(path), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(struct.pack("<" + "h" * len(pcm), *pcm))


def main() -> None:
    random.seed(42)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, freq, midi in SAMPLES:
        path = OUT_DIR / name
        write_wav(path, karplus_strong(freq))
        print(f"Wrote {path.name} ({midi}) {path.stat().st_size} bytes")

    # Backward-compatible alias (explore / legacy)
    legacy_dir = OUT_DIR.parent
    alias = legacy_dir / "clean-e2.wav"
    alias.write_bytes((OUT_DIR / "e2.wav").read_bytes())
    print(f"Alias {alias.name}")


if __name__ == "__main__":
    main()
