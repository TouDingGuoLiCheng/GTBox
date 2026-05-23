#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import re
import shutil
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from extract_playlist import (
    OcrBox,
    Row,
    build_ocr,
    clean_artist_name,
    clean_song_title,
    cluster_rows,
    filter_layout_boxes,
    filter_layout_rows,
    has_meaningful_name,
    load_yaml,
    normalize_key,
    normalize_text,
    pair_rows_scored,
    parse_ocr_boxes,
    apply_status_bar_crop,
    read_image_unicode,
    run_ocr,
    is_noise_like_text,
    should_drop_text,
    strip_parentheses,
    strip_ui_noise,
    render_playlist_debug_image,
    write_image_unicode,
)


@dataclass
class Track:
    image_name: str
    song: str
    artist: str
    score: float


@dataclass
class DetectReview:
    image_name: str
    reason: str
    text: str


def crop_pair(image, pair: tuple[Row, Row], image_w: int, image_h: int, cfg: dict):
    top, bot = pair
    left_ratio = float(cfg.get("detect_crop_left_ratio", 0.16))
    right_ratio = float(cfg.get("detect_crop_right_ratio", 0.80))
    left_expand = float(cfg.get("detect_crop_left_expand_ratio", 0.02))
    right_expand = float(cfg.get("detect_crop_right_expand_ratio", 0.01))
    pad_top = float(cfg.get("detect_crop_pad_top_ratio", 0.010))
    pad_bottom = float(cfg.get("detect_crop_pad_bottom_ratio", 0.004))
    pad_top_h_factor = float(cfg.get("detect_crop_pad_top_h_factor", 0.18))
    pad_bottom_h_factor = float(cfg.get("detect_crop_pad_bottom_h_factor", 0.10))

    # 改为“条目自适应横向裁剪”：优先用当前歌名/歌手框范围，避免固定比例截断左侧文字。
    text_x1 = min(top.x1, bot.x1) - image_w * left_expand
    text_x2 = max(top.x2, bot.x2) + image_w * right_expand
    # 同时限制在安全窗口，避免把左侧序号和右侧按钮大量带入。
    safe_x1 = image_w * left_ratio
    safe_x2 = image_w * right_ratio

    # 左边优先保留文本开头，避免截掉首字（再靠清洗去掉序号）
    x1 = max(0, int(min(text_x1, safe_x1)))
    x2 = min(image_w, int(min(text_x2, safe_x2)))
    crop_pad_scale = float(cfg.get("detect_crop_pad_scale", 0.65))
    pad_top_px = min(image_h * pad_top, top.h * pad_top_h_factor * crop_pad_scale)
    pad_bottom_px = min(image_h * pad_bottom, bot.h * pad_bottom_h_factor * crop_pad_scale)
    y1 = max(0, int(min(top.y1, bot.y1) - pad_top_px))
    y2 = min(image_h, int(max(top.y2, bot.y2) + pad_bottom_px))
    if x2 <= x1 or y2 <= y1:
        return None
    return image[y1:y2, x1:x2], (x1, y1, x2, y2)


def track_from_pass1_texts(
    song_text: str,
    artist_text: str,
    cfg: dict,
    image_name: str,
    reason: str,
) -> tuple[Track | None, str | None]:
    """Pass1 整图已配对的上下两行文本；Pass2 失败时优先信任此处。"""
    if should_drop_text(song_text, cfg) or should_drop_text(artist_text, cfg):
        return None, f"{reason}_pair_noise"

    song = clean_song_title(song_text, cfg)
    artist = clean_artist_name(artist_text, cfg)
    if has_meaningful_name(song) and has_meaningful_name(artist):
        return Track(image_name=image_name, song=song, artist=artist, score=0.58), f"{reason}_fallback"

    song_loose = normalize_text(strip_ui_noise(song_text))
    if cfg.get("strip_parentheses", True):
        stripped = strip_parentheses(song_loose)
        if stripped:
            song_loose = stripped
    artist_loose = clean_artist_name(artist_text, cfg)
    if (
        song_loose
        and artist_loose
        and not is_noise_like_text(song_loose)
        and not is_noise_like_text(artist_loose)
        and re.search(r"[\u4e00-\u9fffA-Za-z\u3040-\u30ff]", song_loose)
        and re.search(r"[\u4e00-\u9fffA-Za-z\u3040-\u30ff]", artist_loose)
    ):
        return (
            Track(image_name=image_name, song=song_loose, artist=artist_loose, score=0.52),
            f"{reason}_pass1_relaxed",
        )
    return None, f"{reason}_not_meaningful"


def track_status_label(reason: str | None) -> str:
    if not reason:
        return "OK"
    if reason.endswith("_pass1_relaxed"):
        return "OK_PASS1"
    if reason.endswith("_fallback"):
        return "OK_FB"
    return "OK"


def extract_track_from_crop(
    ocr,
    crop_img,
    cfg: dict,
    image_name: str,
    fallback_song_text: str,
    fallback_artist_text: str,
) -> tuple[Track | None, str | None]:
    def fallback_track(reason: str) -> tuple[Track | None, str | None]:
        return track_from_pass1_texts(
            fallback_song_text, fallback_artist_text, cfg, image_name, reason
        )

    raw = run_ocr(ocr, crop_img, Path(image_name))
    boxes = parse_ocr_boxes(raw, float(cfg.get("min_ocr_score", 0.55)))
    rows = cluster_rows(boxes, image_h=crop_img.shape[0], cfg=cfg)
    rows = sorted(rows, key=lambda r: r.cy)

    candidates: list[Row] = []
    for r in rows:
        if should_drop_text(r.text, cfg):
            continue
        if r.x1 > crop_img.shape[1] * 0.82:
            # 过滤右侧按钮/计数区域识别出的伪行
            continue
        candidates.append(r)
    if len(candidates) < 2:
        return fallback_track("crop_rows_lt2")

    # 小图内按纵向顺序：上行歌名、下行歌手（与 Pass1 配对一致，不再用字高判断）
    song = clean_song_title(candidates[0].text, cfg)
    artist = clean_artist_name(candidates[1].text, cfg)
    if not has_meaningful_name(song) or not has_meaningful_name(artist):
        return fallback_track("crop_text_not_meaningful")

    score = (candidates[0].score + candidates[1].score) / 2.0
    return Track(image_name=image_name, song=song, artist=artist, score=score), None


def dedupe_tracks(tracks: list[Track]) -> list[Track]:
    best: dict[str, Track] = {}
    for t in tracks:
        key = f"{normalize_key(t.song)}|{normalize_key(t.artist)}"
        old = best.get(key)
        if old is None or t.score > old.score:
            best[key] = t
    return list(best.values())


def read_existing(output_path: Path) -> list[str]:
    if not output_path.exists():
        return []
    lines = output_path.read_text(encoding="utf-8", errors="ignore").splitlines()
    return [normalize_text(x) for x in lines if normalize_text(x)]


def write_songs(output_path: Path, tracks: list[Track], merge: str, dedupe: bool) -> list[str]:
    new_lines = [f"{t.song}-{t.artist}" for t in tracks]
    all_lines = read_existing(output_path) + new_lines if merge == "append" else new_lines
    if dedupe:
        seen: set[str] = set()
        final: list[str] = []
        for line in all_lines:
            if "-" not in line:
                continue
            s, a = line.split("-", 1)
            key = f"{normalize_key(s)}|{normalize_key(a)}"
            if key in seen:
                continue
            seen.add(key)
            final.append(f"{normalize_text(s)}-{normalize_text(a)}")
    else:
        final = [x for x in all_lines if "-" in x]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(final) + ("\n" if final else ""), encoding="utf-8")
    return final


def write_review(path: Path, items: list[DetectReview]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    grouped: dict[str, list[DetectReview]] = {}
    for item in items:
        grouped.setdefault(item.image_name, []).append(item)
    lines: list[str] = []
    for image_name in sorted(grouped):
        lines.append(f"# 来源文件: {image_name}")
        for item in grouped[image_name]:
            lines.append(f"[{item.reason}] {item.text}")
        lines.append("")
    path.write_text("\n".join(lines).strip() + ("\n" if lines else ""), encoding="utf-8")


def write_pred_csv(path: Path, tracks: list[Track]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["image_name", "song", "artist", "score", "pair"])
        for t in tracks:
            w.writerow([t.image_name, t.song, t.artist, f"{t.score:.4f}", f"{t.song}-{t.artist}"])


def get_images(input_dir: Path) -> list[Path]:
    exts = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
    return sorted([p for p in input_dir.iterdir() if p.is_file() and p.suffix.lower() in exts])


def clean_outputs(
    base: Path,
    review_path: Path,
    pred_path: Path,
    crops_dir: Path,
    fail_crops_dir: Path,
) -> None:
    # 清理本次流程相关输出
    for p in [review_path, pred_path, base / "songs_review.txt", base / "predictions.csv"]:
        if p.exists():
            p.unlink()
    for d in (crops_dir, fail_crops_dir):
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)


def draw_detect_debug(
    image: np.ndarray,
    image_path: Path,
    rows: list[Row],
    pairs: list[tuple[Row, Row]],
    unpaired: list[tuple[str, Row]],
    crop_boxes: list[tuple[int, tuple[int, int, int, int] | None]],
    debug_dir: Path,
    track_count: int = 0,
) -> None:
    """输出框选预览：灰=全部行，绿=歌名，青=歌手，黄=切条区域，橙=未配对。"""
    vis = render_playlist_debug_image(
        image, rows, pairs, unpaired, track_count, crop_boxes=crop_boxes
    )
    debug_dir.mkdir(parents=True, exist_ok=True)
    write_image_unicode(debug_dir / image_path.name, vis)


def save_crop_image(root: Path, image_stem: str, row_idx: int, crop_img, suffix: str = "") -> Path:
    per_image = root / image_stem
    per_image.mkdir(parents=True, exist_ok=True)
    name = f"row_{row_idx:03d}{suffix}.png"
    out = per_image / name
    write_image_unicode(out, crop_img)
    return out


def run(args: argparse.Namespace) -> int:
    base = Path(__file__).resolve().parent
    cfg = load_yaml(Path(args.config) if args.config else (base / "qq_music_layout.yaml"))
    input_dir = Path(args.input) if args.input else (base / "images_in")
    output_path = Path(args.output) if args.output else (base.parent / "songs.txt")
    review_path = Path(args.review) if args.review else (base / "songs_review_detect.txt")
    pred_path = Path(args.pred_csv) if args.pred_csv else (base / "predictions_detect.csv")
    crops_dir = Path(args.crops_dir) if args.crops_dir else (base / "row_crops")
    fail_crops_dir = Path(args.fail_crops_dir) if args.fail_crops_dir else (base / "row_crops_fail")
    debug_dir = Path(args.debug_dir) if args.debug_dir else (base / "images_debug")
    if args.clean:
        clean_outputs(base, review_path, pred_path, crops_dir, fail_crops_dir)

    images = get_images(input_dir)
    if not images:
        print(f"未找到截图: {input_dir}")
        return 1

    ocr = build_ocr(device=args.device)
    tracks: list[Track] = []
    reviews: list[DetectReview] = []

    for image_path in images:
        img = read_image_unicode(image_path)
        if img is None:
            continue
        img = apply_status_bar_crop(img, cfg)
        h, w = img.shape[:2]

        # pass1: detect/recognize full image only for locating row pairs
        raw = run_ocr(ocr, img, image_path)
        pass1_min_score = float(cfg.get("detect_min_ocr_score", cfg.get("min_ocr_score", 0.55)))
        boxes = filter_layout_boxes(parse_ocr_boxes(raw, pass1_min_score), w, cfg)
        rows = filter_layout_rows(cluster_rows(boxes, image_h=h, cfg=cfg), w, cfg)
        pairs, unpaired, unpaired_notes = pair_rows_scored(rows, image_w=w, image_h=h, cfg=cfg)
        for reason, row in unpaired:
            diag = unpaired_notes.get(id(row), "")
            text = row.text + (f" # {diag}" if diag else "")
            reviews.append(DetectReview(image_path.name, reason, text))
        crop_boxes: list[tuple[int, tuple[int, int, int, int] | None]] = []
        if not pairs:
            reviews.append(DetectReview(image_path.name, "no_row_pairs", image_path.name))
            if args.debug:
                draw_detect_debug(
                    img, image_path, rows, pairs, unpaired, crop_boxes, debug_dir, track_count=0
                )
            print(
                f"[{image_path.name}] OCR行:{len(rows)} 配对:0 未配对:{len(unpaired)} "
                f"识别:0 首, review:{len(unpaired)+1} 条"
            )
            continue

        found = 0
        rcount = 0
        for idx, pair in enumerate(pairs, start=1):
            cropped = crop_pair(img, pair, image_w=w, image_h=h, cfg=cfg)
            crop_boxes.append((idx, cropped[1] if cropped is not None else None))
            if cropped is None:
                track, reason = track_from_pass1_texts(
                    pair[0].text, pair[1].text, cfg, image_path.name, "crop_invalid"
                )
                if track is not None:
                    found += 1
                    tracks.append(track)
                    print(
                        f"  - [row_{idx:03d}] {track_status_label(reason)} "
                        f"{track.song}-{track.artist}"
                    )
                else:
                    rcount += 1
                    reviews.append(DetectReview(image_path.name, reason or "crop_invalid", f"pair_{idx:02d}"))
                    print(f"  - [row_{idx:03d}] FAIL {reason or 'crop_invalid'}")
                continue
            crop_img, _ = cropped
            track, reason = extract_track_from_crop(
                ocr,
                crop_img,
                cfg,
                image_path.name,
                fallback_song_text=pair[0].text,
                fallback_artist_text=pair[1].text,
            )
            if track is None:
                rcount += 1
                fail_reason = reason or "crop_extract_failed"
                reviews.append(DetectReview(image_path.name, fail_reason, f"row_{idx:03d}"))
                save_crop_image(fail_crops_dir, image_path.stem, idx, crop_img, suffix=f"_{fail_reason}")
                print(f"  - [row_{idx:03d}] FAIL {fail_reason}")
            else:
                if args.save_crops:
                    save_crop_image(crops_dir, image_path.stem, idx, crop_img)
                found += 1
                tracks.append(track)
                print(
                    f"  - [row_{idx:03d}] {track_status_label(reason)} "
                    f"{track.song}-{track.artist}"
                )

        if args.debug:
            draw_detect_debug(
                img, image_path, rows, pairs, unpaired, crop_boxes, debug_dir, track_count=found
            )
        print(
            f"[{image_path.name}] OCR行:{len(rows)} 配对:{len(pairs)} "
            f"未配对:{len(unpaired)} 识别:{found} 首, FAIL:{rcount}"
        )

    if args.debug:
        print(f"框选预览已写入: {debug_dir}")

    eval_tracks = list(tracks)
    if args.dedupe:
        tracks = dedupe_tracks(tracks)

    if args.dry_run:
        print("\n=== dry-run 输出 ===")
        for t in tracks:
            print(f"{t.song}-{t.artist}")
    else:
        lines = write_songs(output_path, tracks, merge=args.merge, dedupe=args.dedupe)
        print(f"\nsongs.txt 已写入: {output_path} ({len(lines)} 行)")

    write_review(review_path, reviews)
    write_pred_csv(pred_path, eval_tracks)
    print(f"review 已写入: {review_path} ({len(reviews)} 条)")
    print(f"预测明细已写入: {pred_path} ({len(eval_tracks)} 行)")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="自动检测歌曲条目后再识别（两阶段）")
    parser.add_argument("--input", default=None, help="截图目录，默认 playlist_ocr/images_in")
    parser.add_argument("--output", default=None, help="songs.txt 输出路径，默认 ../songs.txt")
    parser.add_argument("--review", default=None, help="review 输出路径，默认 songs_review_detect.txt")
    parser.add_argument("--pred-csv", default=None, help="预测 CSV 输出，默认 predictions_detect.csv")
    parser.add_argument("--config", default=None, help="yaml 配置路径")
    parser.add_argument("--device", default="auto", help="auto/cpu/gpu/gpu:0")
    parser.add_argument("--dry-run", action="store_true", help="仅打印结果，不写 songs.txt")
    parser.add_argument("--merge", choices=["append", "overwrite"], default="append")
    parser.add_argument("--dedupe", action="store_true", default=True)
    parser.add_argument("--save-crops", action="store_true", help="保存识别成功的条目小图到 row_crops")
    parser.add_argument("--crops-dir", default=None, help="成功条目小图目录，默认 row_crops")
    parser.add_argument("--fail-crops-dir", default=None, help="FAIL 条目小图目录，默认 row_crops_fail")
    parser.add_argument("--debug", action="store_true", help="输出框选预览图到 images_debug/")
    parser.add_argument("--debug-dir", default=None, help="预览图目录，默认 images_debug")
    parser.add_argument(
        "--clean",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="运行前清理 row_crops、row_crops_fail、旧 review/pred（默认开启）",
    )
    return parser


def main() -> int:
    return run(build_parser().parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
