#!/usr/bin/env python3
"""Update songs.txt to keep only songs not yet downloaded."""

from __future__ import annotations

import csv
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

BASE = Path(__file__).resolve().parent
DEFAULT_CSV = BASE / "quark_results.csv"
DEFAULT_SONGS = BASE / "songs.txt"
DEFAULT_REPORT = BASE / "pending_downloads.txt"

SONGS_HEADER = "# one per line: song-artist (仅保留未下载成功的歌曲，用于重试)\n"


@dataclass
class ResultRow:
    query: str
    status: str
    note: str = ""


def prune_songs_file(
    songs_path: Path,
    downloaded_queries: set[str],
    failed_rows: Iterable[ResultRow],
    report_path: Path | None = None,
) -> int:
    """Remove downloaded lines from songs_path. Returns count of remaining songs."""
    failed_list = list(failed_rows)
    pending: list[str] = []
    for raw in songs_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip().lstrip("\ufeff")
        if not line or line.startswith("#"):
            continue
        if line not in downloaded_queries:
            pending.append(line)

    songs_path.write_text(SONGS_HEADER + "\n".join(pending) + "\n", encoding="utf-8")

    if report_path is not None:
        with report_path.open("w", encoding="utf-8") as f:
            f.write(f"未下载歌曲清单 (共{len(failed_list)}首)\n\n")
            f.write("格式: 歌名-歌手 | 状态 | 备注\n")
            f.write("=" * 60 + "\n")
            for r in failed_list:
                f.write(f"{r.query} | {r.status} | {r.note}\n")

    return len(pending)


def rows_from_csv(csv_path: Path) -> list[ResultRow]:
    with csv_path.open(encoding="utf-8-sig", newline="") as f:
        return [
            ResultRow(
                query=(row.get("query") or "").strip(),
                status=(row.get("status") or "").strip(),
                note=(row.get("note") or "").strip(),
            )
            for row in csv.DictReader(f)
        ]


def prune_from_results(
    songs_path: Path,
    rows: Iterable[ResultRow],
    report_path: Path | None = DEFAULT_REPORT,
) -> tuple[int, int]:
    """Prune songs file using in-memory result rows. Returns (downloaded_count, pending_count)."""
    row_list = list(rows)
    downloaded = {r.query for r in row_list if r.status == "downloaded" and r.query}
    failed = [r for r in row_list if r.status != "downloaded"]
    pending = prune_songs_file(songs_path, downloaded, failed, report_path)
    return len(downloaded), pending


def print_prune_summary(rows: Iterable[ResultRow], pending_count: int) -> None:
    row_list = list(rows)
    downloaded = sum(1 for r in row_list if r.status == "downloaded")
    failed = [r for r in row_list if r.status != "downloaded"]
    print("\n=== 状态统计 ===")
    for status, count in Counter(r.status for r in failed).most_common():
        print(f"{status}: {count}")
    print(f"\n总计: {len(row_list)} 首, 已下载: {downloaded}, 未下载: {len(failed)}")
    print(f"songs.txt 已更新: {pending_count} 首待重试")


def main() -> None:
    if not DEFAULT_CSV.exists():
        raise SystemExit(f"CSV not found: {DEFAULT_CSV}")
    rows = rows_from_csv(DEFAULT_CSV)
    downloaded_count, pending_count = prune_from_results(DEFAULT_SONGS, rows)
    print_prune_summary(rows, pending_count)
    print(f"详细清单已写入: {DEFAULT_REPORT}")


if __name__ == "__main__":
    main()
