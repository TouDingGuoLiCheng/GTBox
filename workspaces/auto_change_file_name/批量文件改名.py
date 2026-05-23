#!/usr/bin/env python3
"""
通用批量文件改名：按「前缀 + 序号 + 原扩展名」规则重命名，支持递归/仅一层、
按路径排序后编号、dry-run、可选计数文件跨次接续。

在工具箱中由 manifest 传参调用；也可命令行单独使用：
  python 批量文件改名.py --root D:\\photos --prefix 图_
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def read_last_counter(path: Path) -> int | None:
    """计数文件中存「上次已分配到的最大序号」；不存在或无效则返回 None。"""
    if not path.exists():
        return None
    try:
        text = path.read_text(encoding="utf-8").strip()
        if not text:
            return None
        return int(text)
    except (OSError, ValueError):
        return None


def write_counter(path: Path, last_used: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(str(last_used), encoding="utf-8")


def collect_files(root: Path, recursive: bool) -> list[Path]:
    if not root.is_dir():
        raise SystemExit(f"根目录不存在或不是文件夹: {root}")
    out: list[Path] = []
    if recursive:
        for folder, _sub, filenames in os.walk(root):
            for name in filenames:
                out.append(Path(folder) / name)
    else:
        for name in os.listdir(root):
            p = root / name
            if p.is_file():
                out.append(p)
    return out


def rename_batch(
    root: Path,
    *,
    prefix: str,
    width: int,
    start_num: int | None,
    counter_file: Path | None,
    recursive: bool,
    sort_by_path: bool,
    dry_run: bool,
) -> tuple[int, int]:
    """返回 (最后分配的序号, 本次应接续的起始序号，用于判断是否写回计数文件)。"""
    files = collect_files(root, recursive)
    if sort_by_path:
        files.sort(key=lambda p: str(p).lower())

    if not files:
        print("没有需要处理的文件。")
        return 0, 0

    if start_num is not None:
        next_num = start_num
    elif counter_file is not None:
        last = read_last_counter(counter_file)
        next_num = (last + 1) if last is not None else 1
    else:
        next_num = 1

    seq_start = next_num
    last_assigned = next_num - 1
    for old in files:
        ext = old.suffix
        new_name = f"{prefix}{next_num:0{width}d}{ext}"
        new_path = old.with_name(new_name)
        if new_name == old.name:
            last_assigned = next_num
            next_num += 1
            continue
        if new_path.exists() and new_path.resolve() != old.resolve():
            print(f"Skip (target exists): {new_path}", file=sys.stderr)
            continue
        print(f"Renaming: {old} -> {new_path}")
        if not dry_run:
            try:
                os.rename(old, new_path)
            except OSError as e:
                print(f"Error processing {old}: {e}", file=sys.stderr)
                continue
        last_assigned = next_num
        next_num += 1

    return last_assigned, seq_start


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="通用批量文件改名：前缀 + 数字序号 + 保留扩展名")
    p.add_argument("--root", required=True, help="要处理的根目录（绝对路径或相对当前工作区）")
    p.add_argument("--prefix", default="", help="新文件名前缀，默认空")
    p.add_argument(
        "--width",
        type=int,
        default=3,
        help="序号数字位数（不足补零），默认 3",
    )
    p.add_argument(
        "--start",
        type=int,
        default=None,
        help="强制指定起始序号（覆盖计数文件）；从 1 开始编号时填 1",
    )
    p.add_argument(
        "--counter-file",
        default=None,
        help="接续序号的文本文件（存上次最大序号）；不传则使用脚本目录下 temp/rename_counter.txt",
    )
    p.add_argument(
        "--no-counter-file",
        action="store_true",
        help="不使用计数文件（每次从 --start 或 1 开始；与 --start 配合）",
    )
    p.add_argument(
        "--depth",
        choices=("recursive", "top"),
        default="recursive",
        help="recursive=含子文件夹；top=仅根目录一层",
    )
    p.add_argument(
        "--order",
        choices=("path", "none"),
        default="path",
        help="path=按完整路径排序后编号；none=os 遍历顺序",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="只打印将要执行的重命名，不写入磁盘、不写计数文件",
    )
    return p


def main() -> None:
    args = build_arg_parser().parse_args()
    root = Path(args.root).resolve()
    recursive = args.depth == "recursive"
    sort_by_path = args.order == "path"

    script_dir = Path(__file__).resolve().parent
    default_counter = script_dir / "temp" / "rename_counter.txt"

    counter_file: Path | None
    if args.no_counter_file:
        counter_file = None
    elif args.counter_file:
        counter_file = Path(args.counter_file).resolve()
    else:
        counter_file = default_counter

    start_num: int | None = args.start

    last, seq_start = rename_batch(
        root,
        prefix=args.prefix,
        width=max(1, args.width),
        start_num=start_num,
        counter_file=counter_file,
        recursive=recursive,
        sort_by_path=sort_by_path,
        dry_run=args.dry_run,
    )
    if counter_file is not None and not args.dry_run and seq_start > 0 and last >= seq_start:
        write_counter(counter_file, last)

    mode = "（dry-run，未修改文件）" if args.dry_run else ""
    print(f"完成。最后分配序号：{last} {mode}".strip())


if __name__ == "__main__":
    main()
