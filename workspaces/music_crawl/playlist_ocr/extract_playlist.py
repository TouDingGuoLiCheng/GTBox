#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import yaml


SUPPORTED_EXTS = {".png", ".jpg", ".jpeg", ".webp"}


@dataclass
class OcrBox:
    text: str
    score: float
    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def h(self) -> float:
        return max(1.0, self.y2 - self.y1)

    @property
    def cy(self) -> float:
        return (self.y1 + self.y2) / 2.0


@dataclass
class Row:
    text: str
    score: float
    x1: float
    y1: float
    x2: float
    y2: float
    h: float
    cy: float
    raw_boxes: list[OcrBox]


@dataclass
class TrackCandidate:
    song: str
    artist: str
    score: float
    image_name: str


@dataclass
class ReviewItem:
    reason: str
    text: str
    image_name: str
    note: str = ""


def load_yaml(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return data


def preprocess_ocr_line(text: str) -> str:
    """在歌名/歌手判定与配对前，统一清洗 OCR 行文本。"""
    value = re.sub(r"\s+", " ", str(text).replace("\u3000", " ")).strip()
    if not value:
        return ""

    # 循环剥离 UI 尾巴，直到稳定（如「赵寒 VIP 51」→「赵寒」）
    prev = None
    while prev != value:
        prev = value
        # 空格 + VIP + 空格（含 SVIP）
        value = re.sub(r"\s+S?VIP\s+", " ", value, flags=re.IGNORECASE)
        value = re.sub(r"\s+S?VIP\s*$", "", value, flags=re.IGNORECASE)
        # 空格 + Ω + 数字（如「 Ω51」「 Ω 39」）
        value = re.sub(r"\s+Ω\s*[0-9０-９]{0,4}(?=\s|$)", " ", value)
        value = value.replace("Ω", "")
        # 空格 + 纯数字 + 空格/行尾（播放量）
        value = re.sub(r"\s+[0-9０-９]{1,4}(?=\s|$)", " ", value)
        # 黏在名字后的计数：Kosemura52 / milet55
        value = re.sub(
            r"(?<=[A-Za-z\u4e00-\u9fff\u3040-\u30ff])[0-9０-９]{1,4}(?=\s|$)",
            "",
            value,
        )
        value = re.sub(r"\s+", " ", value).strip()

    return value


def normalize_text(text: str) -> str:
    return preprocess_ocr_line(text)


def normalize_key(text: str) -> str:
    normalized = normalize_text(text).lower()
    normalized = normalized.replace("－", "-").replace("—", "-").replace("–", "-")
    return re.sub(r"\s+", "", normalized)


_EDGE_NOISE_CHARS = r"•●·・:：;；,，.。+√~|!！?？"


def strip_ui_noise(text: str) -> str:
    """Strip playlist UI markers/counts while preserving core title/artist text."""
    value = normalize_text(text)
    if not value:
        return ""

    # Remove common UI tokens anywhere in line.
    value = re.sub(r"S?VIP", "", value, flags=re.IGNORECASE)
    value = re.sub(r"相关视频可播", "", value)
    value = re.sub(r"(^|\s)F(\s|$)", " ", value, flags=re.IGNORECASE)
    value = re.sub(r"[•●·・√]", " ", value)
    value = re.sub(r"\s*[:：]\s*[\-–—]?\s*", " ", value)

    # Remove leading numbering and punctuation noise.
    value = re.sub(r"^\d{1,4}\s+", "", value)
    value = re.sub(rf"^[{_EDGE_NOISE_CHARS}\-\–—\s]+", "", value)

    # Remove trailing counters like 125 / 59（Ω 已在 preprocess_ocr_line 去掉）
    value = re.sub(r"\s+[0-9０-９]{1,4}\s*$", "", value)

    # Remove trailing punctuation/symbol clusters.
    value = re.sub(rf"\s*[{_EDGE_NOISE_CHARS}\-\–—]+\s*$", "", value)
    value = re.sub(r"\s*\+\s*$", "", value)
    return normalize_text(value)


def strip_parentheses(text: str) -> str:
    """Remove any bracketed content, including mixed bracket types."""
    value = normalize_text(text)
    if not value:
        return ""
    openers = {"(", "（", "[", "【"}
    closers = {")", "）", "]", "】"}
    depth = 0
    kept: list[str] = []
    for ch in value:
        if ch in openers:
            depth += 1
            continue
        if ch in closers:
            if depth > 0:
                depth -= 1
            continue
        if depth == 0:
            kept.append(ch)
    # depth > 0 代表未闭合括号，末尾内容自动丢弃
    return normalize_text("".join(kept))


def clean_song_title(text: str, cfg: dict[str, Any]) -> str:
    value = strip_ui_noise(preprocess_ocr_line(text))
    if cfg.get("strip_parentheses", True):
        value = strip_parentheses(value)
    value = strip_ui_noise(value)
    return normalize_text(value)


def take_first_artist(text: str, cfg: dict[str, Any]) -> str:
    """多作者时只保留第一位，如 Nor/蔚蓝档案 -> Nor"""
    value = normalize_text(text)
    for sep in cfg.get("artist_multi_separators", ["/", "、", "&"]):
        if sep in value:
            value = value.split(sep, 1)[0]
            break
    return normalize_text(value)


def clean_artist_name(text: str, cfg: dict[str, Any]) -> str:
    value = preprocess_ocr_line(text)
    value = take_first_artist(value, cfg)
    value = split_artist(value, cfg)
    value = strip_ui_noise(value)
    if cfg.get("strip_parentheses", True):
        value = strip_parentheses(value)
    value = strip_ui_noise(value)
    return normalize_text(value)


def is_noise_like_text(text: str) -> bool:
    value = normalize_text(text)
    if not value:
        return True
    # 去掉显然是装饰/计数的符号后，若为空或纯数字，则视为噪声
    stripped = re.sub(r"[•●.:：+\-–—_/\sΩ]", "", value)
    if not stripped:
        return True
    return bool(re.fullmatch(r"\d+", stripped))


def has_meaningful_name(text: str) -> bool:
    value = normalize_text(text)
    if len(value) < 2:
        # 允许「丑」「光」这类单字中文歌名；单字母/符号仍按噪声处理。
        return bool(re.fullmatch(r"[\u4e00-\u9fff]", value))
    # 至少包含一种有意义字符（中日韩统一表意、拉丁字母、日文假名）
    if re.search(r"[\u4e00-\u9fffA-Za-z\u3040-\u30ff]", value):
        # 过滤明显噪声串
        if re.fullmatch(r"[0-9Ω+\-•●.:：\s]+", value):
            return False
        return True
    return False


def is_artist_reading_line(text: str) -> bool:
    """歌手名后跟读音注记（如 水谷広実（みずたにひろみ））。"""
    value = normalize_text(text)
    if not value:
        return False
    stem = re.sub(r"(?:Ω|🎧)?\s*\d{1,4}\s*$", "", value).strip()
    m = re.fullmatch(
        r"([\u4e00-\u9fffA-Za-z\u3040-\u30ff\u30fb·・\s]{1,40})[（(]([\u3040-\u30ffーA-Za-z.\-·・\s]{1,40})[）)]",
        stem,
    )
    if not m:
        return False
    inner = m.group(2)
    return bool(re.search(r"[\u3040-\u30ff]", inner))


def looks_like_title_line(text: str, cfg: dict[str, Any]) -> bool:
    value = normalize_text(text)
    if not value:
        return False
    if re.search(r"[\(\)（）\[\]【】]", value):
        if is_artist_reading_line(value):
            return False
        return True
    lowered = value.lower()
    for hint in cfg.get("title_hint_tokens", ["feat", "ver", "mix", "remix", "piano", "episode"]):
        token = normalize_text(str(hint))
        if token and token.lower() in lowered:
            return True
    # 避免把“歌手/组合名 + 计数”误判成歌名（会造成上一条误配、下一条落单）。
    if re.match(
        r"^[A-Za-z\u4e00-\u9fff\u3040-\u30ff][\w\u4e00-\u9fff\u3040-\u30ff\s./·\-]{0,48}(?:\s+VIP)?\s*(?:Ω|🎧)?\s*\d{1,4}\s*$",
        value,
    ):
        return False
    if len(value) >= 10 and not re.search(r"(?:Ω|🎧)\s*\d{1,4}\s*$", value):
        return True
    return False


def looks_like_artist_line(text: str, cfg: dict[str, Any]) -> bool:
    """副行/metadata：VIP 或 播放量尾巴（且不像歌名）。"""
    value = normalize_text(text)
    if not value or looks_like_title_line(text, cfg):
        return False
    upper = value.upper()
    for token in cfg.get("artist_line_markers", ["VIP", "HQ", "SQ", "MV", "无损"]):
        if token.upper() in upper:
            return True
    if re.search(r"(?:Ω|🎧)?\s*\d{1,4}\s*$", value):
        stem = re.sub(r"(?:Ω|🎧)?\s*\d{1,4}\s*$", "", value).strip()
        # 仅当明显是名字行（较短）时，才把“尾部计数”当成歌手行特征，避免误伤歌名。
        if re.search(r"[\u4e00-\u9fffA-Za-z\u3040-\u30ff]{2,}", stem) and len(stem) <= 18:
            return True
    if re.match(r"^[A-Za-z][A-Za-z0-9._\-·]{0,28}\d{1,4}$", value):
        return True
    return False


def is_likely_artist_row(text: str, cfg: dict[str, Any]) -> bool:
    if looks_like_artist_line(text, cfg):
        return True
    value = normalize_text(text)
    return bool(
        re.match(
            r"^[A-Za-z\u4e00-\u9fff\u3040-\u30ff][\w\u4e00-\u9fff\u3040-\u30ff\s./·]{0,36}\s+\d{1,4}$",
            value,
        )
    )


def get_images(input_dir: Path) -> list[Path]:
    return sorted([p for p in input_dir.iterdir() if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS])


def status_bar_crop_y_offset(image_h: int, cfg: dict[str, Any]) -> float:
    crop_cfg = cfg.get("status_bar_crop") or {}
    if not crop_cfg.get("enable"):
        return 0.0
    top_ratio = float(crop_cfg.get("top_ratio", 0.055))
    y = int(image_h * top_ratio)
    if y <= 0 or y >= image_h - 20:
        return 0.0
    return float(y)


def apply_status_bar_crop(image: np.ndarray, cfg: dict[str, Any]) -> np.ndarray:
    crop_cfg = cfg.get("status_bar_crop", {}) or {}
    if not crop_cfg.get("enable", False):
        return image
    top_ratio = float(crop_cfg.get("top_ratio", 0.04))
    y = int(image.shape[0] * top_ratio)
    if y <= 0 or y >= image.shape[0] - 20:
        return image
    return image[y:, :]


def export_regions_for_ui(
    pairs: list[tuple[Row, Row]],
    unpaired: list[tuple[str, Row]],
    y_offset: float = 0,
) -> list[dict[str, Any]]:
    """导出与 UI detect 一致的 OCR 框 JSON（camelCase 字段）。"""
    out: list[dict[str, Any]] = []
    for idx, (top, bot) in enumerate(pairs, start=1):
        out.append(
            {
                "x": float(top.x1),
                "y": float(top.y1) + y_offset,
                "w": max(1.0, float(top.x2) - float(top.x1)),
                "h": max(1.0, float(top.y2) - float(top.y1)),
                "text": str(top.text).strip(),
                "score": float(top.score),
                "role": "title",
                "pairIndex": idx,
            }
        )
        out.append(
            {
                "x": float(bot.x1),
                "y": float(bot.y1) + y_offset,
                "w": max(1.0, float(bot.x2) - float(bot.x1)),
                "h": max(1.0, float(bot.y2) - float(bot.y1)),
                "text": str(bot.text).strip(),
                "score": float(bot.score),
                "role": "artist",
                "pairIndex": idx,
            }
        )
    for reason, row in unpaired:
        out.append(
            {
                "x": float(row.x1),
                "y": float(row.y1) + y_offset,
                "w": max(1.0, float(row.x2) - float(row.x1)),
                "h": max(1.0, float(row.y2) - float(row.y1)),
                "text": str(row.text).strip(),
                "score": float(row.score),
                "role": "unpaired",
                "note": str(reason)[:32],
            }
        )
    return out


def write_regions_cache(regions_dir: Path, image_name: str, regions: list[dict[str, Any]]) -> None:
    regions_dir.mkdir(parents=True, exist_ok=True)
    out_path = regions_dir / f"{image_name}.regions.json"
    out_path.write_text(json.dumps(regions, ensure_ascii=False), encoding="utf-8")


def clear_regions_cache(regions_dir: Path) -> None:
    """每次批量扫描前清理旧缓存，避免 UI 读取到历史框。"""
    regions_dir.mkdir(parents=True, exist_ok=True)
    for p in regions_dir.glob("*.regions.json"):
        try:
            p.unlink()
        except OSError:
            # 单个文件删除失败不影响主流程，后续会覆盖同名文件
            pass


def read_image_unicode(image_path: Path) -> np.ndarray | None:
    """Read image robustly on Windows paths with non-ASCII chars."""
    try:
        data = np.fromfile(str(image_path), dtype=np.uint8)
        if data.size == 0:
            return None
        return cv2.imdecode(data, cv2.IMREAD_COLOR)
    except OSError:
        return None


def write_image_unicode(image_path: Path, image: np.ndarray) -> bool:
    """Write image robustly on Windows paths with non-ASCII chars."""
    ext = image_path.suffix or ".png"
    ok, encoded = cv2.imencode(ext, image)
    if not ok:
        return False
    encoded.tofile(str(image_path))
    return True


def check_paddle_device(requested: str) -> str:
    """Return effective device string and warn if GPU was requested but unavailable."""
    requested = (requested or "auto").strip().lower()
    if requested == "auto":
        try:
            import paddle

            return "gpu:0" if paddle.is_compiled_with_cuda() and paddle.device.cuda.device_count() > 0 else "cpu"
        except Exception:
            return "cpu"

    if requested.startswith("gpu"):
        try:
            import paddle

            if not paddle.is_compiled_with_cuda():
                print("警告: 当前 paddlepaddle 是 CPU 版，无法使用 GPU。请安装 paddlepaddle-gpu 后重试。")
                return "cpu"
            if paddle.device.cuda.device_count() <= 0:
                print("警告: 未检测到可用 NVIDIA GPU，已回退到 CPU。")
                return "cpu"
        except Exception as exc:
            print(f"警告: GPU 检测失败 ({exc})，已回退到 CPU。")
            return "cpu"
    return requested


def build_ocr(device: str = "auto") -> Any:
    try:
        from paddleocr import PaddleOCR
    except ImportError:
        print("未安装 paddleocr，请先执行: pip install -r requirements-ocr.txt")
        sys.exit(2)

    effective_device = check_paddle_device(device)
    print(f"OCR 设备: {effective_device}")

    base_kwargs = {
        "lang": "ch",
        "device": effective_device,
        "use_doc_orientation_classify": False,
        "use_doc_unwarping": False,
        "use_textline_orientation": True,
        "enable_mkldnn": False,
    }
    init_candidates = [
        base_kwargs,
        {k: v for k, v in base_kwargs.items() if k != "device"},
        {"lang": "ch", "enable_mkldnn": False},
    ]
    last_error: Exception | None = None
    for kwargs in init_candidates:
        try:
            return PaddleOCR(**kwargs)
        except (TypeError, ValueError) as exc:
            last_error = exc
    raise RuntimeError(f"无法初始化 PaddleOCR: {last_error}")


def is_layout_noise_box(box: OcrBox, image_w: int, cfg: dict[str, Any]) -> bool:
    """左侧序号列、右侧按钮/图标列的 OCR 框直接丢弃。"""
    index_right = float(cfg.get("index_column_right_ratio", 0.13)) * image_w
    content_right_max = float(cfg.get("content_right_max_ratio", 0.76)) * image_w
    text = normalize_text(box.text)
    if re.fullmatch(r"[Ω◯○oOQ🎧\s]*\d{1,4}\s*$", text):
        # 左侧序号或右侧耳机计数小框
        if box.x2 <= image_w * 0.20 or box.x1 >= image_w * 0.55:
            return True
    if box.x2 <= index_right and re.fullmatch(r"\d{1,4}", text):
        return True
    if box.x1 >= content_right_max:
        return True
    if box.x1 >= image_w * 0.70 and len(text) <= 2:
        return True
    return False


def filter_layout_boxes(boxes: list[OcrBox], image_w: int, cfg: dict[str, Any]) -> list[OcrBox]:
    return [b for b in boxes if not is_layout_noise_box(b, image_w, cfg)]


def is_layout_noise_row(row: Row, image_w: int, cfg: dict[str, Any]) -> bool:
    fake = OcrBox(text=row.text, score=row.score, x1=row.x1, y1=row.y1, x2=row.x2, y2=row.y2)
    return is_layout_noise_box(fake, image_w, cfg)


def filter_layout_rows(rows: list[Row], image_w: int, cfg: dict[str, Any]) -> list[Row]:
    return [r for r in rows if not is_layout_noise_row(r, image_w, cfg)]


def is_garbage_row(text: str) -> bool:
    value = normalize_text(text)
    if not value:
        return True
    if len(value) <= 2:
        return not bool(re.search(r"[\u4e00-\u9fffA-Za-z\u3040-\u30ff]", value))
    if re.fullmatch(r"[\(\)（）<>\[\]【】\s\W]+", value):
        return True
    # 允许 C418 / C418 47 这类「字母+数字」歌手行（不要求连续两个字母）
    if not re.search(r"[\u4e00-\u9fffA-Za-z\u3040-\u30ff]", value):
        return True
    return False


def should_drop_text(text: str, cfg: dict[str, Any]) -> bool:
    if not text:
        return True
    value = normalize_text(text)
    if is_garbage_row(value):
        return True
    if is_noise_like_text(value):
        return True
    # 过滤“耳机图标 + 播放量”这类独立小框（如 Ω75 / 75），避免被当成一行参与配对。
    if re.fullmatch(r"[Ω◯○oOQ🎧\s]*\d{1,4}\s*$", value):
        return True
    if re.match(r"^\d{1,2}:\d{2}", value):
        return True
    # OCR 截断碎片（如“歌...”“you've change...”）不参与配对，避免后续连锁错位。
    if len(value) <= 14 and re.search(r"(?:\.\.\.|…)\s*$", value):
        return True
    # 顶部汇总栏（如“歌曲429 专辑4 歌单2”）不参与歌曲配对。
    if re.fullmatch(r"歌曲\s*\d{1,5}\s*专辑\s*\d{1,5}\s*歌单\s*\d{1,5}", value):
        return True
    for phrase in cfg.get(
        "ui_drop_contains",
        ["无音源", "相关视频可播", "续费会员", "全部播放", "QQ音乐", "我的收藏", "听我想听"],
    ):
        if phrase and phrase in value:
            return True
    blacklist = cfg.get("ui_blacklist", [])
    for token in blacklist:
        token = normalize_text(str(token))
        # 仅在整行基本是 UI 文案时过滤，避免误杀包含 VIP 的正常歌名行
        if token and (value == token or value.startswith(token + " ")):
            return True
    for pat in cfg.get("time_patterns", []):
        if re.match(pat, value):
            return True
    return False


def looks_truncated_title_fragment(text: str, cfg: dict[str, Any]) -> bool:
    value = normalize_text(text)
    if not value:
        return True
    if re.search(r"(?:\.\.\.|…)\s*$", value):
        return True
    if len(value) <= 8 and re.search(r"[（(\[【][^）)\]】]*$", value):
        return True
    song = clean_song_title(value, cfg)
    if not song:
        return True
    # 特别短且包含明显分隔符，通常是被截断/粘连的碎片。
    if len(song) <= 6 and re.search(r"[:：;；,，/\\|·・\-–—]", value):
        return True
    return False


def split_artist(text: str, cfg: dict[str, Any]) -> str:
    value = normalize_text(text)
    for sep in cfg.get("artist_album_separators", []):
        if sep in value:
            value = value.split(sep, 1)[0]
            break
    return normalize_text(value)


def _poly_to_box(poly: Any) -> tuple[float, float, float, float] | None:
    if poly is None:
        return None
    pts = poly.tolist() if hasattr(poly, "tolist") else poly
    if not pts:
        return None
    xs = [float(p[0]) for p in pts]
    ys = [float(p[1]) for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def _append_ocr_box(boxes: list[OcrBox], text: str, score: float, poly: Any, min_score: float) -> None:
    score = float(score)
    if score < min_score:
        return
    text = normalize_text(str(text))
    if not text:
        return
    bounds = _poly_to_box(poly)
    if bounds is None:
        return
    x1, y1, x2, y2 = bounds
    boxes.append(OcrBox(text=text, score=score, x1=x1, y1=y1, x2=x2, y2=y2))


def parse_ocr_boxes(raw_result: Any, min_score: float) -> list[OcrBox]:
    boxes: list[OcrBox] = []
    if not raw_result:
        return boxes

    pages = raw_result if isinstance(raw_result, list) else [raw_result]
    for page in pages:
        if page is None:
            continue

        # PaddleOCR 3.x / PaddleX: OCRResult(dict-like), keys: rec_texts/rec_scores/rec_polys
        data: Any = page
        if isinstance(page, dict):
            data = page
        elif hasattr(page, "__getitem__"):
            try:
                data = {
                    "rec_texts": page["rec_texts"],
                    "rec_scores": page["rec_scores"],
                    "rec_polys": page.get("rec_polys") if hasattr(page, "get") else page["rec_polys"],
                }
            except (KeyError, TypeError):
                data = page
        elif hasattr(page, "json"):
            data = page.json
        elif hasattr(page, "to_dict"):
            data = page.to_dict()
        if isinstance(data, dict) and "rec_texts" in data:
            texts = data.get("rec_texts", []) or []
            scores = data.get("rec_scores", []) or []
            polys = data.get("rec_polys") or data.get("dt_polys") or []
            for text, score, poly in zip(texts, scores, polys):
                _append_ocr_box(boxes, text, score, poly, min_score)
            continue

        # PaddleOCR 2.x: [[box, (text, score)], ...]
        if isinstance(page, list):
            for item in page:
                if not item or len(item) < 2:
                    continue
                _append_ocr_box(boxes, item[1][0], item[1][1], item[0], min_score)

    return boxes


def run_ocr(ocr: Any, image: np.ndarray, image_path: Path) -> Any:
    image_str = str(image_path)
    if hasattr(ocr, "predict"):
        predict_kwargs = {
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
        }
        try:
            return ocr.predict(image, **predict_kwargs)
        except NotImplementedError as exc:
            raise RuntimeError(
                "Paddle 运行时与 oneDNN 存在兼容问题（ConvertPirAttribute...）。"
                "请升级/降级 paddlepaddle（推荐 3.2.2）后重试。"
            ) from exc
        except TypeError:
            return ocr.predict(image)
    try:
        return ocr.ocr(image, cls=True)
    except Exception:
        # Fallback path for old wrappers expecting file path.
        return ocr.ocr(image_str, cls=True)


def cluster_rows(boxes: list[OcrBox], image_h: int, cfg: dict[str, Any]) -> list[Row]:
    if not boxes:
        return []
    base_thr = float(cfg.get("row_y_threshold", 0.022)) * image_h
    median_h = float(np.median([b.h for b in boxes])) if boxes else 0.0
    # 自适应阈值：防止把上下两行（歌名/歌手）错误并成一行
    adaptive_thr = max(6.0, median_h * float(cfg.get("row_y_by_box_factor", 0.55)))
    row_thr = min(base_thr, adaptive_thr)
    sorted_boxes = sorted(boxes, key=lambda b: b.cy)
    clusters: list[list[OcrBox]] = []
    cur: list[OcrBox] = []
    cur_cy = 0.0

    for box in sorted_boxes:
        if not cur:
            cur = [box]
            cur_cy = box.cy
            continue
        if abs(box.cy - cur_cy) <= row_thr:
            cur.append(box)
            cur_cy = sum(x.cy for x in cur) / len(cur)
        else:
            clusters.append(cur)
            cur = [box]
            cur_cy = box.cy
    if cur:
        clusters.append(cur)

    rows: list[Row] = []
    for cluster in clusters:
        cluster = sorted(cluster, key=lambda b: b.x1)
        text = normalize_text(" ".join(x.text for x in cluster if x.text))
        if not text:
            continue
        x1 = min(x.x1 for x in cluster)
        y1 = min(x.y1 for x in cluster)
        x2 = max(x.x2 for x in cluster)
        y2 = max(x.y2 for x in cluster)
        h = max(1.0, y2 - y1)
        score = sum(x.score for x in cluster) / len(cluster)
        rows.append(Row(text=text, score=score, x1=x1, y1=y1, x2=x2, y2=y2, h=h, cy=(y1 + y2) / 2.0, raw_boxes=cluster))
    return rows


def align_ok(r1: Row, r2: Row, image_w: int, cfg: dict[str, Any]) -> bool:
    align_thr = float(cfg.get("align_threshold", 0.15)) * image_w
    left_diff = abs(r1.x1 - r2.x1)
    overlap = min(r1.x2, r2.x2) - max(r1.x1, r2.x1)
    return left_diff <= align_thr or overlap > 0


def overlap_x(a1: float, a2: float, b1: float, b2: float) -> float:
    return max(0.0, min(a2, b2) - max(a1, b1))


def _meaningful_artist_from_row(text: str, cfg: dict[str, Any]) -> str:
    raw = preprocess_ocr_line(text)
    glued = re.match(r"^(.+?)([0-9０-９]{1,4})$", raw)
    if glued and re.search(r"[A-Za-z\u4e00-\u9fff\u3040-\u30ff]{2,}", glued.group(1)):
        from_glued = clean_artist_name(glued.group(1), cfg)
        if has_meaningful_name(from_glued):
            return from_glued
    artist = clean_artist_name(text, cfg)
    if has_meaningful_name(artist):
        return artist
    # OCR 截断时（如「カ（Yorushika）」），从括号内拉丁/假名补救
    m = re.search(r"[（(]([^）)]+)[）)]", normalize_text(text))
    if m:
        inner = clean_artist_name(m.group(1), cfg)
        if has_meaningful_name(inner):
            return inner
    loose = normalize_text(strip_ui_noise(preprocess_ocr_line(text)))
    for token in cfg.get("artist_line_markers", ["VIP", "HQ", "SQ", "MV", "无损"]):
        loose = re.sub(re.escape(str(token)), "", loose, flags=re.IGNORECASE)
    loose = normalize_text(loose)
    return loose if has_meaningful_name(loose) else ""


def score_row_pair(
    top: Row, bot: Row, gap: float, gap_limit: float, cfg: dict[str, Any], *, adjacent: bool = False
) -> float:
    min_title_ratio = float(
        cfg.get("detect_title_min_height_ratio", cfg.get("title_min_height_ratio", 0.72))
    )
    if min_title_ratio > 1.0:
        min_title_ratio = 0.72
    song = clean_song_title(top.text, cfg)
    artist = _meaningful_artist_from_row(bot.text, cfg)
    if looks_like_artist_line(top.text, cfg):
        return -1.0
    top_truncated = looks_truncated_title_fragment(top.text, cfg)
    if top_truncated:
        # 截断标题默认保守拒绝；仅允许和紧邻且明显像歌手的下一行做受控配对。
        if not adjacent:
            return -1.0
        near_gap_ratio = float(cfg.get("truncated_pair_gap_ratio", 1.6))
        if gap > max(top.h, bot.h, 8.0) * near_gap_ratio:
            return -1.0
        if not (_meaningful_artist_from_row(bot.text, cfg) or is_likely_artist_row(bot.text, cfg)):
            return -1.0
    if not has_meaningful_name(song) or not artist:
        return -1.0
    # QQ 音乐里歌手行常因 VIP/播放量框更高；紧邻两行不做字高硬拒绝
    if not adjacent and top.h < bot.h * min_title_ratio:
        return -1.0
    score = 10.0
    if is_likely_artist_row(bot.text, cfg):
        score += 3.0
    if top.h >= bot.h * 1.02:
        score += 5.0
    elif top.h >= bot.h * 0.92:
        score += 2.0
    if gap_limit > 0:
        score += 4.0 * (1.0 - min(1.0, gap / gap_limit))
    if top_truncated:
        # 允许截断行“近邻补救”，但仍降分，避免压过正常完整标题。
        score -= float(cfg.get("truncated_pair_penalty", 2.8))
    return score


def try_force_adjacent_pair(
    top: Row, bot: Row, image_w: int, cfg: dict[str, Any], gap_ratio: float
) -> bool:
    """紧邻两行强制配对：上歌名、下歌手（解决 score_low / 双橙框落单）。"""
    min_row_h = float(cfg.get("detect_min_row_height", 8))
    if top.h < min_row_h or bot.h < min_row_h:
        return False
    if should_drop_text(top.text, cfg) or should_drop_text(bot.text, cfg):
        return False
    if looks_like_artist_line(top.text, cfg):
        return False
    if not has_meaningful_name(clean_song_title(top.text, cfg)):
        return False
    if not _meaningful_artist_from_row(bot.text, cfg):
        return False
    # 下行必须是歌手/metadata，不能是下一首歌名（如 Minecraft）
    if (
        not is_likely_artist_row(bot.text, cfg)
        and not _meaningful_artist_from_row(bot.text, cfg)
        and has_meaningful_name(clean_song_title(bot.text, cfg))
    ):
        return False
    gap = bot.cy - top.cy
    if gap <= 0:
        return False
    gap_limit = max(top.h, bot.h, min_row_h) * gap_ratio
    if gap > gap_limit:
        return False
    align_thr = float(cfg.get("detect_align_threshold", cfg.get("align_threshold", 0.15))) * image_w
    left_diff = abs(top.x1 - bot.x1)
    ov = overlap_x(top.x1, top.x2, bot.x1, bot.x2)
    if left_diff > align_thr * 1.6 and ov <= 0:
        return False
    return True


def split_rows_into_entries(rows: list[Row], cfg: dict[str, Any]) -> list[list[Row]]:
    """按行距把 OCR 行切成「歌曲条目块」，避免跨条目扫描导致 blocked_by_next_title。"""
    rows = sorted(rows, key=lambda r: r.cy)
    if len(rows) <= 1:
        return [rows] if rows else []
    gaps = [rows[i + 1].cy - rows[i].cy for i in range(len(rows) - 1)]
    positive = [g for g in gaps if g > 0]
    if not positive:
        return [rows]
    median = sorted(positive)[len(positive) // 2]
    thr = max(
        float(cfg.get("entry_split_gap_min_px", 28)),
        median * float(cfg.get("entry_split_gap_factor", 1.55)),
    )
    entries: list[list[Row]] = [[rows[0]]]
    for i in range(1, len(rows)):
        if rows[i].cy - rows[i - 1].cy > thr:
            entries.append([rows[i]])
        else:
            entries[-1].append(rows[i])
    return entries


def merge_title_artist_entries(entries: list[list[Row]], cfg: dict[str, Any]) -> list[list[Row]]:
    """把「仅歌名块 + 下一歌手块」合并，修复底部条目被大间距拆开。"""
    merged: list[list[Row]] = []
    i = 0
    while i < len(entries):
        cur = entries[i]
        if i + 1 < len(entries) and len(cur) == 1:
            only = cur[0]
            if has_meaningful_name(clean_song_title(only.text, cfg)) and not looks_like_artist_line(
                only.text, cfg
            ):
                nxt = entries[i + 1]
                if any(
                    is_likely_artist_row(r.text, cfg) or _meaningful_artist_from_row(r.text, cfg)
                    for r in nxt
                ):
                    merged.append(cur + nxt)
                    i += 2
                    continue
        merged.append(cur)
        i += 1
    return merged


def try_pair_entry(entry: list[Row], cfg: dict[str, Any]) -> tuple[Row, Row] | None:
    lines: list[Row] = []
    for row in entry:
        if should_drop_text(row.text, cfg) or is_garbage_row(row.text):
            continue
        lines.append(row)
    if len(lines) < 2:
        return None

    top: Row | None = None
    for row in lines:
        if looks_like_artist_line(row.text, cfg):
            continue
        if has_meaningful_name(clean_song_title(row.text, cfg)):
            top = row
            break
    if top is None:
        return None

    top_pos = lines.index(top)
    bot: Row | None = None
    for row in lines[top_pos + 1 :]:
        if _meaningful_artist_from_row(row.text, cfg) or is_likely_artist_row(row.text, cfg):
            bot = row
            break
    if bot is None:
        return None
    if (
        not is_likely_artist_row(bot.text, cfg)
        and has_meaningful_name(clean_song_title(bot.text, cfg))
        and len(lines) > 2
    ):
        return None
    return top, bot


def can_pair_adjacent_rows(
    top: Row, bot: Row, cfg: dict[str, Any], *, allow_top_artist_fallback: bool = False
) -> bool:
    """QQ 音乐列表：默认「上一行歌名 + 下一行歌手/metadata」。"""
    if should_drop_text(top.text, cfg) or should_drop_text(bot.text, cfg):
        return False
    if is_garbage_row(top.text) or is_garbage_row(bot.text):
        return False
    top_artist = is_likely_artist_row(top.text, cfg) and not looks_like_title_line(top.text, cfg)
    if top_artist:
        if not allow_top_artist_fallback:
            return False
        # 兜底：top 被“歌手样式”误判时，若仍像可用歌名且下行明确像歌手，则允许相邻配对。
        if not has_meaningful_name(clean_song_title(top.text, cfg)):
            return False
        # 下行若明显像歌名（非歌手 metadata），禁止在回退路径里强行配对。
        if looks_like_title_line(bot.text, cfg) and not looks_like_artist_line(bot.text, cfg):
            return False
        if not (_meaningful_artist_from_row(bot.text, cfg) or is_likely_artist_row(bot.text, cfg)):
            return False
        return True
    if not has_meaningful_name(clean_song_title(top.text, cfg)) and not looks_like_title_line(
        top.text, cfg
    ):
        return False
    if _meaningful_artist_from_row(bot.text, cfg) or is_likely_artist_row(bot.text, cfg):
        return True
    if looks_like_title_line(bot.text, cfg) and has_meaningful_name(clean_song_title(bot.text, cfg)):
        return False
    return False


def is_bridge_noise_row(row: Row, cfg: dict[str, Any]) -> bool:
    """仅用于 i->i+2 兜底：识别夹在中间、应被跳过的噪声行。"""
    text = normalize_text(row.text)
    if not text:
        return True
    if should_drop_text(text, cfg) or is_noise_like_text(text):
        return True
    lowered = text.lower()
    if "mid truncate" in lowered:
        return True
    # 典型短噪声：如 S / （）目 / 单个碎片符号
    if len(text) <= 4 and not _meaningful_artist_from_row(text, cfg):
        if not has_meaningful_name(clean_song_title(text, cfg)):
            return True
    return False


def score_unpaired_rescue_pair(top: Row, bot: Row, cfg: dict[str, Any]) -> float:
    """仅用于「未配对 -> 就近补配」：距离越近、越对齐、语义越像歌名+歌手，分越高。"""
    if should_drop_text(top.text, cfg) or should_drop_text(bot.text, cfg):
        return -1.0
    if is_garbage_row(top.text) or is_garbage_row(bot.text):
        return -1.0
    if bot.cy <= top.cy:
        return -1.0

    title = clean_song_title(top.text, cfg)
    artist = _meaningful_artist_from_row(bot.text, cfg)
    if not has_meaningful_name(title):
        return -1.0

    # 顶行明显是歌手样式时，不作为补配起点，避免反向误绑。
    if is_likely_artist_row(top.text, cfg) and not looks_like_title_line(top.text, cfg):
        return -1.0

    gap = bot.cy - top.cy
    h_ref = max(top.h, bot.h, 8.0)
    gap_ratio = gap / h_ref
    # 就近补配：只接受紧邻（约 <= 1.7 行高）
    if gap_ratio > float(cfg.get("rescue_gap_ratio_max", 1.7)):
        return -1.0

    align_thr = float(cfg.get("detect_align_threshold", cfg.get("align_threshold", 0.15)))
    width_ref = max(max(top.x2, bot.x2) - min(top.x1, bot.x1), 1.0)
    left_diff_ratio = abs(top.x1 - bot.x1) / width_ref
    overlap = overlap_x(top.x1, top.x2, bot.x1, bot.x2)
    overlap_ratio = overlap / max(1.0, min(top.x2 - top.x1, bot.x2 - bot.x1))

    score = 0.0
    # 距离主导
    score += max(0.0, 8.0 - gap_ratio * 3.0)
    # 左边缘对齐越好越高
    score += max(0.0, 3.0 - left_diff_ratio / max(align_thr, 0.01))
    # 横向重叠越高越高
    score += min(3.0, overlap_ratio * 3.0)
    if artist:
        score += 3.0
    # 即使 bot 不像标准歌手行，也允许近邻补配，但降低置信
    if not (is_likely_artist_row(bot.text, cfg) or artist):
        score -= 2.0
    if looks_like_title_line(bot.text, cfg) and not is_likely_artist_row(bot.text, cfg):
        score -= 1.5
    return score


def rescue_unpaired_pairs(
    rows: list[Row], used: set[int], cfg: dict[str, Any], unpaired_notes: dict[int, str]
) -> list[tuple[Row, Row]]:
    """第二阶段：仅在未配对行内做“就近补配”，避免前面一条错位持续污染。"""
    threshold = float(cfg.get("rescue_pair_score_min", 8.5))
    lookahead = max(1, int(cfg.get("rescue_pair_lookahead", 2)))
    rescued: list[tuple[Row, Row]] = []

    remaining = [i for i in range(len(rows)) if i not in used]
    matched: set[int] = set()
    candidates: list[tuple[float, int, int]] = []

    for pos, i in enumerate(remaining):
        top = rows[i]
        for j in remaining[pos + 1 : pos + 1 + lookahead]:
            if j <= i:
                continue
            score = score_unpaired_rescue_pair(top, rows[j], cfg)
            if score >= threshold:
                candidates.append((score, i, j))

    # 分数高者优先，避免一个框被多次占用。
    candidates.sort(key=lambda x: x[0], reverse=True)
    for score, i, j in candidates:
        if i in matched or j in matched or i in used or j in used:
            continue
        matched.add(i)
        matched.add(j)
        used.add(i)
        used.add(j)
        rescued.append((rows[i], rows[j]))
        unpaired_notes[id(rows[i])] = f"rescued_nearby:{score:.2f}"
        unpaired_notes[id(rows[j])] = f"rescued_nearby:{score:.2f}"
    return rescued


def pair_rows_scored(
    rows: list[Row], image_w: int, image_h: int, cfg: dict[str, Any]
) -> tuple[list[tuple[Row, Row]], list[tuple[str, Row]], dict[int, str]]:
    del image_w  # 仅使用纵向邻近与文本语义，不做复杂横向扫描
    rows = sorted(rows, key=lambda r: r.cy)
    min_row_h = float(cfg.get("detect_min_row_height", 8))
    window = max(2, int(cfg.get("detect_pair_window", 4)))
    min_pair_score = float(cfg.get("detect_min_pair_score", 10.0))
    truncated_relaxed_pair_score = float(cfg.get("truncated_relaxed_pair_score", 8.6))
    ambiguity_margin = float(cfg.get("detect_pair_ambiguity_margin", 1.8))
    used: set[int] = set()
    protected_bots: set[int] = set()
    pairs: list[tuple[Row, Row]] = []
    unpaired_notes: dict[int, str] = {}

    i = 0
    while i < len(rows):
        top = rows[i]
        if i in used or top.h < min_row_h or should_drop_text(top.text, cfg):
            i += 1
            continue

        if is_garbage_row(top.text):
            i += 1
            continue

        # 若当前行明显像歌手，保守跳过，避免把错位链继续向后传播。
        if is_likely_artist_row(top.text, cfg) and not looks_like_title_line(top.text, cfg):
            unpaired_notes[id(top)] = "top_looks_like_artist"
            i += 1
            continue
        top_truncated = looks_truncated_title_fragment(top.text, cfg)
        if top_truncated and i + 1 < len(rows):
            nxt = rows[i + 1]
            gap = nxt.cy - top.cy
            protect_gap_ratio = float(cfg.get("truncated_protect_gap_ratio", 1.8))
            if (
                gap > 0
                and gap <= max(top.h, nxt.h, min_row_h) * protect_gap_ratio
                and (is_likely_artist_row(nxt.text, cfg) or _meaningful_artist_from_row(nxt.text, cfg))
            ):
                # 防止“被截断标题的真正下行歌手”被更远上行提前抢走（连锁错位根因）。
                protected_bots.add(i + 1)

        best_j = -1
        best_score = -1.0
        second_best_score = -1.0
        for j in range(i + 1, min(len(rows), i + window + 1)):
            if j in used:
                continue
            if j in protected_bots and j != i + 1:
                continue
            bot = rows[j]
            if bot.h < min_row_h or should_drop_text(bot.text, cfg) or is_garbage_row(bot.text):
                continue
            if not can_pair_adjacent_rows(top, bot, cfg):
                continue
            gap = bot.cy - top.cy
            if gap <= 0:
                continue
            gap_limit = max(top.h, bot.h, min_row_h) * float(cfg.get("detect_force_mid_gap_ratio", 2.2))
            if gap > gap_limit:
                continue
            score = score_row_pair(top, bot, gap, gap_limit, cfg, adjacent=(j == i + 1))
            if score < 0:
                continue
            # 跳过中间明显非噪声行时，强惩罚，避免跨条目误绑导致连锁错位。
            if j > i + 1:
                bridge_penalty = 0.0
                for k in range(i + 1, j):
                    if k in used:
                        continue
                    if not is_bridge_noise_row(rows[k], cfg):
                        bridge_penalty += 7.5
                score -= bridge_penalty
            if score > best_score:
                second_best_score = best_score
                best_score = score
                best_j = j
            elif score > second_best_score:
                second_best_score = score

        strict_ok = (
            best_j >= 0
            and best_score >= min_pair_score
            and (second_best_score < 0 or (best_score - second_best_score) >= ambiguity_margin)
        )
        truncated_adjacent_ok = (
            top_truncated
            and best_j == i + 1
            and best_score >= truncated_relaxed_pair_score
        )
        if strict_ok or truncated_adjacent_ok:
            used.add(i)
            used.add(best_j)
            protected_bots.discard(best_j)
            pairs.append((top, rows[best_j]))
            if best_j > i + 1:
                for k in range(i + 1, best_j):
                    if k in used:
                        continue
                    if is_bridge_noise_row(rows[k], cfg):
                        unpaired_notes[id(rows[k])] = "bridge_noise_skipped"
            i += 1
            continue

        if not has_meaningful_name(clean_song_title(top.text, cfg)):
            unpaired_notes[id(top)] = "top_song_not_meaningful"
        elif top_truncated:
            unpaired_notes[id(top)] = "top_truncated_fragment"
        elif second_best_score >= 0 and (best_score - second_best_score) < ambiguity_margin:
            unpaired_notes[id(top)] = "pair_ambiguous"
        else:
            unpaired_notes[id(top)] = "adjacent_rejected"
        i += 1

    # 第二阶段补配：只在未配对里按“就近+对齐+语义”再尝试一次。
    rescued_pairs = rescue_unpaired_pairs(rows, used, cfg, unpaired_notes)
    if rescued_pairs:
        pairs.extend(rescued_pairs)

    unpaired: list[tuple[str, Row]] = []
    has_prev_pair = False
    for i, row in enumerate(rows):
        if i in used:
            has_prev_pair = True
            continue
        if row.h < min_row_h or should_drop_text(row.text, cfg):
            continue
        reason = classify_unpaired_reason(row, image_h, cfg, has_prev_pair)
        unpaired.append((reason, row))
    return pairs, unpaired, unpaired_notes


def classify_unpaired_reason(row: Row, image_h: int, cfg: dict[str, Any], has_prev_pair: bool) -> str:
    edge_margin = float(cfg.get("edge_margin_ratio", 0.03)) * image_h
    # 底部若只截到歌手样式单行，优先归为边缘截断，避免误导为中间漏配。
    if (image_h - row.y2) <= edge_margin * 1.8 and is_likely_artist_row(row.text, cfg):
        return "edge_truncated"
    if row.y1 <= edge_margin or (image_h - row.y2) <= edge_margin:
        return "edge_truncated"
    if has_prev_pair:
        return "mid_truncated"
    return "orphan_artist"


def extract_tracks_from_rows(
    rows: list[Row], image_w: int, image_h: int, cfg: dict[str, Any], image_name: str
) -> tuple[list[TrackCandidate], list[ReviewItem], list[tuple[Row, Row]], list[tuple[str, Row]]]:
    tracks: list[TrackCandidate] = []
    reviews: list[ReviewItem] = []
    if not rows:
        return tracks, reviews, [], []

    pairs, unpaired, unpaired_notes = pair_rows_scored(rows, image_w, image_h, cfg)
    min_ocr_pair = float(cfg.get("min_pair_score", 0.5))

    for top, bot in pairs:
        song = clean_song_title(top.text, cfg)
        artist = _meaningful_artist_from_row(bot.text, cfg)
        pair_score = (top.score + bot.score) / 2.0
        if not has_meaningful_name(song) or not artist:
            reviews.append(
                ReviewItem(
                    reason="low_confidence",
                    text=f"{song}-{artist}".strip("-"),
                    image_name=image_name,
                    note=f"pair_score={pair_score:.2f}",
                )
            )
            continue
        tracks.append(TrackCandidate(song=song, artist=artist, score=pair_score, image_name=image_name))
        if pair_score < min_ocr_pair:
            reviews.append(
                ReviewItem(
                    reason="low_confidence",
                    text=f"{song}-{artist}",
                    image_name=image_name,
                    note=f"pair_score={pair_score:.2f}",
                )
            )

    for reason, row in unpaired:
        diag = unpaired_notes.get(id(row), "")
        if reason == "edge_truncated" and diag == "no_adjacent_bot":
            diag = "edge_no_adjacent_bot"
        note = f"score={row.score:.2f}" + (f"; {diag}" if diag else "")
        reviews.append(ReviewItem(reason=reason, text=row.text, image_name=image_name, note=note))

    return tracks, reviews, pairs, unpaired


def dedupe_tracks(tracks: list[TrackCandidate]) -> list[TrackCandidate]:
    best: dict[str, TrackCandidate] = {}
    for t in tracks:
        key = f"{normalize_key(t.song)}|{normalize_key(t.artist)}"
        prev = best.get(key)
        if prev is None or t.score > prev.score:
            best[key] = t
    return list(best.values())


def read_existing_songs(output_path: Path) -> list[str]:
    if not output_path.exists():
        return []
    lines = output_path.read_text(encoding="utf-8", errors="ignore").splitlines()
    return [normalize_text(line) for line in lines if normalize_text(line)]


def write_output(
    output_path: Path,
    tracks: list[TrackCandidate],
    merge_mode: str,
    dedupe: bool,
) -> list[str]:
    new_lines = [f"{t.song}-{t.artist}" for t in tracks if t.song and t.artist]
    if merge_mode == "append":
        existing = read_existing_songs(output_path)
        merged = existing + new_lines
    else:
        merged = new_lines

    if dedupe:
        seen: set[str] = set()
        final_lines: list[str] = []
        for line in merged:
            if "-" not in line:
                continue
            song, artist = line.split("-", 1)
            key = f"{normalize_key(song)}|{normalize_key(artist)}"
            if key in seen:
                continue
            seen.add(key)
            final_lines.append(f"{normalize_text(song)}-{normalize_text(artist)}")
    else:
        final_lines = [line for line in merged if "-" in line]

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(final_lines) + ("\n" if final_lines else ""), encoding="utf-8")
    return final_lines


def write_review(review_path: Path, items: list[ReviewItem]) -> None:
    review_path.parent.mkdir(parents=True, exist_ok=True)
    grouped: dict[str, list[ReviewItem]] = {}
    for item in items:
        grouped.setdefault(item.image_name, []).append(item)
    lines: list[str] = []
    for image_name in sorted(grouped):
        lines.append(f"# 来源文件: {image_name}")
        for item in grouped[image_name]:
            note = f"\t# {item.note}" if item.note else ""
            lines.append(f"[{item.reason}] {item.text}{note}")
        lines.append("")
    review_path.write_text("\n".join(lines).strip() + ("\n" if lines else ""), encoding="utf-8")


def write_predictions_csv(csv_path: Path, tracks: list[TrackCandidate]) -> None:
    """Write per-image prediction rows for offline accuracy evaluation."""
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["image_name", "song", "artist", "score", "pair"])
        for t in tracks:
            writer.writerow([t.image_name, t.song, t.artist, f"{t.score:.4f}", f"{t.song}-{t.artist}"])


def _debug_short(text: str, max_len: int = 16) -> str:
    value = normalize_text(text)
    return value if len(value) <= max_len else value[: max_len - 1] + "…"


def _load_debug_font(size: int):
    from PIL import ImageFont

    candidates = [
        Path("C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/msyhbd.ttc"),
        Path("/System/Library/Fonts/PingFang.ttc"),
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
        Path("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"),
    ]
    for path in candidates:
        if path.exists():
            try:
                return ImageFont.truetype(str(path), size=size)
            except OSError:
                continue
    return ImageFont.load_default()


def apply_debug_text_labels(
    image: np.ndarray,
    labels: list[tuple[str, int, int, tuple[int, int, int], int]],
) -> np.ndarray:
    """在 BGR 图上绘制 Unicode 标签（支持中日文）。"""
    if not labels:
        return image
    from PIL import Image, ImageDraw

    pil = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(pil)
    size_to_font: dict[int, Any] = {}
    for text, x, y, color_bgr, font_size in labels:
        if font_size not in size_to_font:
            size_to_font[font_size] = _load_debug_font(font_size)
        font = size_to_font[font_size]
        color_rgb = (color_bgr[2], color_bgr[1], color_bgr[0])
        draw.text((x, max(0, y)), text, font=font, fill=color_rgb)
    return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)


def render_playlist_debug_image(
    image: np.ndarray,
    rows: list[Row],
    pairs: list[tuple[Row, Row]],
    unpaired: list[tuple[str, Row]],
    track_count: int,
    crop_boxes: list[tuple[int, tuple[int, int, int, int] | None]] | None = None,
) -> np.ndarray:
    img = image.copy()
    if img.size == 0:
        return img
    paired_ids = {id(r) for pair in pairs for r in pair}
    unpaired_ids = {id(r) for _, r in unpaired}
    labels: list[tuple[str, int, int, tuple[int, int, int], int]] = []

    for row in rows:
        if id(row) in paired_ids or id(row) in unpaired_ids:
            continue
        cv2.rectangle(img, (int(row.x1), int(row.y1)), (int(row.x2), int(row.y2)), (160, 160, 160), 1)

    for reason, row in unpaired:
        cv2.rectangle(img, (int(row.x1), int(row.y1)), (int(row.x2), int(row.y2)), (0, 140, 255), 2)
        labels.append((reason[:12], int(row.x1), int(row.y1) - 18, (0, 140, 255), 15))

    crop_by_idx = {idx: box for idx, box in (crop_boxes or [])}
    for idx, (top, bot) in enumerate(pairs, start=1):
        cv2.rectangle(img, (int(top.x1), int(top.y1)), (int(top.x2), int(top.y2)), (60, 220, 60), 2)
        cv2.rectangle(img, (int(bot.x1), int(bot.y1)), (int(bot.x2), int(bot.y2)), (255, 200, 60), 2)
        labels.append((f"#{idx} {_debug_short(top.text)}", int(top.x1), int(top.y1) - 18, (60, 220, 60), 15))
        labels.append((_debug_short(bot.text), int(bot.x1), int(bot.y1) - 18, (255, 200, 60), 15))
        box = crop_by_idx.get(idx)
        if box is not None:
            x1, y1, x2, y2 = box
            cv2.rectangle(img, (x1, y1), (x2, y2), (0, 230, 255), 3)

    legend = f"rows={len(rows)} pairs={len(pairs)} tracks={track_count} unpaired={len(unpaired)}"
    labels.append((legend, 8, 6, (0, 255, 0), 18))
    return apply_debug_text_labels(img, labels)


def draw_debug(
    image: np.ndarray,
    image_path: Path,
    rows: list[Row],
    pairs: list[tuple[Row, Row]],
    unpaired: list[tuple[str, Row]],
    tracks: list[TrackCandidate],
    debug_dir: Path,
) -> None:
    img = render_playlist_debug_image(image, rows, pairs, unpaired, len(tracks))
    debug_dir.mkdir(parents=True, exist_ok=True)
    write_image_unicode(debug_dir / image_path.name, img)


def run(args: argparse.Namespace) -> int:
    base_dir = Path(__file__).resolve().parent
    cfg_path = Path(args.config) if args.config else (base_dir / "qq_music_layout.yaml")
    cfg = load_yaml(cfg_path)
    if args.theme:
        cfg["theme"] = args.theme

    input_dir = Path(args.input) if args.input else (base_dir / "images_in")
    output_path = Path(args.output) if args.output else (base_dir.parent / "songs.txt")
    review_path = Path(args.review) if args.review else (base_dir / "songs_review.txt")
    pred_csv_path = Path(args.pred_csv) if args.pred_csv else None
    debug_dir = Path(args.debug_dir) if args.debug_dir else (base_dir / "images_debug")
    regions_dir = Path(args.regions_dir) if getattr(args, "regions_dir", None) else None
    input_dir.mkdir(parents=True, exist_ok=True)
    if regions_dir is not None:
        clear_regions_cache(regions_dir)

    images = get_images(input_dir)
    if not images:
        print(f"未找到截图，请放入: {input_dir}")
        return 1

    ocr = build_ocr(device=args.device)
    all_tracks: list[TrackCandidate] = []
    all_reviews: list[ReviewItem] = []

    for image_path in images:
        img = read_image_unicode(image_path)
        if img is None:
            all_reviews.append(ReviewItem(reason="read_failed", text=image_path.name, image_name=image_path.name))
            continue
        original_h = img.shape[0]
        y_offset = status_bar_crop_y_offset(original_h, cfg)
        img = apply_status_bar_crop(img, cfg)
        image_h, image_w = img.shape[:2]
        raw = run_ocr(ocr, img, image_path)
        boxes = filter_layout_boxes(
            parse_ocr_boxes(raw, float(cfg.get("min_ocr_score", 0.55))), image_w, cfg
        )
        rows = filter_layout_rows(cluster_rows(boxes, image_h=image_h, cfg=cfg), image_w, cfg)
        tracks, reviews, pairs, unpaired = extract_tracks_from_rows(
            rows, image_w=image_w, image_h=image_h, cfg=cfg, image_name=image_path.name
        )
        all_tracks.extend(tracks)
        all_reviews.extend(reviews)

        if args.debug:
            draw_debug(img, image_path, rows, pairs, unpaired, tracks, debug_dir)

        if regions_dir is not None:
            write_regions_cache(
                regions_dir,
                image_path.name,
                export_regions_for_ui(pairs, unpaired, y_offset=y_offset),
            )

        print(f"[{image_path.name}] 识别: {len(tracks)} 首, review: {len(reviews)} 条")

    eval_tracks = list(all_tracks)
    all_tracks = dedupe_tracks(all_tracks) if args.dedupe else all_tracks
    lines = [f"{t.song}-{t.artist}" for t in all_tracks]

    if args.dry_run:
        print("\n=== dry-run 输出 ===")
        for line in lines:
            print(line)
    else:
        final_lines = write_output(output_path, all_tracks, merge_mode=args.merge, dedupe=args.dedupe)
        print(f"\nsongs.txt 已写入: {output_path} ({len(final_lines)} 行)")

    write_review(review_path, all_reviews)
    print(f"review 已写入: {review_path} ({len(all_reviews)} 条)")
    if pred_csv_path:
        write_predictions_csv(pred_csv_path, eval_tracks)
        print(f"预测明细已写入: {pred_csv_path} ({len(eval_tracks)} 行)")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="QQ 音乐歌单截图离线识别，输出 songs.txt")
    parser.add_argument("--input", default=None, help="截图目录，默认 playlist_ocr/images_in")
    parser.add_argument("--output", default=None, help="songs.txt 输出路径，默认 ../songs.txt")
    parser.add_argument("--review", default=None, help="review 输出路径，默认 playlist_ocr/songs_review.txt")
    parser.add_argument("--pred-csv", default=None, help="预测明细 CSV 路径（用于准确率评估）")
    parser.add_argument("--config", default=None, help="yaml 配置路径，默认 qq_music_layout.yaml")
    parser.add_argument("--debug", action="store_true", help="输出标注调试图")
    parser.add_argument("--debug-dir", default=None, help="调试图输出目录，默认 playlist_ocr/images_debug")
    parser.add_argument(
        "--regions-dir",
        default=None,
        help="每张图 OCR 框 JSON 缓存目录，供工具箱 UI 读取（默认不导出）",
    )
    parser.add_argument("--dry-run", action="store_true", help="仅打印结果，不写 songs.txt")
    parser.add_argument("--dedupe", action="store_true", default=True, help="输出前去重（默认启用）")
    parser.add_argument("--merge", choices=["append", "overwrite"], default="append", help="append 或 overwrite")
    parser.add_argument("--theme", choices=["auto", "light", "dark"], default=None, help="覆盖 yaml 的 theme")
    parser.add_argument(
        "--device",
        default="auto",
        help="推理设备: auto / cpu / gpu / gpu:0（默认 auto，有 GPU 且已装 GPU 版 paddle 时自动用显卡）",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
