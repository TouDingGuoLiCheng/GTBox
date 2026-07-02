from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple

import yaml
from PIL import Image, UnidentifiedImageError

from .fixed import split_fixed_ranges
from .smart import split_smart_ranges

SUPPORTED_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


@dataclass
class SplitConfig:
    mode: str = "auto"
    output_dir: str = "./output"
    target_height: int = 2200
    max_height: int = 2800
    overlap: int = 40
    search_radius: int = 300
    blank_quantile: float = 0.2

    @classmethod
    def from_file(cls, path: Path) -> "SplitConfig":
        if not path.exists():
            return cls()
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        return cls(
            mode=str(data.get("mode", "auto")).lower(),
            output_dir=str(data.get("output_dir", "./output")),
            target_height=int(data.get("target_height", 2200)),
            max_height=int(data.get("max_height", 2800)),
            overlap=int(data.get("overlap", 40)),
            search_radius=int(data.get("search_radius", 300)),
            blank_quantile=float(data.get("blank_quantile", 0.2)),
        )


def collect_images(paths: List[str]) -> List[Path]:
    files: List[Path] = []
    for raw in paths:
        p = Path(raw)
        if p.is_file() and p.suffix.lower() in SUPPORTED_SUFFIXES:
            files.append(p)
            continue
        if p.is_dir():
            for child in sorted(p.iterdir()):
                if child.is_file() and child.suffix.lower() in SUPPORTED_SUFFIXES:
                    files.append(child)
    # de-duplicate while preserving order
    seen = set()
    unique: List[Path] = []
    for f in files:
        key = str(f.resolve())
        if key not in seen:
            seen.add(key)
            unique.append(f)
    return unique


def _output_name(stem: str, index: int) -> str:
    _ = stem
    return f"part_{index:03d}.png"


def _safe_name(name: str) -> str:
    safe = "".join(c for c in name if c not in '<>:"/\\|?*').strip()
    return safe or "image"


def _prepare_per_image_dir(base_output_dir: Path, image_stem: str) -> Path:
    safe_stem = _safe_name(image_stem)
    candidate = base_output_dir / safe_stem
    if not candidate.exists():
        candidate.mkdir(parents=True, exist_ok=True)
        return candidate

    idx = 2
    while True:
        numbered = base_output_dir / f"{safe_stem}_{idx}"
        if not numbered.exists():
            numbered.mkdir(parents=True, exist_ok=True)
            return numbered
        idx += 1


def prepare_image_output_dir(base_output_dir: Path, image_stem: str) -> Path:
    """Create and return per-image output directory."""
    base_output_dir.mkdir(parents=True, exist_ok=True)
    return _prepare_per_image_dir(base_output_dir, image_stem)


def _ranges_by_mode(image: Image.Image, config: SplitConfig) -> List[Tuple[int, int]]:
    if image.height <= config.max_height:
        return [(0, image.height)]

    mode = config.mode
    if mode == "fixed":
        return split_fixed_ranges(image.height, config.max_height, config.overlap)
    if mode == "smart":
        return split_smart_ranges(
            image=image,
            target_height=config.target_height,
            max_height=config.max_height,
            overlap=config.overlap,
            search_radius=config.search_radius,
            blank_quantile=config.blank_quantile,
        )
    if mode == "auto":
        try:
            return split_smart_ranges(
                image=image,
                target_height=config.target_height,
                max_height=config.max_height,
                overlap=config.overlap,
                search_radius=config.search_radius,
                blank_quantile=config.blank_quantile,
            )
        except Exception:
            return split_fixed_ranges(image.height, config.max_height, config.overlap)
    raise ValueError(f"Unsupported mode: {config.mode}")


def split_one_image(
    image_path: Path,
    output_dir: Path,
    config: SplitConfig,
) -> int:
    try:
        with Image.open(image_path) as im:
            image = im.convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError(f"Cannot open image: {image_path}") from exc

    per_image_dir = prepare_image_output_dir(output_dir, image_path.stem)
    return split_image_object(image, image_path.stem, per_image_dir, config)


def split_image_object(
    image: Image.Image,
    image_stem: str,
    output_dir: Path,
    config: SplitConfig,
) -> int:
    """Split a PIL image and save parts to output_dir."""
    ranges = _ranges_by_mode(image, config)
    output_dir.mkdir(parents=True, exist_ok=True)

    for idx, (top, bottom) in enumerate(ranges, start=1):
        part = image.crop((0, top, image.width, bottom))
        out_name = _output_name(image_stem, idx)
        part.save(output_dir / out_name, format="PNG")
    return len(ranges)


def process_batch(image_paths: List[Path], config: SplitConfig, base_dir: Path) -> Dict[str, int]:
    output_dir = (base_dir / config.output_dir).resolve()
    processed = 0
    skipped = 0
    slices = 0

    for image_path in image_paths:
        try:
            part_count = split_one_image(image_path, output_dir, config)
            processed += 1
            slices += part_count
            print(f"[OK] {image_path.name} -> {part_count} 张")
        except Exception as exc:
            skipped += 1
            print(f"[WARN] 跳过 {image_path.name}: {exc}")

    done_file = output_dir / "_done.txt"
    output_dir.mkdir(parents=True, exist_ok=True)
    done_file.write_text(
        (
            f"processed={processed}\n"
            f"skipped={skipped}\n"
            f"slices={slices}\n"
            f"output={output_dir}\n"
        ),
        encoding="utf-8",
    )

    return {"processed": processed, "skipped": skipped, "slices": slices}

