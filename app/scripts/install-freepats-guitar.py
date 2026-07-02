"""Copy FreePats distorted guitar open-string samples into app/public/audio/guitar."""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

MAPPING = {
    "e2.wav": "E2_s1_01.wav",
    "a2.wav": "A2_s2_01.wav",
    "d3.wav": "D3_s3_01.wav",
    "g3.wav": "G3_s4_01.wav",
    "b3.wav": "B3_s5_01.wav",
    "e4.wav": "E4_s6_01.wav",
}

OUT_DIR = Path(__file__).resolve().parents[1] / "public" / "audio" / "guitar" / "recorded"


def find_samples_dir(root: Path) -> Path:
    direct = root / "samples"
    if direct.is_dir():
        return direct
    for child in root.iterdir():
        if child.is_dir():
            nested = child / "samples"
            if nested.is_dir():
                return nested
    raise FileNotFoundError(f"samples folder not found under {root}")


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python install-freepats-guitar.py <extracted-sfz-folder>")
        sys.exit(1)

    src_dir = find_samples_dir(Path(sys.argv[1]).resolve())
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for dest_name, src_name in MAPPING.items():
        src = src_dir / src_name
        if not src.is_file():
            raise FileNotFoundError(src)
        dest = OUT_DIR / dest_name
        shutil.copy2(src, dest)
        print(f"OK {dest_name} <- {src_name} ({dest.stat().st_size} bytes)")

    shutil.copy2(OUT_DIR / "e2.wav", OUT_DIR.parent / "clean-e2.wav")
    print("OK clean-e2.wav alias")


if __name__ == "__main__":
    main()
