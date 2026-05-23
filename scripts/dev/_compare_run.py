# -*- coding: utf-8 -*-
import re
from pathlib import Path
from collections import defaultdict
from difflib import SequenceMatcher

PLAYLIST = Path(r"d:\VS\工具箱开发\_playlist_user.txt")
DOWNLOADS = Path(r"D:\Pycharm\爬虫\爬取音乐\downloads")
OUT = Path(r"d:\VS\工具箱开发\_compare_report.txt")
SKIP = re.compile(r"我的收藏|歌单|专辑|→|←", re.I)


def norm(s: str) -> str:
    s = (s or "").lower().strip()
    s = re.sub(r"\.(mp3|flac|m4a|wav)$", "", s, flags=re.I)
    s = re.sub(r"[_\-\s\.…\+]+", "", s)
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
    stem = re.sub(r"\(\d+\)$", "", stem)
    if " - " in stem:
        x, y = stem.split(" - ", 1)
        return x.strip(), y.strip()
    if "-" in stem:
        x, y = stem.rsplit("-", 1)
        return x.strip(), y.strip()
    return stem, ""


def pair_key(title, artist):
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
    for i, f in enumerate(files):
        ft, fa = f["title"], f["artist"]
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

    pair_groups = defaultdict(list)
    for e in entries:
        pair_groups[pair_key(e["title"], e["artist"])].append(e)
    dup_groups = [g for g in pair_groups.values() if len(g) > 1]

    idx_split = next((i for i, l in enumerate(lines) if "← 我的收藏" in l), None)

    seen = set()
    unique = []
    for e in entries:
        pk = pair_key(e["title"], e["artist"])
        if pk not in seen:
            seen.add(pk)
            unique.append(e)

    used = set()
    unmatched_u = []
    for e in unique:
        fi, score = match_song(e["title"], e["artist"], files)
        if fi >= 0 and score >= 0.72:
            used.add(fi)
        else:
            unmatched_u.append({**e, "hint": files[fi]["name"] if fi >= 0 else "", "score": score})

    unmatched_files = [files[i] for i in range(len(files)) if i not in used]

    dup_pairs = []
    for i in range(len(files)):
        for j in range(i + 1, len(files)):
            s = max(
                sim(files[i]["title"], files[j]["title"]) * 0.5
                + sim(files[i]["artist"], files[j]["artist"]) * 0.5,
                sim(files[i]["title"], files[j]["artist"]) * 0.5
                + sim(files[i]["artist"], files[j]["title"]) * 0.5,
            )
            if s >= 0.92:
                dup_pairs.append((s, files[i]["name"], files[j]["name"]))

    lines_out = []
    w = lines_out.append
    w("=" * 60)
    w("歌单文本统计")
    w("=" * 60)
    w(f"非空总行数: {len(lines)}")
    w(f"有效歌曲行: {len(entries)}")
    w(f"去重后唯一曲目: {len(pair_groups)}")
    w(f"歌单内重复组(曲名+歌手近似): {len(dup_groups)}")
    w(f"多出来的重复行: {len(entries) - len(pair_groups)}")
    if idx_split is not None:
        w(f"")
        w(f"结构: 第1段(到「← 我的收藏」) + 第2段(门歌单等)")
        b1 = [parse_entry(l) for l in lines[:idx_split] if parse_entry(l)]
        b2 = [parse_entry(l) for l in lines[idx_split + 1 :] if parse_entry(l)]
        k1 = {pair_key(*p) for p in b1}
        k2 = {pair_key(*p) for p in b2}
        w(f"  第1段: {len(b1)} 行, 唯一 {len(k1)}")
        w(f"  第2段: {len(b2)} 行, 唯一 {len(k2)}")
        w(f"  两段重复: {len(k1 & k2)} 首")
    w("")
    w("=" * 60)
    w("downloads 文件夹")
    w("=" * 60)
    w(f"音频文件: {len(files)}")
    w(f"疑似同一首歌多文件(相似>=0.92): {len(dup_pairs)} 对")
    w("")
    w("=" * 60)
    w("歌单(去重) vs downloads")
    w("=" * 60)
    w(f"去重歌单已匹配: {len(unique) - len(unmatched_u)} / {len(unique)}")
    w(f"去重歌单未找到文件: {len(unmatched_u)}")
    w(f"文件夹有但歌单无: {len(unmatched_files)}")
    w("")
    w("--- 歌单内重复(全部) ---")
    for g in sorted(dup_groups, key=lambda x: -len(x)):
        w("  | ".join(e["raw"] for e in g))
    w("")
    w("--- 歌单有、downloads 无 ---")
    for e in unmatched_u:
        hint = e["hint"][:60] if e["hint"] else "无"
        w(f"  {e['raw']}  [{e['score']:.2f}] 候选:{hint}")
    w("")
    w("--- downloads 有、歌单(去重)无 ---")
    for f in unmatched_files:
        w(f"  {f['name']}")
    w("")
    w("--- downloads 内疑似重复文件 ---")
    for s, a, b in sorted(dup_pairs, reverse=True):
        w(f"  [{s:.2f}]")
        w(f"    {a}")
        w(f"    {b}")

    OUT.write_text("\n".join(lines_out), encoding="utf-8")
    print(f"Wrote {OUT} ({len(lines_out)} lines)")


if __name__ == "__main__":
    main()
