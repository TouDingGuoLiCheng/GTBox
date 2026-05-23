from __future__ import annotations

import argparse
import sys
from pathlib import Path

from splitter.core import SplitConfig, collect_images, process_batch

PICKED_INPUTS_REL = "temp/picked_inputs.txt"


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="长截图自动分割为多张 PNG")
    p.add_argument(
        "--input",
        action="append",
        default=None,
        help="图片文件或文件夹，可多次指定",
    )
    p.add_argument(
        "--inputs-file",
        default=None,
        help="每行一个图片绝对路径（多选图片时由工具箱写入）",
    )
    p.add_argument(
        "--output-dir",
        default=None,
        help="输出目录，相对 split_pic 目录；默认读 config.yaml",
    )
    p.add_argument(
        "--mode",
        choices=("auto", "smart", "fixed"),
        default=None,
        help="分割模式：auto / smart / fixed",
    )
    p.add_argument("--target-height", type=int, default=None)
    p.add_argument("--max-height", type=int, default=None)
    p.add_argument("--overlap", type=int, default=None)
    p.add_argument("--search-radius", type=int, default=None)
    p.add_argument("--blank-quantile", type=float, default=None)
    return p


def apply_overrides(config: SplitConfig, args: argparse.Namespace) -> SplitConfig:
    if args.output_dir is not None:
        config.output_dir = args.output_dir
    if args.mode is not None:
        config.mode = args.mode
    if args.target_height is not None:
        config.target_height = args.target_height
    if args.max_height is not None:
        config.max_height = args.max_height
    if args.overlap is not None:
        config.overlap = args.overlap
    if args.search_radius is not None:
        config.search_radius = args.search_radius
    if args.blank_quantile is not None:
        config.blank_quantile = args.blank_quantile
    return config


def resolve_image_paths(args: argparse.Namespace, base_dir: Path) -> list[Path]:
    if args.inputs_file:
        list_path = Path(args.inputs_file)
        if not list_path.is_absolute():
            list_path = (base_dir / list_path).resolve()
        if not list_path.exists():
            raise SystemExit(f"列表文件不存在: {list_path}")
        lines = list_path.read_text(encoding="utf-8").splitlines()
        out: list[Path] = []
        for line in lines:
            raw = line.strip()
            if not raw:
                continue
            p = Path(raw)
            if p.is_file():
                out.append(p.resolve())
        return out

    raw_inputs = args.input or []
    if not raw_inputs:
        raise SystemExit("请指定 --input 或 --inputs-file")

    paths: list[Path] = []
    for raw in raw_inputs:
        paths.extend(collect_images([raw]))
    return paths


def main() -> int:
    args = build_parser().parse_args()
    base_dir = Path(__file__).resolve().parent
    config = SplitConfig.from_file(base_dir / "config.yaml")
    config = apply_overrides(config, args)

    image_paths = resolve_image_paths(args, base_dir)
    if not image_paths:
        print("没有找到可处理的图片。支持: png/jpg/jpeg/webp/bmp", file=sys.stderr)
        return 1

    result = process_batch(image_paths, config, base_dir=base_dir)
    print(
        f"完成: 处理 {result['processed']} 张, "
        f"跳过 {result['skipped']} 张, "
        f"输出切片 {result['slices']} 张。"
    )
    out = (base_dir / config.output_dir).resolve()
    print(f"输出目录: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
