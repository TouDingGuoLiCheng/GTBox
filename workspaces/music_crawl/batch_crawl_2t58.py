#!/usr/bin/env python3
"""
Batch crawler for 2t58.com

Usage:
  python batch_crawl_2t58.py --input songs.txt --output results.csv

Input format (one per line):
  Song Name-Artist
"""

from __future__ import annotations

import argparse
import csv
import html as html_lib
import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from urllib.parse import quote, urljoin

import requests


BASE_URL = "https://www.2t58.com"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


@dataclass
class QueryItem:
    song: str
    artist: str

    @property
    def keyword(self) -> str:
        return f"{self.song}-{self.artist}".strip("-").strip()


@dataclass
class CrawlResult:
    query: str
    song: str
    artist: str
    matched_title: str
    matched_artist: str
    song_page: str
    media_url: str
    status: str
    note: str


def build_session(use_proxy: bool = False) -> requests.Session:
    session = requests.Session()
    session.trust_env = use_proxy
    session.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Connection": "keep-alive",
        }
    )
    return session


def get_with_fallback(
    session: requests.Session,
    url: str,
    timeout: int = 15,
    extra_headers: dict[str, str] | None = None,
) -> tuple[requests.Response | None, str]:
    urls = [url]
    if url.startswith("https://"):
        urls.append("http://" + url[len("https://") :])
    elif url.startswith("http://"):
        urls.append("https://" + url[len("http://") :])

    last_error = ""
    for u in urls:
        try:
            resp = session.get(u, timeout=timeout, headers=extra_headers)
            if resp.status_code == 200:
                return resp, ""
            last_error = f"http_status_{resp.status_code}@{u}"
        except requests.RequestException as ex:
            last_error = str(ex)
    return None, last_error


def parse_input(path: Path) -> list[QueryItem]:
    items: list[QueryItem] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip().lstrip("\ufeff")
        if not line or line.startswith("#"):
            continue
        if "-" not in line:
            song = line
            artist = ""
        else:
            song, artist = line.split("-", 1)
        items.append(QueryItem(song=song.strip(), artist=artist.strip()))
    return items


def search_url(keyword: str) -> str:
    return f"{BASE_URL}/so/{quote(keyword)}.html"


def _clean_text(value: str) -> str:
    # Strip tags + normalize whitespace for simple text extraction.
    text = re.sub(r"<[^>]+>", " ", value)
    text = html_lib.unescape(text)
    return " ".join(text.split())


def parse_search_results(html: str, page_url: str) -> list[dict[str, str]]:
    candidates: list[dict[str, str]] = []
    # First try list item blocks, then generic anchor fallback.
    li_blocks = re.findall(r"<li\b[^>]*>.*?</li>", html, flags=re.IGNORECASE | re.DOTALL)
    anchor_pat = re.compile(
        r"""<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)</a>""",
        flags=re.IGNORECASE | re.DOTALL,
    )

    def parse_block(block: str) -> None:
        for href, anchor_html in anchor_pat.findall(block):
            if "/song/" not in href and not href.endswith(".html"):
                continue
            title = _clean_text(anchor_html)
            if not title:
                continue
            full = urljoin(page_url, href.strip())
            block_text = _clean_text(block)
            artist = ""
            m = re.search(r"-\s*([^-|/]+)$", block_text)
            if m:
                artist = m.group(1).strip()
            candidates.append({"title": title, "artist": artist, "song_page": full})
            break

    for li in li_blocks:
        parse_block(li)

    if not candidates:
        for href, anchor_html in anchor_pat.findall(html):
            if "/song/" not in href:
                continue
            title = _clean_text(anchor_html)
            if not title:
                continue
            candidates.append(
                {
                    "title": title,
                    "artist": "",
                    "song_page": urljoin(page_url, href.strip()),
                }
            )

    # De-duplicate by URL while preserving order.
    seen: set[str] = set()
    uniq: list[dict[str, str]] = []
    for c in candidates:
        if c["song_page"] in seen:
            continue
        seen.add(c["song_page"])
        uniq.append(c)
    return uniq


def score_candidate(query: QueryItem, candidate: dict[str, str]) -> int:
    q_song = query.song.lower()
    q_artist = query.artist.lower()
    t = candidate.get("title", "").lower()
    a = candidate.get("artist", "").lower()
    score = 0
    if q_song and q_song in t:
        score += 8
    if q_artist and (q_artist in t or q_artist in a):
        score += 5
    if query.keyword.lower() in t:
        score += 4
    return score


def pick_best_candidate(query: QueryItem, candidates: list[dict[str, str]]) -> dict[str, str] | None:
    if not candidates:
        return None
    ranked = sorted(candidates, key=lambda c: score_candidate(query, c), reverse=True)
    return ranked[0]


def extract_media_url(html: str, page_url: str) -> str:
    # 1) Direct media sources.
    src_patterns = [
        r"""<audio[^>]*\bsrc=["']([^"']+)["']""",
        r"""<audio[^>]*>.*?<source[^>]*\bsrc=["']([^"']+)["']""",
    ]
    for pattern in src_patterns:
        m = re.search(pattern, html, flags=re.IGNORECASE | re.DOTALL)
        if m and m.group(1).strip():
            return urljoin(page_url, m.group(1).strip())

    # 2) Links to media resources.
    for m in re.finditer(
        r"""<a\b[^>]*href=["']([^"']+)["'][^>]*>""",
        html,
        flags=re.IGNORECASE | re.DOTALL,
    ):
        href = m.group(1).strip()
        if re.search(r"\.(mp3|flac|m4a|aac|wav)(\?|$)", href, flags=re.IGNORECASE):
            return urljoin(page_url, href)

    # 3) Script-based URL fields
    patterns = [
        r"""(?:url|src|songurl|mp3|music)\s*[:=]\s*["']([^"']+\.(?:mp3|flac|m4a|aac|wav)[^"']*)["']""",
        r"""["'](https?://[^"']+\.(?:mp3|flac|m4a|aac|wav)[^"']*)["']""",
    ]
    for pattern in patterns:
        m = re.search(pattern, html, flags=re.IGNORECASE)
        if m:
            return urljoin(page_url, m.group(1).strip())

    return ""


def extract_song_id(html: str, page_url: str) -> str:
    # Pattern from page js: player("music","ZHdreG5jaGtu");
    m = re.search(
        r"""player\(\s*["']music["']\s*,\s*["']([^"']+)["']\s*\)""",
        html,
        flags=re.IGNORECASE,
    )
    if m:
        return m.group(1).strip()

    m = re.search(r"/song/([^./?]+)\.html", page_url, flags=re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return ""


def fetch_media_url_by_api(
    session: requests.Session, song_id: str, referer: str
) -> tuple[str, str]:
    if not song_id:
        return "", "no_song_id"

    api_url = f"{BASE_URL}/js/play.php"
    headers = {
        "Referer": referer,
        "Origin": BASE_URL,
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    }
    payload = {"id": song_id, "type": "music"}

    urls = [api_url, api_url.replace("https://", "http://")]
    last_error = ""
    for u in urls:
        try:
            resp = session.post(u, data=payload, headers=headers, timeout=15)
            if resp.status_code != 200:
                last_error = f"play_api_status_{resp.status_code}@{u}"
                continue
            try:
                data = resp.json()
            except json.JSONDecodeError:
                last_error = "play_api_non_json"
                continue
            media = str(data.get("url", "")).strip()
            if media:
                return media, ""
            last_error = "play_api_no_url"
        except requests.RequestException as ex:
            last_error = str(ex)
    return "", last_error


def crawl_one(session: requests.Session, query: QueryItem, delay: float) -> CrawlResult:
    q = query.keyword
    s_url = search_url(q)
    r, search_err = get_with_fallback(session, s_url, timeout=15)
    if r is None:
        return CrawlResult(
            query=q,
            song=query.song,
            artist=query.artist,
            matched_title="",
            matched_artist="",
            song_page="",
            media_url="",
            status="search_error",
            note=search_err,
        )

    candidates = parse_search_results(r.text, s_url)
    best = pick_best_candidate(query, candidates)
    if not best:
        return CrawlResult(
            query=q,
            song=query.song,
            artist=query.artist,
            matched_title="",
            matched_artist="",
            song_page="",
            media_url="",
            status="no_result",
            note="search_page_parsed_but_no_song_link",
        )

    time.sleep(delay)
    page_url = best["song_page"]
    page_headers = {"Referer": s_url}
    p, page_err = get_with_fallback(session, page_url, timeout=15, extra_headers=page_headers)
    if p is None:
        return CrawlResult(
            query=q,
            song=query.song,
            artist=query.artist,
            matched_title=best.get("title", ""),
            matched_artist=best.get("artist", ""),
            song_page=page_url,
            media_url="",
            status="song_page_error",
            note=page_err,
        )

    song_id = extract_song_id(p.text, page_url)
    media_url, api_note = fetch_media_url_by_api(session, song_id=song_id, referer=page_url)
    if not media_url:
        media_url = extract_media_url(p.text, page_url)

    if media_url:
        status = "ok"
        note = ""
    else:
        status = "media_not_found"
        note = api_note or "song_page_retrieved_but_no_media_url"
    return CrawlResult(
        query=q,
        song=query.song,
        artist=query.artist,
        matched_title=best.get("title", ""),
        matched_artist=best.get("artist", ""),
        song_page=page_url,
        media_url=media_url,
        status=status,
        note=note,
    )


def write_csv(path: Path, rows: Iterable[CrawlResult]) -> None:
    fieldnames = [
        "query",
        "song",
        "artist",
        "matched_title",
        "matched_artist",
        "song_page",
        "media_url",
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
        description="Batch crawl 2t58 song URLs by keyword format: song-artist"
    )
    parser.add_argument(
        "--input",
        default="songs.txt",
        help="Input txt file, one query per line, format: song-artist",
    )
    parser.add_argument(
        "--output",
        default="results.csv",
        help="Output csv path",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.6,
        help="Sleep seconds between requests to reduce anti-bot risk",
    )
    return parser


def main() -> None:
    parser = build_arg_parser()
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        raise SystemExit(f"Input file not found: {input_path}")

    queries = parse_input(input_path)
    if not queries:
        raise SystemExit("No valid query in input file.")

    session = build_session()
    results: list[CrawlResult] = []
    total = len(queries)
    for idx, q in enumerate(queries, start=1):
        print(f"[{idx}/{total}] searching: {q.keyword}")
        result = crawl_one(session, q, delay=args.delay)
        results.append(result)
        if result.status == "ok":
            print(f"  -> ok | {result.media_url or result.song_page}")
        else:
            reason = result.note or "无详情"
            extra = result.song_page or result.media_url or ""
            print(f"  -> crawl失败: {result.status} | {reason}" + (f" | {extra}" if extra else ""))

    output_path = Path(args.output)
    write_csv(output_path, results)
    ok_count = sum(1 for r in results if r.status == "ok")
    print(f"\nDone. success={ok_count}/{total}, csv={output_path.resolve()}")


if __name__ == "__main__":
    main()
