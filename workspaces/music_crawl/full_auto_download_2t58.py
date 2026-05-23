#!/usr/bin/env python3
"""
Full auto downloader for 2t58 -> Quark share.

Flow:
1) Read songs from songs.txt (format: song-artist)
2) Search song page on 2t58 (reuse batch_crawl_2t58.py logic)
3) Get quark share url via https://api.5bb3.com/api.php?kid=<song_id>
4) Open quark share pages and trigger browser download by Playwright

Notes:
- Quark may require login. Use --manual-login-once for first run.
- If anti-bot / captcha appears, script will skip current item and continue.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from urllib.parse import unquote, urljoin

import requests
from playwright._impl._errors import TargetClosedError
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from batch_crawl_2t58 import QueryItem, build_session, crawl_one, parse_input
from cookie_loader import DEFAULT_COOKIE_FILE, attach_2t58_cookies
from update_pending_songs import ResultRow, print_prune_summary, prune_from_results

KUWO_REFERER = "https://www.kuwo.cn/"


@dataclass
class QuarkItem:
    query: str
    song: str
    artist: str
    song_page: str
    song_id: str
    quark_name: str
    quark_url: str
    quark_pwd: str
    web_download_url: str
    status: str
    note: str


def extract_song_id(song_page: str) -> str:
    m = re.search(r"/song/([^./?]+)\.html", song_page, flags=re.IGNORECASE)
    return m.group(1).strip() if m else ""


def extract_song_slug(song_page: str) -> str:
    return extract_song_id(song_page)


def fetch_quark_items(session: requests.Session, song_id: str) -> tuple[list[dict], str]:
    if not song_id:
        return [], "empty_song_id"
    url = f"https://api.5bb3.com/api.php?kid={song_id}"
    urls = [url, url.replace("https://", "http://")]
    last_error = ""

    for api_url in urls:
        try:
            resp = session.get(api_url, timeout=15)
            if resp.status_code != 200:
                last_error = f"api_status_{resp.status_code}@{api_url}"
                continue
            data = resp.json()
            code = int(data.get("code", 0))
            if code != 200:
                last_error = f"api_code_{code}"
                continue
            items = data.get("list") or []
            if not isinstance(items, list):
                items = []
            return items, ""
        except (requests.RequestException, json.JSONDecodeError) as ex:
            last_error = str(ex)
    return [], last_error or "api_unknown_error"


def fetch_lkid_by_song_id(
    session: requests.Session, song_id: str, referer: str
) -> tuple[str, str]:
    if not song_id:
        return "", "empty_song_id"
    api_url = "https://www.2t58.com/js/play.php"
    payload = {"id": song_id, "type": "music"}
    headers = {
        "Referer": referer,
        "Origin": "https://www.2t58.com",
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    }
    urls = [api_url, api_url.replace("https://", "http://")]
    last_error = ""
    for u in urls:
        try:
            resp = session.post(u, data=payload, headers=headers, timeout=15)
            if resp.status_code != 200:
                last_error = f"play_api_status_{resp.status_code}@{u}"
                continue
            data = resp.json()
            lkid = str(data.get("lkid", "")).strip()
            if lkid:
                return lkid, ""
            last_error = "play_api_no_lkid"
        except (requests.RequestException, json.JSONDecodeError) as ex:
            last_error = str(ex)
    return "", last_error or "play_api_unknown_error"


def collect_download_targets(
    songs: Iterable[QueryItem],
    delay: float,
    mode: str,
    session: requests.Session | None = None,
) -> list[QuarkItem]:
    session = session or build_session()
    result_rows: list[QuarkItem] = []
    song_list = list(songs)

    total = len(song_list)
    for idx, q in enumerate(song_list, start=1):
        print(f"[{idx}/{total}] crawl: {q.keyword}")
        crawl_result = crawl_one(session, q, delay=delay)
        if not crawl_result.song_page:
            reason = crawl_result.note or crawl_result.status or "unknown"
            print(f"  -> crawl失败: {crawl_result.status} | {reason}")
            result_rows.append(
                QuarkItem(
                    query=q.keyword,
                    song=q.song,
                    artist=q.artist,
                    song_page="",
                    song_id="",
                    quark_name="",
                    quark_url="",
                    quark_pwd="",
                    web_download_url="",
                    status="no_song_page",
                    note=reason,
                )
            )
            continue

        print(f"  -> crawl成功: 歌曲页 {crawl_result.song_page}")
        if crawl_result.note:
            print(f"  -> crawl备注: {crawl_result.status} | {crawl_result.note}")

        song_id = extract_song_id(crawl_result.song_page)
        lkid, lkid_err = fetch_lkid_by_song_id(
            session=session, song_id=song_id, referer=crawl_result.song_page
        )
        if not lkid:
            reason = lkid_err or "empty_lkid"
            print(f"  -> crawl失败: no_lkid | {reason}")
            result_rows.append(
                QuarkItem(
                    query=q.keyword,
                    song=q.song,
                    artist=q.artist,
                    song_page=crawl_result.song_page,
                    song_id=song_id,
                    quark_name="",
                    quark_url="",
                    quark_pwd="",
                    web_download_url="",
                    status="no_lkid",
                    note=reason,
                )
            )
            continue

        if mode == "B":
            slug = extract_song_slug(crawl_result.song_page)
            web_url = f"https://www.2t58.com/down.php?ac=music&id={slug}"
            print(f"  -> crawl成功: 网站下载页 {web_url}")
            result_rows.append(
                QuarkItem(
                    query=q.keyword,
                    song=q.song,
                    artist=q.artist,
                    song_page=crawl_result.song_page,
                    song_id=lkid,
                    quark_name="website_mp3",
                    quark_url="",
                    quark_pwd="",
                    web_download_url=web_url,
                    status="web_link_ready",
                    note="",
                )
            )
            time.sleep(delay)
            continue

        items, err = fetch_quark_items(session, lkid)
        if not items:
            reason = err or "empty_list"
            print(f"  -> crawl失败: no_quark_link | {reason}")
            result_rows.append(
                QuarkItem(
                    query=q.keyword,
                    song=q.song,
                    artist=q.artist,
                    song_page=crawl_result.song_page,
                    song_id=lkid,
                    quark_name="",
                    quark_url="",
                    quark_pwd="",
                    web_download_url="",
                    status="no_quark_link",
                    note=reason,
                )
            )
            continue

        quark_url = str(items[0].get("url", "")).strip()
        print(f"  -> crawl成功: 夸克链接 {quark_url or '(空)'}")

        for item in items:
            result_rows.append(
                QuarkItem(
                    query=q.keyword,
                    song=q.song,
                    artist=q.artist,
                    song_page=crawl_result.song_page,
                    song_id=lkid,
                    quark_name=str(item.get("name", "")).strip(),
                    quark_url=str(item.get("url", "")).strip(),
                    quark_pwd=str(item.get("pwd", "")).strip(),
                    web_download_url=f"https://www.2t58.com/plug/down.php?ac=music&id={lkid}",
                    status="quark_link_ready",
                    note="",
                )
            )
        time.sleep(delay)
    return result_rows


def _click_first(locator, timeout_ms: int = 2500) -> bool:
    count = locator.count()
    if count < 1:
        return False
    for i in range(min(count, 3)):
        try:
            locator.nth(i).click(timeout=timeout_ms)
            return True
        except Exception:
            continue
    return False


def _all_frames(page):
    # Include main frame + child frames (some quark pages render controls in iframe).
    frames = [page.main_frame]
    for frame in page.frames:
        if frame != page.main_frame:
            frames.append(frame)
    return frames


def _js_click_by_keywords(frame, keywords: list[str]) -> bool:
    script = """
    (words) => {
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 2 && rect.height > 2;
      };
      const nodes = Array.from(document.querySelectorAll('button, span, div, a'));
      for (const el of nodes) {
        const txt = (el.innerText || el.textContent || '').trim();
        if (!txt) continue;
        if (!words.some(w => txt.includes(w))) continue;
        if (!isVisible(el)) continue;
        try {
          el.click();
          return true;
        } catch (e) {}
      }
      return false;
    }
    """
    try:
        return bool(frame.evaluate(script, keywords))
    except Exception:
        return False


def _click_download_button(page, timeout_ms: int = 2500) -> bool:
    selectors = [
        "div.share-download",
        "span.share-download-text",
        "button:has-text('下载')",
        "button.ant-btn span:has-text('下载')",
        "div:has-text('下载'):visible",
        "span:has-text('下载')",
        "[class*='download']:visible",
    ]
    for frame in _all_frames(page):
        for sel in selectors:
            try:
                if _click_first(frame.locator(sel), timeout_ms=timeout_ms):
                    return True
            except Exception:
                continue
        if _js_click_by_keywords(frame, ["下载", "高速下载"]):
            return True
    return False


def _click_second_download_button(page, timeout_ms: int = 2500) -> bool:
    selectors = [
        "button:has-text('浏览器下载')",
        "button:has-text('普通下载')",
        "button:has-text('下载到本地')",
        "button:has-text('立即下载')",
        "div:has-text('浏览器下载'):visible",
        "span:has-text('浏览器下载')",
    ]
    for frame in _all_frames(page):
        for sel in selectors:
            try:
                if _click_first(frame.locator(sel), timeout_ms=timeout_ms):
                    return True
            except Exception:
                continue
        if _js_click_by_keywords(frame, ["浏览器下载", "普通下载", "下载到本地", "立即下载"]):
            return True
    return False


def _click_website_download_button(page, timeout_ms: int = 2500) -> bool:
    selectors = [
        "a#btn-download-mp3",
        "a[href*='/plug/down.php?ac=music&id=']",
        "a[href*='/down.php?ac=music&id=']",
        "a:has-text('本地MP3免费下载')",
        "a:has-text('MP3下载')",
        "a.lkiv",
        "a.lklan",
    ]
    for frame in _all_frames(page):
        for sel in selectors:
            try:
                if _click_first(frame.locator(sel), timeout_ms=timeout_ms):
                    return True
            except Exception:
                continue
        if _js_click_by_keywords(frame, ["本地MP3免费下载", "MP3下载"]):
            return True
    return False


def _looks_like_net_error_page(page) -> bool:
    try:
        html = page.content()
    except Exception:
        return False
    markers = [
        "ERR_TIMED_OUT",
        "ERR_CONNECTION",
        "无法访问此页面",
        "响应时间太长",
        "This page isn’t working",
        "took too long to respond",
    ]
    return any(m in html for m in markers)


def _filename_from_response(resp: requests.Response, fallback: str) -> str:
    cd = resp.headers.get("Content-Disposition", "")
    m = re.search(r"filename\*?=(?:UTF-8''|\"?)([^\";]+)", cd, flags=re.IGNORECASE)
    if m:
        name = unquote(m.group(1).strip().strip('"'))
        if name:
            return name
    url_part = resp.url.split("/")[-1].split("?")[0]
    if url_part.lower().endswith((".mp3", ".flac", ".m4a", ".wav", ".aac")):
        return url_part
    return fallback


def _site_error_from_html(html: str) -> str:
    """Only match real block responses (short alert pages), not normal down.php HTML."""
    compact = html.replace(" ", "")
    if "alert(" in compact and (
        "下载次数" in compact or "已达上限" in compact or "次数已用完" in compact
    ):
        return "site_daily_download_limit"
    if "接口请求失败" in html:
        return "site_api_failed"
    if "alert(" in compact and "location.href='/'" in compact and len(html) < 800:
        return "site_download_blocked"
    return ""


def _extract_mp3_button_url(html: str, base_url: str) -> str:
    """Match the green 'MP3下载' button: btn-download-mp3 -> plug/down.php?...&k=320."""
    patterns = [
        r"""id=["']btn-download-mp3["'][^>]*href=["']([^"']+)["']""",
        r"""href=["']([^"']+)["'][^>]*\bid=["']btn-download-mp3["']""",
    ]
    for pat in patterns:
        m = re.search(pat, html, flags=re.IGNORECASE)
        if m:
            return urljoin(base_url, m.group(1).strip())

    for link in re.findall(r"""plug/down\.php\?ac=music[^"'<\s]+""", html, flags=re.IGNORECASE):
        if "k=320" in link:
            return urljoin(base_url, link)
    return ""


def _extract_mp3_download_filename(html: str) -> str:
    m = re.search(
        r"""id=["']btn-download-mp3["'][^>]*download=["']([^"']+)["']""",
        html,
        flags=re.IGNORECASE,
    )
    if m:
        name = m.group(1).strip()
        if name.lower().endswith(".mp3"):
            return name
    return ""


def _is_mp3_binary(url: str, resp: requests.Response) -> bool:
    lower = url.lower()
    if ".m4a" in lower or ".aac" in lower:
        return False
    if ".mp3" in lower or "/m800" in lower:
        return True
    ctype = (resp.headers.get("Content-Type") or "").lower()
    return "audio/mpeg" in ctype or "audio/mp3" in ctype


def _resolve_download_target(
    session: requests.Session, url: str, referer: str
) -> tuple[requests.Response | None, str, str]:
    """Return (response, cdn_url, error). response set when body is the file."""
    try:
        resp = session.get(
            url, headers={"Referer": referer}, timeout=60, allow_redirects=False
        )
    except requests.RequestException as ex:
        return None, "", str(ex)

    if resp.status_code in (301, 302, 303, 307, 308):
        loc = (resp.headers.get("Location") or "").strip()
        if loc:
            return None, urljoin(url, loc), ""
        return None, "", f"redirect_without_location_{resp.status_code}"

    ctype = (resp.headers.get("Content-Type") or "").lower()
    if resp.status_code == 200 and len(resp.content) > 4096:
        if "audio" in ctype or "octet-stream" in ctype:
            return resp, "", ""
        if not resp.content[:1].startswith(b"<"):
            return resp, "", ""

    if resp.status_code == 200 and resp.text[:1].startswith("<"):
        err = _site_error_from_html(resp.text)
        if err:
            return None, "", err
        mp3 = _extract_mp3_button_url(resp.text, resp.url)
        if mp3:
            return None, mp3, ""
        return None, "", "html_page_but_no_mp3_link"

    return None, "", f"http_{resp.status_code}"


def _download_binary(
    session: requests.Session, url: str, referer: str
) -> tuple[requests.Response | None, str]:
    try:
        resp = session.get(url, headers={"Referer": referer}, timeout=120, allow_redirects=True)
    except requests.RequestException as ex:
        return None, str(ex)
    if resp.status_code != 200 or len(resp.content) < 4096:
        return None, f"cdn_http_{resp.status_code}_len_{len(resp.content)}"
    return resp, ""


def download_from_website_http(
    rows: list[QuarkItem],
    download_dir: Path,
    delay: float,
    session: requests.Session | None = None,
) -> None:
    """Mode B via HTTP: down.php -> plug/down.php&k=320 -> kuwo CDN (Referer=kuwo.cn)."""
    download_dir.mkdir(parents=True, exist_ok=True)
    session = session or build_session()

    for idx, row in enumerate(rows, start=1):
        if not row.song_page:
            row.status = "skip_no_web_url"
            row.note = "empty_song_page"
            continue

        print(f"[{idx}/{len(rows)}] http: {row.query}")
        song_page = row.song_page
        slug = extract_song_slug(song_page)
        if not slug:
            row.status = "download_failed"
            row.note = "no_song_slug"
            print(f"  -> failed: {row.note}")
            continue

        try:
            session.get(song_page, timeout=20)
        except requests.RequestException as ex:
            row.status = "download_failed"
            row.note = f"song_page_error: {ex}"
            print(f"  -> failed: {row.note}")
            time.sleep(delay)
            continue

        down_page_url = f"https://www.2t58.com/down.php?ac=music&id={slug}"
        if row.web_download_url and "down.php" in row.web_download_url:
            down_page_url = row.web_download_url

        last_error = ""
        downloaded = False
        file_resp: requests.Response | None = None

        try:
            page_resp = session.get(
                down_page_url, headers={"Referer": song_page}, timeout=30
            )
            if page_resp.status_code != 200:
                last_error = f"down_page_http_{page_resp.status_code}"
            else:
                plug_url = _extract_mp3_button_url(page_resp.text, down_page_url)
                page_err = _site_error_from_html(page_resp.text)
                if not plug_url:
                    last_error = page_err or "html_page_but_no_mp3_button"
                elif "k=320" not in plug_url:
                    last_error = f"mp3_button_not_320k: {plug_url}"
                else:
                    print(f"  -> MP3(320): {plug_url}")
                    direct, cdn_url, resolve_err = _resolve_download_target(
                        session, plug_url, down_page_url
                    )
                    if resolve_err:
                        last_error = resolve_err
                    elif direct is not None:
                        if _is_mp3_binary(getattr(direct, "url", plug_url), direct):
                            file_resp = direct
                        else:
                            last_error = "cdn_not_mp3_preview_rejected"
                    elif cdn_url:
                        if cdn_url.startswith("http") and "kuwo.cn" in cdn_url:
                            if ".m4a" in cdn_url.lower():
                                last_error = "cdn_redirected_to_m4a_not_mp3"
                            else:
                                file_resp, cdn_err = _download_binary(
                                    session, cdn_url, KUWO_REFERER
                                )
                                if cdn_err:
                                    last_error = cdn_err
                                elif file_resp and not _is_mp3_binary(
                                    file_resp.url, file_resp
                                ):
                                    file_resp = None
                                    last_error = "cdn_not_mp3_preview_rejected"
                        else:
                            nested, nested_cdn, nested_err = _resolve_download_target(
                                session, cdn_url, down_page_url
                            )
                            if nested is not None:
                                if _is_mp3_binary(getattr(nested, "url", cdn_url), nested):
                                    file_resp = nested
                                else:
                                    last_error = "cdn_not_mp3_preview_rejected"
                            elif nested_cdn:
                                if ".m4a" in nested_cdn.lower():
                                    last_error = "cdn_redirected_to_m4a_not_mp3"
                                else:
                                    file_resp, cdn_err = _download_binary(
                                        session, nested_cdn, KUWO_REFERER
                                    )
                                    if cdn_err:
                                        last_error = cdn_err
                                    elif file_resp and not _is_mp3_binary(
                                        file_resp.url, file_resp
                                    ):
                                        file_resp = None
                                        last_error = "cdn_not_mp3_preview_rejected"
                            else:
                                last_error = nested_err or "nested_resolve_failed"

            if file_resp is not None:
                suggested = _extract_mp3_download_filename(page_resp.text)
                if suggested:
                    safe = re.sub(r'[\\/:*?"<>|]+', "_", suggested)
                else:
                    fallback = f"{row.song}-{row.artist}_{slug}.mp3"
                    safe = re.sub(r'[\\/:*?"<>|]+', "_", fallback)
                target = download_dir / safe
                target.write_bytes(file_resp.content)
                row.status = "downloaded"
                row.note = str(target)
                print(f"  -> downloaded (MP3 320k): {target}")
                downloaded = True
        except requests.RequestException as ex:
            last_error = str(ex)

        if not downloaded:
            row.status = "download_failed"
            row.note = last_error or "http_download_failed"
            print(f"  -> failed: {row.note}")

        time.sleep(delay)


def _goto_with_fallback(page, url: str, timeout_ms: int, retries: int = 2) -> tuple[str, str]:
    candidates = [url]
    if url.startswith("https://"):
        candidates.append("http://" + url[len("https://") :])
    elif url.startswith("http://"):
        candidates.append("https://" + url[len("http://") :])

    last_error = ""
    for u in candidates:
        for attempt in range(1, retries + 1):
            try:
                page.goto(u, wait_until="domcontentloaded", timeout=timeout_ms)
                page.wait_for_timeout(900)
                if _looks_like_net_error_page(page):
                    raise RuntimeError("ERR_TIMED_OUT/页面错误")
                return u, ""
            except Exception as ex:
                last_error = f"{ex} @ {u} (try {attempt}/{retries})"
    return "", last_error or "goto_failed"


def _open_browser_for_download(
    p,
    user_data_dir: Path,
    download_dir: Path,
    channel: str,
    cdp_url: str,
    cdp_required: bool,
):
    browser_type = p.chromium
    browser = None
    context = None
    page = None
    mode = "persistent"

    if cdp_url:
        try:
            diag_url = cdp_url.rstrip("/") + "/json/version"
            try:
                probe = requests.get(diag_url, timeout=5)
                print(f"[info] CDP探测: {diag_url} -> HTTP {probe.status_code}")
            except Exception as probe_ex:
                print(f"[warn] CDP探测失败: {probe_ex}")

            browser = browser_type.connect_over_cdp(cdp_url, timeout=30000)
            if browser.contexts:
                context = browser.contexts[0]
            else:
                context = browser.new_context(
                    accept_downloads=True,
                    downloads_path=str(download_dir),
                )
            page = context.new_page()
            mode = "cdp"
            print(f"[info] 已连接现有 Edge(CDP): {cdp_url}")
            return browser, context, page, mode
        except Exception as ex:
            if cdp_required:
                raise RuntimeError(f"连接现有 Edge(CDP)失败: {ex}") from ex
            print(f"[warn] 连接现有 Edge(CDP)失败，将回退到自动启动模式: {ex}")

    try:
        context = browser_type.launch_persistent_context(
            user_data_dir=str(user_data_dir),
            headless=False,
            channel=channel,
            accept_downloads=True,
            downloads_path=str(download_dir),
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = context.new_page()
        mode = "persistent"
    except TargetClosedError as ex:
        print(f"[warn] 持久化浏览器启动失败，将自动切换临时会话模式: {ex}")
        mode = "ephemeral"
        browser = browser_type.launch(
            headless=False,
            channel=channel,
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = browser.new_context(
            accept_downloads=True,
            downloads_path=str(download_dir),
        )
        page = context.new_page()
    return browser, context, page, mode


def download_from_website_rows(
    rows: list[QuarkItem],
    user_data_dir: Path,
    download_dir: Path,
    channel: str,
    timeout_sec: int,
    cdp_url: str,
    cdp_required: bool,
) -> None:
    download_dir.mkdir(parents=True, exist_ok=True)
    timeout_ms = timeout_sec * 1000

    with sync_playwright() as p:
        browser, context, page, launch_mode = _open_browser_for_download(
            p=p,
            user_data_dir=user_data_dir,
            download_dir=download_dir,
            channel=channel,
            cdp_url=cdp_url,
            cdp_required=cdp_required,
        )

        for idx, row in enumerate(rows, start=1):
            if not row.song_page:
                row.status = "skip_no_song_page"
                row.note = row.note or "empty_song_page"
                continue

            print(f"[{idx}/{len(rows)}] website: {row.query} -> {row.song_page}")
            used_url, open_err = _goto_with_fallback(page, row.song_page, timeout_ms=timeout_ms)
            if not used_url:
                row.status = "open_song_page_failed"
                row.note = open_err
                print(f"  -> failed: {open_err}")
                continue

            try:
                with context.expect_event("download", timeout=15000) as dl_info:
                    page.wait_for_timeout(1200)
                    clicked = _click_website_download_button(page, timeout_ms=3000)
                    if not clicked and row.web_download_url:
                        web_used_url, _ = _goto_with_fallback(
                            page, row.web_download_url, timeout_ms=timeout_ms
                        )
                        if web_used_url:
                            page.wait_for_timeout(800)
                            clicked = _click_website_download_button(page, timeout_ms=3000)
                    if not clicked:
                        raise RuntimeError("未找到网站MP3下载按钮")

                download = dl_info.value
                suggested = download.suggested_filename or f"{row.song_id}.bin"
                safe_name = re.sub(r"[\\\\/:*?\"<>|]+", "_", suggested)
                target_path = download_dir / safe_name
                download.save_as(str(target_path))
                row.status = "downloaded"
                row.note = str(target_path)
                print(f"  -> downloaded: {target_path}")
            except PlaywrightTimeoutError:
                if row.web_download_url:
                    try:
                        with context.expect_event("download", timeout=10000) as dl_info:
                            web_used_url, web_err = _goto_with_fallback(
                                page, row.web_download_url, timeout_ms=timeout_ms
                            )
                            if not web_used_url:
                                raise RuntimeError(web_err)
                        download = dl_info.value
                        suggested = download.suggested_filename or f"{row.song_id}.bin"
                        safe_name = re.sub(r"[\\\\/:*?\"<>|]+", "_", suggested)
                        target_path = download_dir / safe_name
                        download.save_as(str(target_path))
                        row.status = "downloaded"
                        row.note = str(target_path)
                        print(f"  -> downloaded: {target_path}")
                        page.wait_for_timeout(1000)
                        continue
                    except Exception:
                        pass
                row.status = "download_timeout"
                row.note = "未在超时时间内捕获浏览器下载事件"
                print("  -> timeout (no browser download event)")
            except Exception as ex:
                row.status = "download_failed"
                row.note = str(ex)
                print(f"  -> failed: {ex}")

            page.wait_for_timeout(1000)

        if launch_mode != "cdp":
            context.close()
        if browser is not None and launch_mode != "cdp":
            browser.close()


def download_from_quark_rows(
    rows: list[QuarkItem],
    user_data_dir: Path,
    download_dir: Path,
    channel: str,
    timeout_sec: int,
    manual_login_once: bool,
    cdp_url: str,
    cdp_required: bool,
) -> None:
    download_dir.mkdir(parents=True, exist_ok=True)
    timeout_ms = timeout_sec * 1000

    with sync_playwright() as p:
        browser, context, page, launched_mode = _open_browser_for_download(
            p=p,
            user_data_dir=user_data_dir,
            download_dir=download_dir,
            channel=channel,
            cdp_url=cdp_url,
            cdp_required=cdp_required,
        )

        if manual_login_once:
            _goto_with_fallback(page, "https://pan.quark.cn/", timeout_ms=timeout_ms)
            if launched_mode in {"persistent", "cdp"}:
                input("请在打开的浏览器中先登录夸克网盘，完成后回车继续...")
            else:
                input("当前为临时会话模式，请本轮先登录夸克网盘，完成后回车继续...")

        for idx, row in enumerate(rows, start=1):
            if not row.quark_url:
                row.status = "skip_no_quark_url"
                row.note = row.note or "empty_quark_url"
                continue

            print(f"[{idx}/{len(rows)}] quark: {row.query} -> {row.quark_url}")
            used_url, open_err = _goto_with_fallback(page, row.quark_url, timeout_ms=timeout_ms)
            if not used_url:
                row.status = "open_quark_failed"
                row.note = open_err
                print(f"  -> failed: {open_err}")
                continue

            # Handle extraction code page.
            if row.quark_pwd:
                code_input = page.locator(
                    "input[placeholder*='提取码'], input[placeholder*='请输入提取码']"
                )
                if code_input.count() > 0:
                    try:
                        code_input.first.fill(row.quark_pwd, timeout=2000)
                        _click_first(page.locator("button:has-text('提取'), button:has-text('确认')"))
                        page.wait_for_timeout(1200)
                    except Exception:
                        pass

            # Ensure file selected if there is checkbox.
            _click_first(
                page.locator(
                    "label:has-text('文件名') input[type='checkbox'], "
                    "tr input[type='checkbox'], "
                    "div[class*='file'] input[type='checkbox']"
                ),
                timeout_ms=1200,
            )

            try:
                with page.expect_download(timeout=15000) as dl_info:
                    page.wait_for_timeout(1800)
                    clicked = _click_download_button(page, timeout_ms=3000)
                    if not clicked:
                        raise RuntimeError("未找到下载按钮")

                    # Some pages need second click: browser download or normal download.
                    page.wait_for_timeout(1200)
                    _click_second_download_button(page, timeout_ms=2500)

                download = dl_info.value
                suggested = download.suggested_filename or f"{row.song_id}.bin"
                safe_name = re.sub(r"[\\\\/:*?\"<>|]+", "_", suggested)
                target_path = download_dir / safe_name
                download.save_as(str(target_path))
                row.status = "downloaded"
                row.note = str(target_path)
                print(f"  -> downloaded: {target_path}")
            except PlaywrightTimeoutError:
                row.status = "download_timeout"
                row.note = "未在超时时间内捕获浏览器下载事件"
                print("  -> timeout (no browser download event)")
            except Exception as ex:
                row.status = "download_failed"
                row.note = str(ex)
                print(f"  -> failed: {ex}")

            page.wait_for_timeout(1000)

        if launched_mode != "cdp":
            context.close()
        if browser is not None and launched_mode != "cdp":
            browser.close()


def write_rows_csv(path: Path, rows: Iterable[QuarkItem]) -> None:
    fieldnames = [
        "query",
        "song",
        "artist",
        "song_page",
        "song_id",
        "quark_name",
        "quark_url",
        "quark_pwd",
        "web_download_url",
        "status",
        "note",
    ]
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row.__dict__)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Full auto pipeline: songs.txt -> quark links -> auto browser downloads"
    )
    parser.add_argument("--input", default="songs.txt", help="Input txt, one line: song-artist")
    parser.add_argument("--output", default="quark_results.csv", help="Output csv status")
    parser.add_argument("--delay", type=float, default=0.8, help="Delay between network requests")
    parser.add_argument(
        "--download-dir",
        default="downloads",
        help="Downloaded files directory",
    )
    parser.add_argument(
        "--user-data-dir",
        default=".pw-quark-profile",
        help="Playwright persistent profile dir (keeps login state)",
    )
    parser.add_argument(
        "--channel",
        default="msedge",
        help="Browser channel for Playwright, e.g. msedge/chrome",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=40,
        help="Page timeout in seconds",
    )
    parser.add_argument(
        "--manual-login-once",
        action="store_true",
        help="Open quark homepage and wait for manual login before batch downloading",
    )
    parser.add_argument(
        "--links-only",
        action="store_true",
        help="Only collect links; do not open browser download",
    )
    parser.add_argument(
        "--mode",
        choices=["ask", "A", "B"],
        default="ask",
        help="Download mode: A=网盘下载(夸克), B=网站下载(本地MP3), ask=启动时询问",
    )
    parser.add_argument(
        "--cdp-url",
        default="",
        help="连接已打开Edge调试地址，例如 http://127.0.0.1:9222",
    )
    parser.add_argument(
        "--cdp-required",
        action="store_true",
        help="要求必须连接现有Edge(CDP)，失败则直接退出，不回退新开浏览器",
    )
    parser.add_argument(
        "--b-method",
        choices=["http", "browser"],
        default="http",
        help="模式B下载方式: http=直连下载(推荐,不打开浏览器), browser=浏览器点击下载",
    )
    parser.add_argument(
        "--no-prune-songs",
        action="store_true",
        help="下载完成后不自动从 songs.txt 移除已成功的歌曲",
    )
    parser.add_argument(
        "--cookies-file",
        default="",
        help=f"2t58 Cookie JSON（默认自动使用 ./{DEFAULT_COOKIE_FILE}）",
    )
    parser.add_argument(
        "--use-edge-cookies",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="HTTP 模式从本机 Edge 读取已登录 Cookie（默认开启）",
    )
    parser.add_argument(
        "--use-proxy",
        action="store_true",
        help="使用系统代理(HTTP_PROXY等)。默认关闭，避免代理IP触发本站限流",
    )
    return parser


def choose_mode(mode_arg: str) -> str:
    if mode_arg in {"A", "B"}:
        return mode_arg
    while True:
        selected = input("请选择下载模式 [A=网盘下载, B=网站下载] (默认A): ").strip().upper()
        if not selected:
            return "A"
        if selected in {"A", "B"}:
            return selected
        print("输入无效，请输入 A 或 B。")


def main() -> None:
    parser = build_arg_parser()
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        raise SystemExit(f"Input file not found: {input_path}")

    songs = parse_input(input_path)
    if not songs:
        raise SystemExit("No valid song rows in input file.")

    mode = choose_mode(args.mode)
    mode_label = "网盘下载" if mode == "A" else "网站下载"
    if mode == "B":
        mode_label += f" ({'HTTP直连' if args.b_method == 'http' else '浏览器点击'})"
    print(f"当前下载模式: {mode} ({mode_label})")
    session = build_session(use_proxy=args.use_proxy)
    if args.use_proxy:
        print("[info] 已启用系统代理 (trust_env=True)")
    else:
        print("[info] 未使用系统代理 (避免代理IP被2t58限流)")
    if mode == "B" and args.b_method == "http":
        print("[info] 模式B使用HTTP直连（携带浏览器 Cookie，走 MP3 320k 按钮）")
        cookie_path = Path(args.cookies_file) if args.cookies_file else None
        cookie_msg = attach_2t58_cookies(
            session,
            cookies_file=cookie_path,
            use_edge_cookies=args.use_edge_cookies,
            user_data_dir=Path(args.user_data_dir),
            channel=args.channel,
        )
        print(f"[info] {cookie_msg}")
    rows = collect_download_targets(songs, delay=args.delay, mode=mode, session=session)
    output_path = Path(args.output)

    if not args.links_only:
        if mode == "A":
            download_from_quark_rows(
                rows=rows,
                user_data_dir=Path(args.user_data_dir),
                download_dir=Path(args.download_dir),
                channel=args.channel,
                timeout_sec=args.timeout,
                manual_login_once=args.manual_login_once,
                cdp_url=args.cdp_url,
                cdp_required=args.cdp_required,
            )
        elif args.b_method == "http":
            download_from_website_http(
                rows=rows,
                download_dir=Path(args.download_dir),
                delay=args.delay,
                session=session,
            )
        else:
            download_from_website_rows(
                rows=rows,
                user_data_dir=Path(args.user_data_dir),
                download_dir=Path(args.download_dir),
                channel=args.channel,
                timeout_sec=args.timeout,
                cdp_url=args.cdp_url,
                cdp_required=args.cdp_required,
            )

    write_rows_csv(output_path, rows)
    total = len(rows)
    ok = sum(1 for r in rows if r.status == "downloaded")
    ready_quark = sum(1 for r in rows if r.status == "quark_link_ready")
    ready_web = sum(1 for r in rows if r.status == "web_link_ready")
    print(
        f"Done. total={total}, downloaded={ok}, quark_links={ready_quark}, "
        f"web_links={ready_web}, csv={output_path.resolve()}"
    )

    if not args.links_only and not args.no_prune_songs and ok > 0:
        result_rows = [
            ResultRow(query=r.query, status=r.status, note=r.note or "") for r in rows
        ]
        _, pending_count = prune_from_results(input_path.resolve(), result_rows)
        print_prune_summary(result_rows, pending_count)


if __name__ == "__main__":
    main()
