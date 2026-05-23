#!/usr/bin/env python3
"""Load 2t58.com cookies into requests.Session from file or local Edge profile."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import requests

DEFAULT_COOKIE_FILE = "2t58_cookies.json"
SITE_ORIGIN = "https://www.2t58.com"


def _apply_cookie_dicts(session: requests.Session, cookies: list[dict[str, Any]]) -> int:
    count = 0
    for item in cookies:
        name = str(item.get("name", "")).strip()
        value = str(item.get("value", "")).strip()
        if not name:
            continue
        domain = str(item.get("domain", ".2t58.com")).strip() or ".2t58.com"
        path = str(item.get("path", "/")).strip() or "/"
        session.cookies.set(name, value, domain=domain.lstrip("."), path=path)
        count += 1
    return count


def load_cookies_from_json(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and "cookies" in data:
        data = data["cookies"]
    if not isinstance(data, list):
        raise ValueError(f"invalid cookie json format: {path}")
    return data


def parse_cookie_header(header: str) -> list[dict[str, Any]]:
    """Parse a raw Cookie request header copied from DevTools."""
    cookies: list[dict[str, Any]] = []
    for part in header.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        name, value = part.split("=", 1)
        name = name.strip()
        value = value.strip()
        if not name:
            continue
        cookies.append(
            {"name": name, "value": value, "domain": ".2t58.com", "path": "/"}
        )
    return cookies


def save_cookies_json(cookies: list[dict[str, Any]], path: Path) -> None:
    path.write_text(json.dumps(cookies, ensure_ascii=False, indent=2), encoding="utf-8")


def export_cookies_from_cdp(cdp_url: str = "http://127.0.0.1:9222") -> list[dict[str, Any]]:
    """Read cookies from your already-open Edge (not Playwright automation)."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(cdp_url)
        if not browser.contexts:
            raise RuntimeError("CDP 已连接但没有浏览器上下文，请先在 Edge 中打开任意页面")
        cookies: list[dict[str, Any]] = []
        for context in browser.contexts:
            cookies.extend(context.cookies(SITE_ORIGIN))
            cookies.extend(context.cookies("http://www.2t58.com"))
        # 不要 browser.close()，避免关掉用户正在用的 Edge
    # de-dupe by name+domain
    seen: set[tuple[str, str]] = set()
    uniq: list[dict[str, Any]] = []
    for c in cookies:
        key = (c.get("name", ""), c.get("domain", ""))
        if key in seen or not key[0]:
            continue
        seen.add(key)
        uniq.append(c)
    return uniq


def load_cookies_from_edge() -> list[dict[str, Any]]:
    try:
        import browser_cookie3
    except ImportError as ex:
        raise RuntimeError(
            "需要 browser-cookie3 才能读取 Edge Cookie，请执行: pip install browser-cookie3"
        ) from ex

    cookies: list[dict[str, Any]] = []
    jar = browser_cookie3.edge(domain_name="2t58.com")
    for c in jar:
        if "2t58" not in (c.domain or ""):
            continue
        cookies.append(
            {
                "name": c.name,
                "value": c.value,
                "domain": c.domain,
                "path": c.path or "/",
            }
        )
    return cookies


def export_cookies_from_playwright_profile(
    user_data_dir: Path, channel: str = "msedge"
) -> list[dict[str, Any]]:
    from playwright.sync_api import sync_playwright

    user_data_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser_type = p.chromium
        context = browser_type.launch_persistent_context(
            user_data_dir=str(user_data_dir),
            channel=channel,
            headless=True,
            args=["--disable-blink-features=AutomationControlled"],
        )
        try:
            page = context.new_page()
            page.goto(SITE_ORIGIN, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(800)
            return context.cookies(SITE_ORIGIN)
        finally:
            context.close()


def attach_2t58_cookies(
    session: requests.Session,
    *,
    cookies_file: Path | None = None,
    use_edge_cookies: bool = True,
    user_data_dir: Path | None = None,
    channel: str = "msedge",
) -> str:
    """Attach cookies to session. Returns human-readable status message."""
    candidates: list[Path] = []
    if cookies_file:
        candidates.append(cookies_file)
    default_file = Path(DEFAULT_COOKIE_FILE)
    if default_file not in candidates:
        candidates.append(default_file)

    for path in candidates:
        if path.exists():
            items = load_cookies_from_json(path)
            n = _apply_cookie_dicts(session, items)
            return f"已从 {path.name} 加载 {n} 条 Cookie"

    if user_data_dir and user_data_dir.exists():
        try:
            items = export_cookies_from_playwright_profile(user_data_dir, channel=channel)
            if items:
                n = _apply_cookie_dicts(session, items)
                save_path = Path(DEFAULT_COOKIE_FILE)
                save_path.write_text(
                    json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                return (
                    f"已从浏览器配置 {user_data_dir.name} 读取 {n} 条 Cookie，"
                    f"并保存到 {save_path.name}"
                )
        except Exception:
            pass

    if use_edge_cookies:
        try:
            items = load_cookies_from_edge()
            if not items:
                return "未在 Edge 中找到 2t58.com 的 Cookie（请先浏览器登录该站）"
            n = _apply_cookie_dicts(session, items)
            save_path = Path(DEFAULT_COOKIE_FILE)
            save_path.write_text(
                json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            return f"已从 Edge 用户配置读取 {n} 条 Cookie，并缓存到 {save_path.name}"
        except Exception as ex:
            err = str(ex)
            if "admin" in err.lower():
                return (
                    "读取 Edge Cookie 需要管理员权限；请改用 CDP: "
                    "先运行 start_edge_cdp.bat，再执行 "
                    "python export_2t58_cookies.py --cdp-url http://127.0.0.1:9222"
                )
            return f"读取 Edge Cookie 失败: {ex}"

    return (
        "未加载 Cookie（匿名 IP 可能触发 site_daily_download_limit）；"
        "请运行: python export_2t58_cookies.py --cdp-url http://127.0.0.1:9222"
    )
