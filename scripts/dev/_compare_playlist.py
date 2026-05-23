# -*- coding: utf-8 -*-
import re
import json
from pathlib import Path
from collections import defaultdict
from difflib import SequenceMatcher

PLAYLIST = Path(r"d:\VS\工具箱开发\_playlist_user.txt")
DOWNLOADS = Path(r"D:\Pycharm\爬虫\爬取音乐\downloads")
OUT = Path(r"d:\VS\工具箱开发\_compare_result.json")

SKIP = re.compile(r"我的收藏|歌单|专辑|→|←|帮我和这个文件夹", re.I)


def norm(s: str) -> str:
    s = (s or "").lower().strip()
    s = re.sub(r"\.(mp3|flac|m4a|wav)$", "", s, flags=re.I)
    s = re.sub(r"[_\-\s\.…]+", "", s)
    s = re.sub(r"[^\w\u4e00-\u9fff]", "", s)
    return s


def parse_entry(line: str):
    line = line.strip()
    if not line or SKIP.search(line):
        return None
    if "-" not in line:
        return line, ""
    a, b = line.rsplit("-", 1)
    return a.strip(), b.strip()


def split_file(name: str):
    stem = Path(name).stem
    stem = re.sub(r"_[a-zA-Z0-9]{6,}$", "", stem)
    stem = re.sub(r"_\d{6,}$", "", stem)
    if " - " in stem:
        x, y = stem.split(" - ", 1)
        return x.strip(), y.strip()
    if "-" in stem:
        x, y = stem.rsplit("-", 1)
        return x.strip(), y.strip()
    return stem, ""


def song_key(title, artist):
    return norm(title) + "|" + norm(artist)


def pair_key(title, artist):
    """歌手/曲名顺序无关的键"""
    parts = sorted([norm(title), norm(artist)])
    return parts[0] + "||" + parts[1]


def sim(a, b):
    na, nb = norm(a), norm(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    if na in nb or nb in na:
        return 0.9
    return SequenceMatcher(None, na, nb).ratio()


def match_song(title, artist, files):
    best_i, best_s = -1, 0.0
    for i, (ft, fa, fn) in enumerate(files):
        s = max(
            sim(title, ft) * 0.55 + sim(artist, fa) * 0.45,
            sim(title, fa) * 0.55 + sim(artist, ft) * 0.45,
            sim(title + artist, ft + fa),
        )
        if s > best_s:
            best_i, best_s = i, s
    return best_i, best_s


def main():
    lines = [ln for ln in PLAYLIST.read_text(encoding="utf-8").splitlines() if ln.strip()]
    entries = []
    for i, line in enumerate(lines, 1):
        p = parse_entry(line)
        if p:
            entries.append({"line": i, "title": p[0], "artist": p[1], "raw": line.strip()})

    files = []
    for f in DOWNLOADS.rglob("*"):
        if f.suffix.lower() in {".mp3", ".flac", ".m4a", ".wav"}:
            t, a = split_file(f.name)
            files.append({"title": t, "artist": a, "name": f.name})

    # --- 歌单内重复 ---
    exact = defaultdict(list)
    for e in entries:
        exact[e["raw"]].append(e["line"])
    exact_dups = {k: v for k, v in exact.items() if len(v) > 1}

    pair_groups = defaultdict(list)
    for e in entries:
        pair_groups[pair_key(e["title"], e["artist"])].append(e)

    dup_groups = []
    for pk, group in pair_groups.items():
        if len(group) > 1:
            dup_groups.append(group)

    unique_songs = len(pair_groups)

    # 检测「列表贴了两次」：前后半段大量重叠
    mid = len(entries) // 2
    first_keys = {pair_key(e["title"], e["artist"]) for e in entries[:mid]}
    second_keys = {pair_key(e["title"], e["artist"]) for e in entries[mid:]}
    overlap = len(first_keys & second_keys)

    # --- 与 downloads 比对 ---
    matched_entries = []
    unmatched_entries = []
    used_files = set()

    for e in entries:
        idx, score = match_song(e["title"], e["artist"], files)
        if idx >= 0 and score >= 0.72:
            matched_entries.append({**e, "file": files[idx]["name"], "score": round(score, 3)})
            used_files.add(idx)
        else:
            hint = files[idx]["name"] if idx >= 0 else ""
            unmatched_entries.append({**e, "hint": hint, "score": round(score, 3)})

    unmatched_files = [files[i] for i in range(len(files)) if i not in used_files]

    report = {
        "summary": {
            "playlist_raw_lines": len(lines),
            "playlist_entries": len(entries),
            "playlist_unique_by_song": unique_songs,
            "playlist_duplicate_groups": len(dup_groups),
            "playlist_extra_entries_vs_unique": len(entries) - unique_songs,
            "downloads_audio_files": len(files),
            "playlist_matched_to_downloads": len(matched_entries),
            "playlist_unmatched": len(unmatched_entries),
            "downloads_not_in_playlist": len(unmatched_files),
            "first_half_vs_second_half_overlap_keys": overlap,
            "first_half_unique_keys": len(first_keys),
            "second_half_unique_keys": len(second_keys),
        },
        "exact_line_duplicates": [
            {"text": k, "lines": v} for k, v in sorted(exact_dups.items(), key=lambda x: -len(x[1]))
        ],
        "duplicate_song_groups_sample": [
            [{"line": e["line"], "raw": e["raw"]} for e in g]
            for g in sorted(dup_groups, key=lambda x: -len(x))[:30]
        ],
        "unmatched_playlist_sample": unmatched_entries[:40],
        "unmatched_downloads_sample": [f["name"] for f in unmatched_files[:40]],
    }

    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    s = report["summary"]
    print("SUMMARY")
    for k, v in s.items():
        print(f"{k}: {v}")
    print(f"\nWrote {OUT}")


if __name__ == "__main__":
    main()
