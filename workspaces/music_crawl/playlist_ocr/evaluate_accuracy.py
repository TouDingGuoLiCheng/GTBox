#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import re
from collections import Counter, defaultdict
from pathlib import Path


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").replace("\u3000", " ")).strip()


def normalize_key(text: str) -> str:
    normalized = normalize_text(text).lower()
    normalized = normalized.replace("－", "-").replace("—", "-").replace("–", "-")
    return re.sub(r"\s+", "", normalized)


def pair_key(song: str, artist: str) -> str:
    return f"{normalize_key(song)}|{normalize_key(artist)}"


def load_rows(csv_path: Path, image_col: str, song_col: str, artist_col: str) -> list[tuple[str, str, str]]:
    rows: list[tuple[str, str, str]] = []
    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        missing = [c for c in (image_col, song_col, artist_col) if c not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(f"{csv_path} 缺少列: {missing}")
        for row in reader:
            image_name = normalize_text(row.get(image_col, ""))
            song = normalize_text(row.get(song_col, ""))
            artist = normalize_text(row.get(artist_col, ""))
            if not image_name or not song or not artist:
                continue
            rows.append((image_name, song, artist))
    return rows


def to_image_counter(rows: list[tuple[str, str, str]]) -> dict[str, Counter[str]]:
    by_image: dict[str, Counter[str]] = defaultdict(Counter)
    for image_name, song, artist in rows:
        by_image[image_name][pair_key(song, artist)] += 1
    return dict(by_image)


def evaluate(gt: dict[str, Counter[str]], pred: dict[str, Counter[str]]) -> tuple[dict[str, float], list[str]]:
    all_images = sorted(set(gt) | set(pred))
    tp = 0
    gt_total = 0
    pred_total = 0
    exact_images = 0
    lines: list[str] = []

    for image_name in all_images:
        g = gt.get(image_name, Counter())
        p = pred.get(image_name, Counter())
        gt_total += sum(g.values())
        pred_total += sum(p.values())
        tp += sum(min(g[k], p[k]) for k in set(g) | set(p))
        if g == p:
            exact_images += 1
            continue

        lines.append(f"## {image_name}")
        missing = g - p
        extra = p - g
        if missing:
            lines.append("- 缺失:")
            for item, cnt in missing.items():
                lines.append(f"  - `{item}` x{cnt}")
        if extra:
            lines.append("- 多识别:")
            for item, cnt in extra.items():
                lines.append(f"  - `{item}` x{cnt}")
        lines.append("")

    precision = tp / pred_total if pred_total else 0.0
    recall = tp / gt_total if gt_total else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
    image_exact_acc = exact_images / len(all_images) if all_images else 0.0

    metrics = {
        "gt_total": float(gt_total),
        "pred_total": float(pred_total),
        "tp": float(tp),
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "image_exact_acc": image_exact_acc,
    }
    return metrics, lines


def write_report(report_path: Path, metrics: dict[str, float], details: list[str]) -> None:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    content = [
        "# OCR 准确率评估报告",
        "",
        "## 指标",
        f"- GT 总条目: {int(metrics['gt_total'])}",
        f"- 预测总条目: {int(metrics['pred_total'])}",
        f"- 命中条目(TP): {int(metrics['tp'])}",
        f"- Precision: {metrics['precision']:.4f}",
        f"- Recall: {metrics['recall']:.4f}",
        f"- F1: {metrics['f1']:.4f}",
        f"- 图片级完全匹配率: {metrics['image_exact_acc']:.4f}",
        "",
        "## 差异明细（按图片）",
        "",
    ]
    if details:
        content.extend(details)
    else:
        content.append("全部图片完全匹配。")
    report_path.write_text("\n".join(content).strip() + "\n", encoding="utf-8")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="评估 OCR 识别结果与标注真值的匹配度")
    parser.add_argument("--gt", default="ground_truth.csv", help="真值 CSV 路径（默认 ground_truth.csv）")
    parser.add_argument("--pred", default="predictions.csv", help="预测 CSV 路径（默认 predictions.csv）")
    parser.add_argument("--report", default="evaluate_report.md", help="评估报告输出路径")
    parser.add_argument("--gt-image-col", default="image_name", help="真值图片列名")
    parser.add_argument("--gt-song-col", default="song", help="真值歌名列名")
    parser.add_argument("--gt-artist-col", default="artist", help="真值歌手列名")
    parser.add_argument("--pred-image-col", default="image_name", help="预测图片列名")
    parser.add_argument("--pred-song-col", default="song", help="预测歌名列名")
    parser.add_argument("--pred-artist-col", default="artist", help="预测歌手列名")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    gt_path = Path(args.gt)
    pred_path = Path(args.pred)
    report_path = Path(args.report)

    if not gt_path.exists():
        print(f"未找到真值文件: {gt_path}")
        return 1
    if not pred_path.exists():
        print(f"未找到预测文件: {pred_path}")
        return 1

    gt_rows = load_rows(gt_path, args.gt_image_col, args.gt_song_col, args.gt_artist_col)
    pred_rows = load_rows(pred_path, args.pred_image_col, args.pred_song_col, args.pred_artist_col)

    metrics, details = evaluate(to_image_counter(gt_rows), to_image_counter(pred_rows))
    write_report(report_path, metrics, details)
    print(
        f"评估完成: Precision={metrics['precision']:.4f}, "
        f"Recall={metrics['recall']:.4f}, F1={metrics['f1']:.4f}, "
        f"图片级完全匹配率={metrics['image_exact_acc']:.4f}"
    )
    print(f"报告已写入: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
