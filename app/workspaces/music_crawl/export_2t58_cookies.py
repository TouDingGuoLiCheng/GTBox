#!/usr/bin/env python3
"""Export 2t58 cookies for HTTP mode.

2t58 blocks Playwright automated navigation (timeout). Recommended:
  1) start_edge_cdp.bat  -> login on 2t58 in Edge
  2) python export_2t58_cookies.py --cdp-url http://127.0.0.1:9222
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from batch_crawl_2t58 import build_session
from cookie_loader import (
    DEFAULT_COOKIE_FILE,
    attach_2t58_cookies,
    export_cookies_from_cdp,
    parse_cookie_header,
    save_cookies_json,
)

SITE_URL = "https://www.2t58.com/"


def _write_and_report(items: list[dict], out: Path) -> None:
    if not items:
        raise SystemExit(
            "未获取到 2t58 Cookie。请先在 Edge 中打开并登录 "
            f"{SITE_URL}，再重试。"
        )
    save_cookies_json(items, out)
    print(f"已写入 {out.resolve()}（{len(items)} 条 Cookie）")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="导出 2t58.com Cookie（供 HTTP 模式 B 使用）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
推荐步骤（Playwright 自动打开 2t58 常被站点拦截超时）:
  1. 双击 start_edge_cdp.bat（先关掉所有 Edge）
  2. 在 Edge 里手动打开并登录 https://www.2t58.com/
  3. python export_2t58_cookies.py --cdp-url http://127.0.0.1:9222

备选:
  python export_2t58_cookies.py --from-edge   （需关闭 Edge，可能需管理员）
  python export_2t58_cookies.py --paste-cookie  （从 DevTools 粘贴 Cookie 头）
        """.strip(),
    )
    parser.add_argument("--output", default=DEFAULT_COOKIE_FILE, help="输出 JSON")
    parser.add_argument(
        "--cdp-url",
        default="",
        help="从已打开的 Edge 读取，例如 http://127.0.0.1:9222",
    )
    parser.add_argument(
        "--from-edge",
        action="store_true",
        help="从本机 Edge 配置读取（需先完全关闭 Edge）",
    )
    parser.add_argument(
        "--paste-cookie",
        action="store_true",
        help="手动粘贴 DevTools 里复制的 Cookie 请求头",
    )
    parser.add_argument(
        "--cookie-file",
        default="",
        help="从文本文件读取 Cookie 头（与 --paste-cookie 合用）",
    )
    parser.add_argument(
        "--open-login",
        action="store_true",
        help="尝试 Playwright 打开浏览器（2t58 可能超时，不推荐）",
    )
    parser.add_argument("--user-data-dir", default=".pw-quark-profile")
    parser.add_argument("--channel", default="msedge")
    args = parser.parse_args()
    out = Path(args.output)

    if args.paste_cookie or args.cookie_file:
        if args.cookie_file:
            raw = Path(args.cookie_file).read_text(encoding="utf-8").strip()
        else:
            print("请粘贴 DevTools -> Network -> 任意 2t58 请求 -> Request Headers -> Cookie")
            print("粘贴后按回车，再按 Ctrl+Z 并回车结束输入：")
            raw = sys.stdin.read().strip()
        items = parse_cookie_header(raw)
        _write_and_report(items, out)
        return

    if args.cdp_url:
        print(f"正在连接 Edge CDP: {args.cdp_url}")
        try:
            items = export_cookies_from_cdp(args.cdp_url)
        except Exception as ex:
            if "ECONNREFUSED" in str(ex) or "9222" in str(ex):
                raise SystemExit(
                    "无法连接 127.0.0.1:9222（Edge 未以调试模式运行）。\n\n"
                    "请按顺序操作:\n"
                    "  1. 关闭所有 Edge（任务管理器结束 msedge.exe）\n"
                    "  2. 双击运行: start_edge_cdp.bat\n"
                    "  3. 等窗口提示 [成功] 后，在 Edge 打开 https://www.2t58.com/\n"
                    "  4. 再执行: py -3.11 export_2t58_cookies.py --cdp-url http://127.0.0.1:9222\n\n"
                    "或改用粘贴 Cookie: py -3.11 export_2t58_cookies.py --paste-cookie"
                ) from ex
            raise
        _write_and_report(items, out)
        return

    if args.from_edge:
        session = build_session()
        msg = attach_2t58_cookies(session, use_edge_cookies=True)
        print(msg)
        if out.exists():
            print(f"Cookie 文件: {out.resolve()}")
        return

    if args.open_login:
        from playwright.sync_api import sync_playwright

        profile = Path(args.user_data_dir)
        profile.mkdir(parents=True, exist_ok=True)
        print(
            "[提示] 2t58 常会拦截自动化浏览器导致超时。\n"
            "若失败请改用: start_edge_cdp.bat + --cdp-url http://127.0.0.1:9222\n"
        )
        with sync_playwright() as p:
            context = p.chromium.launch_persistent_context(
                user_data_dir=str(profile),
                channel=args.channel,
                headless=False,
                args=["--disable-blink-features=AutomationControlled"],
            )
            page = context.new_page()
            try:
                page.goto(SITE_URL, wait_until="domcontentloaded", timeout=15000)
            except Exception as ex:
                print(f"[warn] 自动打开失败: {ex}")
                print(f"请在弹出的浏览器地址栏手动打开: {SITE_URL}")
            input("登录完成后回车导出 Cookie...")
            items = context.cookies(SITE_URL)
            context.close()
        _write_and_report(items, out)
        return

    # 默认：尝试本机 9222 CDP
    cdp = "http://127.0.0.1:9222"
    print(f"未指定方式，尝试连接 {cdp} ...")
    print("（若失败请先运行 start_edge_cdp.bat 并在 Edge 登录 2t58）\n")
    try:
        items = export_cookies_from_cdp(cdp)
        _write_and_report(items, out)
    except Exception as ex:
        raise SystemExit(
            f"CDP 连接失败: {ex}\n\n"
            "请按顺序操作:\n"
            "  1. 关闭所有 Edge\n"
            "  2. 双击项目里的 start_edge_cdp.bat\n"
            f"  3. 在 Edge 打开并登录 {SITE_URL}\n"
            "  4. python export_2t58_cookies.py --cdp-url http://127.0.0.1:9222"
        ) from ex


if __name__ == "__main__":
    main()
