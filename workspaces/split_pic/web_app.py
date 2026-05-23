from __future__ import annotations

import io
import zipfile
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory

from flask import Flask, jsonify, render_template, request, send_file
from PIL import Image, UnidentifiedImageError

from splitter.core import (
    SUPPORTED_SUFFIXES,
    SplitConfig,
    prepare_image_output_dir,
    split_image_object,
)

BASE_DIR = Path(__file__).resolve().parent
CONFIG = SplitConfig.from_file(BASE_DIR / "config.yaml")
BUILD_ID = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

app = Flask(__name__, template_folder=str(BASE_DIR / "templates"))


def _config_from_request() -> SplitConfig:
    mode = (request.form.get("mode") or CONFIG.mode).strip().lower()
    if mode not in {"auto", "smart", "fixed"}:
        raise ValueError("mode 仅支持 auto/smart/fixed")

    def as_int(name: str, default: int) -> int:
        value = request.form.get(name, "").strip()
        if not value:
            return default
        return int(value)

    def as_float(name: str, default: float) -> float:
        value = request.form.get(name, "").strip()
        if not value:
            return default
        return float(value)

    cfg = SplitConfig(
        mode=mode,
        output_dir=CONFIG.output_dir,
        target_height=as_int("target_height", CONFIG.target_height),
        max_height=as_int("max_height", CONFIG.max_height),
        overlap=as_int("overlap", CONFIG.overlap),
        search_radius=as_int("search_radius", CONFIG.search_radius),
        blank_quantile=as_float("blank_quantile", CONFIG.blank_quantile),
    )
    if cfg.target_height <= 0 or cfg.max_height <= 0:
        raise ValueError("target_height 和 max_height 必须大于 0")
    if cfg.max_height < cfg.target_height:
        raise ValueError("max_height 不能小于 target_height")
    if cfg.overlap < 0:
        raise ValueError("overlap 不能小于 0")
    if cfg.search_radius <= 0:
        raise ValueError("search_radius 必须大于 0")
    if not (0 < cfg.blank_quantile <= 0.9):
        raise ValueError("blank_quantile 需在 (0, 0.9] 区间")
    return cfg


@app.get("/")
def index():
    resp = render_template(
        "index.html",
        mode=CONFIG.mode,
        target_height=CONFIG.target_height,
        max_height=CONFIG.max_height,
        overlap=CONFIG.overlap,
        search_radius=CONFIG.search_radius,
        blank_quantile=CONFIG.blank_quantile,
        build_id=BUILD_ID,
    )
    return resp


@app.after_request
def disable_cache(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@app.post("/api/split")
def api_split():
    try:
        runtime_config = _config_from_request()
    except ValueError as exc:
        return jsonify({"error": f"参数错误: {exc}"}), 400

    files = request.files.getlist("images")
    if not files:
        return jsonify({"error": "请先选择至少一张图片。"}), 400

    ok_count = 0
    total_parts = 0
    failed_files: list[str] = []

    with TemporaryDirectory(prefix="split_", dir=str(BASE_DIR)) as temp_dir:
        output_dir = Path(temp_dir)

        for f in files:
            filename = f.filename or "image"
            suffix = Path(filename).suffix.lower()
            if suffix not in SUPPORTED_SUFFIXES:
                failed_files.append(f"{filename}: 不支持的格式")
                continue

            stem = Path(filename).stem
            try:
                image = Image.open(f.stream).convert("RGB")
                per_image_dir = prepare_image_output_dir(output_dir, stem)
                part_count = split_image_object(image, stem, per_image_dir, runtime_config)
                ok_count += 1
                total_parts += part_count
            except (UnidentifiedImageError, OSError, ValueError) as exc:
                failed_files.append(f"{filename}: {exc}")

        created = sorted(output_dir.glob("**/*.png"))
        if not created:
            return jsonify({"error": "没有生成任何切片，请检查图片文件。", "failed": failed_files}), 400

        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for path in created:
                zf.write(path, arcname=path.relative_to(output_dir).as_posix())

            summary = (
                f"processed={ok_count}\n"
                f"slices={total_parts}\n"
                f"failed={len(failed_files)}\n"
            )
            if failed_files:
                summary += "failed_detail=\n" + "\n".join(failed_files) + "\n"
            zf.writestr("_done.txt", summary)

        zip_buffer.seek(0)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        return send_file(
            zip_buffer,
            mimetype="application/zip",
            as_attachment=True,
            download_name=f"split_result_{timestamp}.zip",
        )


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5050, debug=False)

