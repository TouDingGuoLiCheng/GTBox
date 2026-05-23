#!/usr/bin/env python3
from __future__ import annotations

import argparse
import contextlib
import importlib.util
import inspect
import json
import sys
from pathlib import Path
from typing import Any

import cv2
import numpy as np


def emit_json(payload: Any) -> None:
    """Write UTF-8 JSON to stdout (Windows console default encoding is GBK)."""
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.write(b"\n")
    sys.stdout.buffer.flush()


_EXTRACT_MODULE_NAME = "toolbox_extract_playlist"


def load_extract_playlist(workspace_root: str) -> Any:
    cached = sys.modules.get(_EXTRACT_MODULE_NAME)
    if cached is not None:
        return cached

    module_path = Path(workspace_root) / "playlist_ocr" / "extract_playlist.py"
    if not module_path.exists():
        raise SystemExit(
            f"未找到 extract_playlist.py: {module_path}。"
            "请在设置中将工作区指向本仓库的 workspaces/music_crawl 目录（含 playlist_ocr/）。"
        )

    playlist_dir = str(module_path.parent)
    if playlist_dir not in sys.path:
        sys.path.insert(0, playlist_dir)

    spec = importlib.util.spec_from_file_location(_EXTRACT_MODULE_NAME, module_path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"无法加载模块: {module_path}")
    mod = importlib.util.module_from_spec(spec)
    # 必须先注册到 sys.modules，否则 @dataclass 在 exec_module 时会找不到模块命名空间
    sys.modules[_EXTRACT_MODULE_NAME] = mod
    spec.loader.exec_module(mod)
    return mod


def status_bar_crop_y_offset(image_h: int, cfg: dict[str, Any]) -> int:
    crop_cfg = cfg.get("status_bar_crop") or {}
    if not crop_cfg.get("enable"):
        return 0
    top_ratio = float(crop_cfg.get("top_ratio", 0.055))
    y = int(image_h * top_ratio)
    if y <= 0 or y >= image_h - 20:
        return 0
    return y


def row_bbox(
    row: Any,
    role: str,
    pair_index: int | None = None,
    note: str | None = None,
    y_offset: float = 0,
) -> dict[str, Any]:
    item: dict[str, Any] = {
        "x": float(row.x1),
        "y": float(row.y1) + y_offset,
        "w": max(1.0, float(row.x2) - float(row.x1)),
        "h": max(1.0, float(row.y2) - float(row.y1)),
        "text": str(row.text).strip(),
        "score": float(row.score),
        "role": role,
    }
    if pair_index is not None:
        item["pairIndex"] = pair_index
    if note:
        item["note"] = note
    return item


def normalize_device(device: str) -> str:
    """与 extract_playlist CLI 一致，支持 auto / cpu / gpu / gpu:0。"""
    value = (device or "auto").strip()
    if not value:
        return "auto"
    return value


def _pair_rows(
    ep: Any, rows: list[Any], image_w: int, image_h: int, cfg: dict[str, Any]
) -> tuple[list[tuple[Any, Any]], list[tuple[str, Any]]]:
    """兼容不同版本的 extract_playlist（有无 trace_lines 参数）。"""
    if hasattr(ep, "extract_tracks_from_rows"):
        fn = ep.extract_tracks_from_rows
        kwargs: dict[str, Any] = {
            "rows": rows,
            "image_w": image_w,
            "image_h": image_h,
            "cfg": cfg,
            "image_name": "_ui_preview.png",
        }
        if "trace_lines" in inspect.signature(fn).parameters:
            kwargs["trace_lines"] = None
        _tracks, _reviews, pairs, unpaired = fn(**kwargs)
        return pairs, unpaired

    fn = ep.pair_rows_scored
    params = inspect.signature(fn).parameters
    if "trace_lines" in params:
        pairs, unpaired, _notes = fn(rows, image_w, image_h, cfg, trace_lines=None)
    else:
        pairs, unpaired, _notes = fn(rows, image_w, image_h, cfg)
    return pairs, unpaired


def run_detect_playlist(ocr: Any, image: np.ndarray, workspace_root: str) -> list[dict[str, Any]]:
    """与 extract_playlist --debug 一致：仅输出配对行（绿/橙）与未配对行（蓝）。"""
    ep = load_extract_playlist(workspace_root)
    cfg_path = Path(workspace_root) / "playlist_ocr" / "qq_music_layout.yaml"
    if not cfg_path.exists():
        raise SystemExit(f"未找到布局配置: {cfg_path}")

    cfg = ep.load_yaml(cfg_path)
    y_offset = float(status_bar_crop_y_offset(image.shape[0], cfg))
    img = ep.apply_status_bar_crop(image.copy(), cfg)
    image_h, image_w = img.shape[:2]
    dummy_path = Path(workspace_root) / "playlist_ocr" / "_ui_preview.png"

    raw = ep.run_ocr(ocr, img, dummy_path)
    boxes = ep.filter_layout_boxes(
        ep.parse_ocr_boxes(raw, float(cfg.get("min_ocr_score", 0.55))),
        image_w,
        cfg,
    )
    rows = ep.filter_layout_rows(ep.cluster_rows(boxes, image_h=image_h, cfg=cfg), image_w, cfg)
    pairs, unpaired = _pair_rows(ep, rows, image_w, image_h, cfg)

    out: list[dict[str, Any]] = []
    for idx, (top, bot) in enumerate(pairs, start=1):
        out.append(row_bbox(top, "title", pair_index=idx, y_offset=y_offset))
        out.append(row_bbox(bot, "artist", pair_index=idx, y_offset=y_offset))
    for reason, row in unpaired:
        out.append(row_bbox(row, "unpaired", note=str(reason)[:32], y_offset=y_offset))
    return out


def run_recognize_regions(
    ocr: Any, image: np.ndarray, boxes: list[dict[str, Any]], workspace_root: str
) -> list[dict[str, Any]]:
    ep = load_extract_playlist(workspace_root)
    h, w = image.shape[:2]
    results: list[dict[str, Any]] = []
    for i, box in enumerate(boxes):
        x = int(float(box.get("x", 0)))
        y = int(float(box.get("y", 0)))
        bw = int(float(box.get("w", 0)))
        bh = int(float(box.get("h", 0)))
        x1 = max(0, min(w - 1, x))
        y1 = max(0, min(h - 1, y))
        x2 = max(x1 + 1, min(w, x1 + max(1, bw)))
        y2 = max(y1 + 1, min(h, y1 + max(1, bh)))
        crop = image[y1:y2, x1:x2]

        text = str(box.get("text", "")).strip()
        score = float(box.get("score", 0.0))
        if crop.size > 0:
            if hasattr(ocr, "predict"):
                raw = ocr.predict(crop)
            else:
                raw = ocr.ocr(crop, cls=True)
            parsed = ep.parse_ocr_boxes(raw, min_score=0.0)
            if parsed:
                best = max(parsed, key=lambda b: float(b.score))
                text = str(best.text).strip()
                score = float(best.score)

        results.append({"index": i, "text": text, "score": score})
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description="Region OCR helper")
    parser.add_argument("--mode", choices=["detect", "recognize"], required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--workspace-root", default="")
    parser.add_argument("--boxes-json", default="[]")
    parser.add_argument("--device", default="auto")
    args = parser.parse_args()

    image_path = Path(args.image)
    data = np.fromfile(str(image_path), dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if image is None:
        raise SystemExit("failed to read image")

    if args.mode == "detect":
        if not args.workspace_root.strip():
            raise SystemExit("detect 模式需要 --workspace-root")
        ep = load_extract_playlist(args.workspace_root)
        device = normalize_device(args.device)
        print(f"[region_ocr] 使用设备参数: {device}", file=sys.stderr)
        with contextlib.redirect_stdout(sys.stderr):
            ocr = ep.build_ocr(device=device)
            payload = run_detect_playlist(ocr, image, args.workspace_root)
        emit_json(payload)
        return 0

    if not args.workspace_root.strip():
        raise SystemExit("recognize 模式需要 --workspace-root")
    boxes = json.loads(args.boxes_json or "[]")
    ep = load_extract_playlist(args.workspace_root)
    device = normalize_device(args.device)
    print(f"[region_ocr] 使用设备参数: {device}", file=sys.stderr)
    with contextlib.redirect_stdout(sys.stderr):
        ocr = ep.build_ocr(device=device)
        payload = run_recognize_regions(ocr, image, boxes, args.workspace_root)
    emit_json(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
