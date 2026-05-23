#!/usr/bin/env python3
"""
从壁纸汇 (bizhihui.com) 详情页下载壁纸。

示例:
  python scripts/bizhihui_wallpaper.py
  python scripts/bizhihui_wallpaper.py "https://www.bizhihui.com/p/23329.html" -o ./downloads
  python scripts/bizhihui_wallpaper.py --size desktop
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

import requests
from requests.exceptions import SSLError

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

# 页面内「下载原图」链接 id=changeTxt2；电脑横屏 id=changeTxtdn
RE_ORIGINAL = re.compile(
    r'href="(https://s\.panlai\.com/zb_users/upload/[^"?]+\.(?:png|jpg|jpeg|webp))"',
    re.IGNORECASE,
)
RE_DESKTOP = re.compile(
    r'id="changeTxtdn"[^>]*href="([^"]+)"',
    re.IGNORECASE,
)
RE_POST_ID = re.compile(r"/p/(\d+)\.html", re.IGNORECASE)
RE_TITLE = re.compile(r"<title>([^<]+)</title>", re.IGNORECASE)

SIZE_ALIASES = {
    "original": "original",
    "原图": "original",
    "yt": "original",
    "desktop": "desktop",
    "电脑": "desktop",
    "dn": "desktop",
    "mobile": "mobile",
    "手机": "mobile",
    "sj": "mobile",
    "standard": "standard",
    "普通": "standard",
    "1080": "standard",
}


def build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    return session


def fetch_page(session: requests.Session, page_url: str) -> str:
    resp = session.get(page_url, timeout=30)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding or "utf-8"
    return resp.text


def pick_download_url(html: str, size: str) -> tuple[str, str]:
    originals = RE_ORIGINAL.findall(html)
    if not originals:
        raise ValueError("未在页面中找到原图地址，页面结构可能已变更")

    # 同一作品通常只对应一个 upload 路径，取出现次数最多的
    base_url = max(set(originals), key=originals.count)

    if size == "original":
        return base_url, "原图"

    desktop_match = RE_DESKTOP.search(html)
    if size == "desktop" and desktop_match:
        return desktop_match.group(1), "电脑横屏 3840x2160"

    oss_resize = {
        "desktop": "w_3840,h_2160",
        "mobile": "w_978,h_2160",
        "standard": "w_1920,h_1080",
    }
    if size in oss_resize:
        suffix = (
            f"?x-oss-process=image/auto-orient,1/interlace,1/"
            f"resize,m_fill,{oss_resize[size]}"
        )
        label = {"desktop": "电脑横屏", "mobile": "手机竖屏", "standard": "普通尺寸"}[size]
        return base_url + suffix, label

    raise ValueError(f"不支持的尺寸: {size}")


def filename_from_url(url: str, post_id: str, label: str) -> str:
    path = urlparse(url).path
    ext = Path(path).suffix or ".png"
    safe_label = re.sub(r"[^\w\u4e00-\u9fff-]+", "_", label).strip("_")
    return f"bizhihui_{post_id}_{safe_label}{ext}"


def download_via_curl(url: str, dest: Path) -> None:
    curl = shutil.which("curl") or shutil.which("curl.exe")
    if not curl:
        raise RuntimeError("未找到 curl，无法回退下载")

    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        curl,
        "-fsSL",
        "--retry",
        "3",
        "--retry-delay",
        "2",
        "-A",
        USER_AGENT,
        "-o",
        str(dest),
        url,
    ]
    subprocess.run(cmd, check=True)


def download_file(session: requests.Session, url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        with session.get(url, stream=True, timeout=120) as resp:
            resp.raise_for_status()
            total = int(resp.headers.get("Content-Length", 0))
            downloaded = 0
            with dest.open("wb") as f:
                for chunk in resp.iter_content(chunk_size=1024 * 256):
                    if not chunk:
                        continue
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total:
                        pct = downloaded * 100 // total
                        print(
                            f"\r下载中… {pct}% ({downloaded // 1024} / {total // 1024} KB)",
                            end="",
                        )
    except SSLError:
        print("requests SSL 失败，改用 curl 下载…")
        download_via_curl(url, dest)
    print(f"\n已保存: {dest.resolve()}")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="壁纸汇单页壁纸下载")
    parser.add_argument(
        "url",
        nargs="?",
        default="https://www.bizhihui.com/p/23329.html",
        help="壁纸详情页 URL",
    )
    parser.add_argument(
        "-o",
        "--output-dir",
        default="downloads",
        help="保存目录（默认: downloads）",
    )
    parser.add_argument(
        "--size",
        default="original",
        choices=sorted(SIZE_ALIASES.values()),
        help="尺寸: original | desktop | mobile | standard",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    size = SIZE_ALIASES.get(args.size.lower(), args.size.lower())

    post_match = RE_POST_ID.search(args.url)
    post_id = post_match.group(1) if post_match else "unknown"

    session = build_session()
    print(f"抓取页面: {args.url}")
    html = fetch_page(session, args.url)

    title_match = RE_TITLE.search(html)
    if title_match:
        print(f"标题: {title_match.group(1).strip()}")

    download_url, label = pick_download_url(html, size)
    print(f"下载链接 ({label}): {download_url}")

    out_dir = Path(args.output_dir)
    filename = filename_from_url(download_url, post_id, label)
    dest = out_dir / filename

    download_file(session, download_url, dest)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except requests.RequestException as exc:
        print(f"网络错误: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
    except ValueError as exc:
        print(f"解析错误: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
