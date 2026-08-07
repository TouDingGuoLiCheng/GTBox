from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
import tempfile
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

USER_AGENT = "GTBox-McModUpdater/0.1 (contact: local-toolbox)"
MODRINTH_VERSION_FILES = "https://api.modrinth.com/v2/version_files"
MODRINTH_PROJECTS = "https://api.modrinth.com/v2/projects"
MODRINTH_PROJECT_VERSIONS = "https://api.modrinth.com/v2/project/{id}/version"
MODRINTH_VERSION = "https://api.modrinth.com/v2/version/{id}"
CF_FINGERPRINTS = "https://api.curseforge.com/v1/fingerprints/432"
CF_MOD_FILES = "https://api.curseforge.com/v1/mods/{mod_id}/files"
CF_MOD = "https://api.curseforge.com/v1/mods/{mod_id}"
CF_DOWNLOAD_URL = "https://api.curseforge.com/v1/mods/{mod_id}/files/{file_id}/download-url"

LOADER_TO_CF = {
    "forge": 1,
    "fabric": 4,
    "quilt": 5,
    "neoforge": 6,
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="MineCraft mod updater")
    parser.add_argument(
        "--action",
        default="scan",
        choices=["scan", "check", "update", "deps", "install-deps", "rollback", "dedupe"],
    )
    parser.add_argument("--mods-path", default="")
    parser.add_argument("--mc-version", default="")
    parser.add_argument("--loader", default="forge")
    parser.add_argument("--backup-enabled", action="store_true")
    parser.add_argument("--backup-dir", default="mods_backup")
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--curseforge-api-key", default="")
    parser.add_argument("--only", default="", help="comma-separated jar file names")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="for dedupe: actually delete lower versions (default dry-run)",
    )
    return parser


def emit(line: str) -> None:
    print(line, flush=True)


def murmur2_32(data: bytes, seed: int = 1) -> int:
    length = len(data)
    m = 0x5BD1E995
    r = 24
    h = seed ^ length
    i = 0
    while length >= 4:
        k = data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24)
        k = (k * m) & 0xFFFFFFFF
        k ^= k >> r
        k = (k * m) & 0xFFFFFFFF
        h = (h * m) & 0xFFFFFFFF
        h ^= k
        i += 4
        length -= 4
    if length == 3:
        h ^= data[i + 2] << 16
    if length >= 2:
        h ^= data[i + 1] << 8
    if length >= 1:
        h ^= data[i]
        h = (h * m) & 0xFFFFFFFF
    h ^= h >> 13
    h = (h * m) & 0xFFFFFFFF
    h ^= h >> 15
    return h & 0xFFFFFFFF


def hash_file(path: Path) -> dict[str, Any]:
    sha1 = hashlib.sha1()
    sha512 = hashlib.sha512()
    filtered_parts: list[bytes] = []
    size = 0
    with path.open("rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            sha1.update(chunk)
            sha512.update(chunk)
            filtered_parts.append(bytes(b for b in chunk if b not in (9, 10, 13, 32)))
    filtered = b"".join(filtered_parts)
    return {
        "sha1": sha1.hexdigest(),
        "sha512": sha512.hexdigest(),
        "fingerprint": murmur2_32(filtered, seed=1),
        "size": size,
    }


def _requests_headers(extra: dict[str, str] | None = None, cf_key: str = "") -> dict[str, str]:
    headers = {
        "Accept": "application/json",
        "User-Agent": USER_AGENT,
    }
    if extra:
        headers.update(extra)
    if cf_key:
        headers["x-api-key"] = cf_key
    return headers


def _retry_after_seconds(headers: Any, attempt: int) -> float:
    raw = ""
    try:
        raw = str(headers.get("Retry-After") or headers.get("retry-after") or "")
    except Exception:  # noqa: BLE001
        raw = ""
    if raw.isdigit():
        return min(30.0, float(raw))
    return min(20.0, 1.5 * (2**attempt))


def http_json(
    method: str,
    url: str,
    timeout: int,
    payload: dict[str, Any] | None = None,
    cf_key: str = "",
    max_retries: int = 4,
) -> Any:
    headers = _requests_headers(
        {"Content-Type": "application/json"} if payload is not None else None,
        cf_key=cf_key,
    )
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    last_err: Exception | None = None
    try:
        import requests

        for attempt in range(max_retries):
            try:
                resp = requests.request(method, url, data=body, headers=headers, timeout=timeout)
                if resp.status_code == 429:
                    delay = _retry_after_seconds(resp.headers, attempt)
                    emit(f"[WARN] 429 rate limited, retry in {delay:.1f}s ({attempt + 1}/{max_retries})")
                    time.sleep(delay)
                    continue
                if resp.status_code >= 500 and attempt + 1 < max_retries:
                    delay = min(10.0, 1.0 * (2**attempt))
                    time.sleep(delay)
                    continue
                resp.raise_for_status()
                if not resp.content:
                    return {}
                return resp.json()
            except Exception as err:  # noqa: BLE001
                last_err = err
                if attempt + 1 >= max_retries:
                    raise
                time.sleep(min(8.0, 1.0 * (2**attempt)))
        if last_err:
            raise last_err
        return {}
    except ImportError:
        from urllib.error import HTTPError, URLError
        from urllib.request import Request, urlopen

        req = Request(url, data=body, headers=headers, method=method)
        for attempt in range(max_retries):
            try:
                with urlopen(req, timeout=timeout) as resp:
                    raw = resp.read().decode("utf-8")
                    return json.loads(raw) if raw else {}
            except HTTPError as err:
                last_err = err
                if err.code == 429 or (500 <= int(err.code) < 600):
                    delay = _retry_after_seconds(getattr(err, "headers", {}) or {}, attempt)
                    emit(f"[WARN] HTTP {err.code}, retry in {delay:.1f}s ({attempt + 1}/{max_retries})")
                    time.sleep(delay)
                    if attempt + 1 < max_retries:
                        continue
                raise
            except URLError as err:
                last_err = err
                if attempt + 1 >= max_retries:
                    raise
                time.sleep(min(8.0, 1.0 * (2**attempt)))
        if last_err:
            raise last_err
        return {}


def http_post_json(url: str, payload: dict[str, Any], timeout: int, cf_key: str = "") -> Any:
    return http_json("POST", url, timeout, payload=payload, cf_key=cf_key)


def http_get_json(url: str, timeout: int, cf_key: str = "") -> Any:
    return http_json("GET", url, timeout, cf_key=cf_key)


def http_download(url: str, dest: Path, timeout: int, cf_key: str = "", max_retries: int = 4) -> None:
    headers = _requests_headers(cf_key=cf_key)
    dest.parent.mkdir(parents=True, exist_ok=True)
    last_err: Exception | None = None

    def _write_stream_requests(resp: Any) -> None:
        with dest.open("wb") as out:
            for chunk in resp.iter_content(chunk_size=1024 * 256):
                if chunk:
                    out.write(chunk)

    def _write_stream_urllib(resp: Any) -> None:
        with dest.open("wb") as out:
            while True:
                chunk = resp.read(1024 * 256)
                if not chunk:
                    break
                out.write(chunk)

    try:
        import requests

        for attempt in range(max_retries):
            try:
                with requests.get(url, headers=headers, timeout=timeout, stream=True) as resp:
                    if resp.status_code == 429:
                        delay = _retry_after_seconds(resp.headers, attempt)
                        emit(
                            f"[WARN] download 429, retry in {delay:.1f}s ({attempt + 1}/{max_retries})"
                        )
                        time.sleep(delay)
                        continue
                    if resp.status_code >= 500 and attempt + 1 < max_retries:
                        time.sleep(min(10.0, 1.0 * (2**attempt)))
                        continue
                    resp.raise_for_status()
                    _write_stream_requests(resp)
                    return
            except Exception as err:  # noqa: BLE001
                last_err = err
                if dest.exists():
                    dest.unlink(missing_ok=True)
                if attempt + 1 >= max_retries:
                    raise
                time.sleep(min(8.0, 1.0 * (2**attempt)))
        if last_err:
            raise last_err
    except ImportError:
        from urllib.error import HTTPError
        from urllib.request import Request, urlopen

        req = Request(url, headers=headers, method="GET")
        for attempt in range(max_retries):
            try:
                with urlopen(req, timeout=timeout) as resp:
                    _write_stream_urllib(resp)
                    return
            except HTTPError as err:
                last_err = err
                if dest.exists():
                    dest.unlink(missing_ok=True)
                if err.code == 429 or (500 <= int(err.code) < 600):
                    delay = _retry_after_seconds(getattr(err, "headers", {}) or {}, attempt)
                    emit(f"[WARN] download HTTP {err.code}, retry in {delay:.1f}s")
                    time.sleep(delay)
                    if attempt + 1 < max_retries:
                        continue
                raise
            except Exception as err:  # noqa: BLE001
                last_err = err
                if dest.exists():
                    dest.unlink(missing_ok=True)
                if attempt + 1 >= max_retries:
                    raise
                time.sleep(min(8.0, 1.0 * (2**attempt)))
        if last_err:
            raise last_err


def list_jars(mods_path: Path) -> list[Path]:
    if not mods_path.is_dir():
        raise FileNotFoundError(f"mods path not found: {mods_path}")
    return [p for p in sorted(mods_path.iterdir()) if p.is_file() and p.suffix.lower() == ".jar"]


def _toml_first_mods_block(text: str) -> dict[str, str]:
    block = ""
    in_mods = False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("[[") and stripped.endswith("]]"):
            in_mods = stripped.lower() == "[[mods]]"
            if in_mods and block:
                break
            continue
        if in_mods:
            block += line + "\n"
    out: dict[str, str] = {}
    for key in ("modId", "version", "displayName"):
        m = re.search(rf'(?im)^\s*{key}\s*=\s*"([^"]*)"', block)
        if m:
            out[key] = m.group(1).strip()
    return out


def read_jar_mod_meta(path: Path) -> dict[str, str]:
    mod_id = ""
    version = ""
    name = ""
    try:
        with zipfile.ZipFile(path, "r") as zf:
            names = set(zf.namelist())
            if "fabric.mod.json" in names:
                data = json.loads(zf.read("fabric.mod.json").decode("utf-8-sig"))
                mod_id = str(data.get("id") or "")
                version = str(data.get("version") or "")
                name = str(data.get("name") or "")
            elif "quilt.mod.json" in names:
                data = json.loads(zf.read("quilt.mod.json").decode("utf-8-sig"))
                quilt = data.get("quilt_loader") if isinstance(data.get("quilt_loader"), dict) else {}
                mod_id = str(quilt.get("id") or data.get("id") or "")
                version = str(quilt.get("version") or data.get("version") or "")
                meta = quilt.get("metadata") if isinstance(quilt.get("metadata"), dict) else {}
                name = str(meta.get("name") or data.get("name") or "")
            else:
                for candidate in ("META-INF/mods.toml", "META-INF/neoforge.mods.toml"):
                    if candidate not in names:
                        continue
                    text = zf.read(candidate).decode("utf-8-sig", errors="replace")
                    parsed = _toml_first_mods_block(text)
                    mod_id = parsed.get("modId", "")
                    version = parsed.get("version", "")
                    name = parsed.get("displayName", "")
                    break
    except Exception:  # noqa: BLE001
        pass
    return {"modId": mod_id.strip(), "version": version.strip(), "name": name.strip()}


def parse_version_parts(version: str) -> tuple[Any, ...]:
    text = (version or "").strip().lower()
    if not text or text == "-":
        return ((2, ""),)
    parts = re.findall(r"\d+|[a-z]+", text)
    if not parts:
        return ((2, text),)
    out: list[tuple[int, Any]] = []
    for p in parts:
        if p.isdigit():
            out.append((0, int(p)))
        else:
            out.append((1, p))
    return tuple(out)


def is_placeholder_version(version: str) -> bool:
    v = (version or "").strip()
    return (not v) or v == "-" or "${" in v


def resolve_mod_version(row: dict[str, Any], meta: dict[str, str]) -> str:
    jar_ver = (meta.get("version") or "").strip()
    if not is_placeholder_version(jar_ver):
        return jar_ver
    state_ver = str(row.get("currentVersion") or "").strip()
    if not is_placeholder_version(state_ver):
        return state_ver
    return Path(str(row.get("fileName") or "")).stem or "-"


def identity_key(row: dict[str, Any], meta: dict[str, str]) -> str | None:
    mod_id = (meta.get("modId") or "").strip().lower()
    if mod_id:
        return f"modid:{mod_id}"
    project_id = str(row.get("projectId") or "").strip()
    platform = str(row.get("platform") or "").strip().lower()
    if project_id and platform:
        return f"{platform}:{project_id}"
    return None


def rank_mod_candidate(version: str, path: Path) -> tuple[Any, ...]:
    try:
        mtime = path.stat().st_mtime
        size = path.stat().st_size
    except OSError:
        mtime = 0.0
        size = 0
    return (parse_version_parts(version), mtime, size)


def chunked(items: list[Any], size: int) -> list[list[Any]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def parse_only(raw: str) -> set[str] | None:
    text = raw.strip()
    if not text:
        return None
    return {x.strip().lower() for x in text.split(",") if x.strip()}


def state_path() -> Path:
    return Path("mods_state.json")


def load_state() -> list[dict[str, Any]]:
    path = state_path()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:  # noqa: BLE001
        return []


def save_state(rows: list[dict[str, Any]]) -> None:
    state_path().write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")


def lookup_modrinth(sha1_list: list[str], timeout: int) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for batch in chunked(sha1_list, 64):
        if not batch:
            continue
        data = http_post_json(
            MODRINTH_VERSION_FILES,
            {"hashes": batch, "algorithm": "sha1"},
            timeout=timeout,
        )
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, dict):
                    result[key.lower()] = value
    return result


def fetch_project_titles(project_ids: list[str], timeout: int) -> dict[str, str]:
    titles: dict[str, str] = {}
    unique = sorted({pid for pid in project_ids if pid})
    for batch in chunked(unique, 64):
        if not batch:
            continue
        ids_param = quote(json.dumps(batch), safe="")
        url = f"{MODRINTH_PROJECTS}?ids={ids_param}"
        data = http_get_json(url, timeout=timeout)
        if isinstance(data, list):
            for item in data:
                if not isinstance(item, dict):
                    continue
                pid = str(item.get("id") or "")
                title = str(item.get("title") or item.get("slug") or pid)
                if pid:
                    titles[pid] = title
    return titles


def lookup_curseforge(
    fingerprints: list[int],
    timeout: int,
    cf_key: str,
) -> dict[int, dict[str, Any]]:
    result: dict[int, dict[str, Any]] = {}
    if not cf_key or not fingerprints:
        return result
    for batch in chunked(fingerprints, 100):
        data = http_post_json(
            CF_FINGERPRINTS,
            {"fingerprints": batch},
            timeout=timeout,
            cf_key=cf_key,
        )
        matches = (data or {}).get("data", {}).get("exactMatches", []) if isinstance(data, dict) else []
        for item in matches:
            if not isinstance(item, dict):
                continue
            fp = int(item.get("id") or 0)
            file_info = item.get("file") or {}
            if fp and isinstance(file_info, dict):
                result[fp] = file_info
    return result


def cf_mod_name(mod_id: int, timeout: int, cf_key: str) -> str:
    try:
        data = http_get_json(CF_MOD.format(mod_id=mod_id), timeout=timeout, cf_key=cf_key)
        name = ((data or {}).get("data") or {}).get("name")
        return str(name) if name else str(mod_id)
    except Exception:  # noqa: BLE001
        return str(mod_id)


def parse_iso(ts: str) -> float:
    if not ts:
        return 0.0
    text = ts.strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text).timestamp()
    except ValueError:
        return 0.0


def pick_primary_modrinth_file(version: dict[str, Any]) -> dict[str, Any] | None:
    files = version.get("files") or []
    if not isinstance(files, list) or not files:
        return None
    for f in files:
        if isinstance(f, dict) and f.get("primary"):
            return f
    first = files[0]
    return first if isinstance(first, dict) else None


def latest_modrinth_candidate(
    project_id: str,
    mc_version: str,
    loader: str,
    timeout: int,
) -> dict[str, Any] | None:
    if not project_id:
        return None
    gv = quote(json.dumps([mc_version]), safe="")
    loaders = quote(json.dumps([loader.lower()]), safe="")
    url = f"{MODRINTH_PROJECT_VERSIONS.format(id=project_id)}?game_versions={gv}&loaders={loaders}"
    data = http_get_json(url, timeout=timeout)
    if not isinstance(data, list) or not data:
        return None
    best: dict[str, Any] | None = None
    best_ts = -1.0
    for ver in data:
        if not isinstance(ver, dict):
            continue
        ts = parse_iso(str(ver.get("date_published") or ""))
        if ts >= best_ts:
            best_ts = ts
            best = ver
    if not best:
        return None
    primary = pick_primary_modrinth_file(best)
    if not primary:
        return None
    hashes = primary.get("hashes") or {}
    deps = best.get("dependencies") if isinstance(best.get("dependencies"), list) else []
    return {
        "platform": "Modrinth",
        "projectId": project_id,
        "version": str(best.get("version_number") or "-"),
        "published": str(best.get("date_published") or ""),
        "sha1": str((hashes or {}).get("sha1") or "").lower(),
        "sha512": str((hashes or {}).get("sha512") or "").lower(),
        "downloadUrl": str(primary.get("url") or ""),
        "fileName": str(primary.get("filename") or ""),
        "fileId": "",
        "dependencies": deps,
        "versionId": str(best.get("id") or ""),
    }


def modrinth_version_by_id(version_id: str, timeout: int) -> dict[str, Any] | None:
    if not version_id:
        return None
    data = http_get_json(MODRINTH_VERSION.format(id=version_id), timeout=timeout)
    if not isinstance(data, dict):
        return None
    primary = pick_primary_modrinth_file(data)
    if not primary:
        return None
    hashes = primary.get("hashes") or {}
    return {
        "platform": "Modrinth",
        "projectId": str(data.get("project_id") or ""),
        "version": str(data.get("version_number") or "-"),
        "published": str(data.get("date_published") or ""),
        "sha1": str((hashes or {}).get("sha1") or "").lower(),
        "sha512": str((hashes or {}).get("sha512") or "").lower(),
        "downloadUrl": str(primary.get("url") or ""),
        "fileName": str(primary.get("filename") or ""),
        "fileId": "",
        "dependencies": data.get("dependencies") if isinstance(data.get("dependencies"), list) else [],
        "versionId": str(data.get("id") or version_id),
    }


def latest_curseforge_candidate(
    mod_id: int,
    mc_version: str,
    loader: str,
    timeout: int,
    cf_key: str,
) -> dict[str, Any] | None:
    if not mod_id or not cf_key:
        return None
    loader_type = LOADER_TO_CF.get(loader.lower(), 1)
    url = (
        f"{CF_MOD_FILES.format(mod_id=mod_id)}"
        f"?gameVersion={quote(mc_version)}&modLoaderType={loader_type}&pageSize=50"
    )
    data = http_get_json(url, timeout=timeout, cf_key=cf_key)
    files = (data or {}).get("data") if isinstance(data, dict) else None
    if not isinstance(files, list) or not files:
        return None
    best: dict[str, Any] | None = None
    best_ts = -1.0
    for f in files:
        if not isinstance(f, dict):
            continue
        ts = parse_iso(str(f.get("fileDate") or ""))
        if ts >= best_ts:
            best_ts = ts
            best = f
    if not best:
        return None
    hashes = best.get("hashes") or []
    sha1 = ""
    if isinstance(hashes, list):
        for h in hashes:
            if isinstance(h, dict) and int(h.get("algo") or 0) == 1:
                sha1 = str(h.get("value") or "").lower()
                break
    return {
        "platform": "CurseForge",
        "projectId": str(mod_id),
        "version": str(best.get("displayName") or best.get("fileName") or "-"),
        "published": str(best.get("fileDate") or ""),
        "sha1": sha1,
        "sha512": "",
        "downloadUrl": str(best.get("downloadUrl") or ""),
        "fileName": str(best.get("fileName") or ""),
        "fileId": str(best.get("id") or ""),
    }


def choose_newer(a: dict[str, Any] | None, b: dict[str, Any] | None) -> dict[str, Any] | None:
    if a and not b:
        return a
    if b and not a:
        return b
    if not a and not b:
        return None
    assert a and b
    ta = parse_iso(str(a.get("published") or ""))
    tb = parse_iso(str(b.get("published") or ""))
    return a if ta >= tb else b


def action_scan(args: argparse.Namespace) -> int:
    mods_path = Path(args.mods_path.strip())
    if not args.mods_path.strip():
        emit("[ERROR] mods path is required")
        return 2

    try:
        jars = list_jars(mods_path)
    except FileNotFoundError as err:
        emit(f"[ERROR] {err}")
        return 2

    total = len(jars)
    emit(f"[SCAN] found {total} jars in {mods_path}")
    emit("[PROGRESS] 0 scanning jars")

    if total == 0:
        save_state([])
        emit("[SUMMARY] scanned=0 matched=0 unmatched=0")
        emit("[DONE] scan completed")
        return 0

    concurrency = max(1, min(int(args.concurrency or 4), 16))
    timeout = max(5, int(args.timeout or 30))
    cf_key = args.curseforge_api_key.strip()
    hashed: dict[str, dict[str, Any]] = {}
    done = 0

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = {pool.submit(hash_file, jar): jar for jar in jars}
        for fut in as_completed(futures):
            jar = futures[fut]
            name = jar.name
            emit(f"[JAR] {name}")
            try:
                info = fut.result()
                hashed[name] = {"fileName": name, "path": str(jar), **info}
            except Exception as err:  # noqa: BLE001
                emit(f"[UNMATCH] {name} :: hash failed: {err}")
                hashed[name] = {
                    "fileName": name,
                    "path": str(jar),
                    "sha1": "",
                    "sha512": "",
                    "fingerprint": 0,
                    "size": 0,
                    "error": str(err),
                }
            done += 1
            percent = min(45, int(done / total * 45))
            emit(f"[PROGRESS] {percent} hashed {done}/{total}")

    sha1_list = [v["sha1"] for v in hashed.values() if v.get("sha1")]
    emit(f"[PROGRESS] 50 querying Modrinth ({len(sha1_list)} hashes)")
    matched_by_sha1: dict[str, dict[str, Any]] = {}
    try:
        matched_by_sha1 = lookup_modrinth(sha1_list, timeout=timeout)
    except Exception as err:  # noqa: BLE001
        emit(f"[WARN] Modrinth lookup failed: {err}")

    fingerprints = [int(v["fingerprint"]) for v in hashed.values() if v.get("fingerprint")]
    cf_by_fp: dict[int, dict[str, Any]] = {}
    if cf_key:
        emit(f"[PROGRESS] 62 querying CurseForge ({len(fingerprints)} fingerprints)")
        try:
            cf_by_fp = lookup_curseforge(fingerprints, timeout=timeout, cf_key=cf_key)
        except Exception as err:  # noqa: BLE001
            emit(f"[WARN] CurseForge lookup failed: {err}")

    project_ids = [str(v.get("project_id") or "") for v in matched_by_sha1.values()]
    titles: dict[str, str] = {}
    try:
        titles = fetch_project_titles(project_ids, timeout=timeout)
    except Exception as err:  # noqa: BLE001
        emit(f"[WARN] Modrinth project titles failed: {err}")

    matched = 0
    unmatched = 0
    state_rows: list[dict[str, Any]] = []
    cf_name_cache: dict[int, str] = {}

    for name in sorted(hashed.keys(), key=lambda s: s.lower()):
        info = hashed[name]
        sha1 = str(info.get("sha1") or "").lower()
        fp = int(info.get("fingerprint") or 0)
        version = matched_by_sha1.get(sha1)
        if version:
            project_id = str(version.get("project_id") or "")
            current_version = str(version.get("version_number") or "-")
            mod_name = titles.get(project_id) or str(version.get("name") or name)
            matched += 1
            emit(f"[MATCH] {name} :: Modrinth|{project_id}|{current_version}|{mod_name}")
            state_rows.append(
                {
                    "fileName": name,
                    "path": info.get("path", ""),
                    "sha1": sha1,
                    "sha512": info.get("sha512", ""),
                    "fingerprint": fp,
                    "platform": "Modrinth",
                    "projectId": project_id,
                    "cfModId": "",
                    "modName": mod_name,
                    "currentVersion": current_version,
                    "targetVersion": "-",
                    "targetPlatform": "",
                    "downloadUrl": "",
                    "targetSha1": "",
                    "targetFileName": "",
                    "targetFileId": "",
                    "status": "pending",
                    "ignored": False,
                }
            )
            continue

        cf_file = cf_by_fp.get(fp) if cf_key else None
        if cf_file:
            mod_id = int(cf_file.get("modId") or 0)
            if mod_id and mod_id not in cf_name_cache:
                cf_name_cache[mod_id] = cf_mod_name(mod_id, timeout=timeout, cf_key=cf_key)
            mod_name = cf_name_cache.get(mod_id, name)
            current_version = str(cf_file.get("displayName") or cf_file.get("fileName") or "-")
            matched += 1
            emit(f"[MATCH] {name} :: CurseForge|{mod_id}|{current_version}|{mod_name}")
            state_rows.append(
                {
                    "fileName": name,
                    "path": info.get("path", ""),
                    "sha1": sha1,
                    "sha512": info.get("sha512", ""),
                    "fingerprint": fp,
                    "platform": "CurseForge",
                    "projectId": str(mod_id),
                    "cfModId": str(mod_id),
                    "modName": mod_name,
                    "currentVersion": current_version,
                    "targetVersion": "-",
                    "targetPlatform": "",
                    "downloadUrl": "",
                    "targetSha1": "",
                    "targetFileName": "",
                    "targetFileId": "",
                    "status": "pending",
                    "ignored": False,
                }
            )
            continue

        unmatched += 1
        emit(f"[UNMATCH] {name} :: not found")
        state_rows.append(
            {
                "fileName": name,
                "path": info.get("path", ""),
                "sha1": sha1,
                "sha512": info.get("sha512", ""),
                "fingerprint": fp,
                "platform": "",
                "projectId": "",
                "cfModId": "",
                "modName": name,
                "currentVersion": "-",
                "targetVersion": "-",
                "targetPlatform": "",
                "downloadUrl": "",
                "targetSha1": "",
                "targetFileName": "",
                "targetFileId": "",
                "status": "unmatched",
                "ignored": False,
            }
        )

    save_state(state_rows)
    emit("[PROGRESS] 100 scan finished")
    emit(f"[SUMMARY] scanned={total} matched={matched} unmatched={unmatched}")
    emit("[DONE] scan completed")
    return 0


def action_check(args: argparse.Namespace) -> int:
    if not args.mc_version.strip():
        emit("[ERROR] mc version is required")
        return 2
    loader = (args.loader or "").strip().lower()
    if loader not in LOADER_TO_CF:
        emit("[ERROR] loader must be forge/fabric/quilt/neoforge")
        return 2

    rows = load_state()
    if not rows and args.mods_path.strip():
        emit("[WARN] mods_state.json empty, run scan first is recommended")
    if not rows:
        emit("[ERROR] no scanned mods; please scan first")
        return 2

    only = parse_only(args.only)
    timeout = max(5, int(args.timeout or 30))
    concurrency = max(1, min(int(args.concurrency or 4), 16))
    cf_key = args.curseforge_api_key.strip()
    mc_version = args.mc_version.strip()

    ignored_map = {str(r.get("fileName") or "").lower(): bool(r.get("ignored")) for r in rows}
    work: list[dict[str, Any]] = []
    for row in rows:
        name = str(row.get("fileName") or "")
        key = name.lower()
        if not name:
            continue
        if only is not None and key not in only:
            continue
        if ignored_map.get(key) or row.get("status") == "ignored":
            continue
        work.append(row)

    total = len(work)
    emit(f"[CHECK] start total={total} mc={mc_version} loader={loader} cf={'on' if cf_key else 'off'}")
    if total == 0:
        emit("[SUMMARY] checked=0 outdated=0 upToDate=0 unmatched=0")
        emit("[DONE] check completed")
        return 0

    by_name = {str(r.get("fileName") or "").lower(): dict(r) for r in rows}
    outdated = 0
    up_to_date = 0
    unmatched = 0
    done = 0

    def check_one(row: dict[str, Any]) -> tuple[str, dict[str, Any], str, str]:
        name = str(row.get("fileName") or "")
        local_sha1 = str(row.get("sha1") or "").lower()
        platform = str(row.get("platform") or "")
        project_id = str(row.get("projectId") or "")
        cf_mod_id_raw = str(row.get("cfModId") or "")
        mr_id = project_id if platform == "Modrinth" else ""
        cf_id = int(cf_mod_id_raw or (project_id if platform == "CurseForge" else 0) or 0)

        mr_cand = None
        cf_cand = None
        try:
            if mr_id:
                mr_cand = latest_modrinth_candidate(mr_id, mc_version, loader, timeout)
        except Exception as err:  # noqa: BLE001
            return name, row, "warn", f"Modrinth check failed: {err}"
        try:
            if cf_key and cf_id:
                cf_cand = latest_curseforge_candidate(cf_id, mc_version, loader, timeout, cf_key)
            elif cf_key and not cf_id and int(row.get("fingerprint") or 0):
                # unmatched at scan: try fingerprint identify then latest
                fp = int(row.get("fingerprint") or 0)
                found = lookup_curseforge([fp], timeout=timeout, cf_key=cf_key)
                file_info = found.get(fp)
                if file_info:
                    mod_id = int(file_info.get("modId") or 0)
                    if mod_id:
                        cf_cand = latest_curseforge_candidate(
                            mod_id, mc_version, loader, timeout, cf_key
                        )
                        if cf_cand:
                            row = {
                                **row,
                                "platform": "CurseForge",
                                "projectId": str(mod_id),
                                "cfModId": str(mod_id),
                                "modName": row.get("modName") or cf_mod_name(mod_id, timeout, cf_key),
                                "currentVersion": str(
                                    file_info.get("displayName")
                                    or file_info.get("fileName")
                                    or row.get("currentVersion")
                                    or "-"
                                ),
                            }
        except Exception as err:  # noqa: BLE001
            return name, row, "warn", f"CurseForge check failed: {err}"

        chosen = choose_newer(mr_cand, cf_cand)
        if not chosen:
            next_row = {
                **row,
                "status": "unmatched",
                "targetVersion": "-",
                "targetPlatform": "",
                "downloadUrl": "",
                "targetSha1": "",
                "targetFileName": "",
                "targetFileId": "",
                "note": "no compatible version",
            }
            return name, next_row, "unmatched", "no compatible version"

        target_sha1 = str(chosen.get("sha1") or "").lower()
        target_ver = str(chosen.get("version") or "-")
        target_platform = str(chosen.get("platform") or "")
        current_ver = str(row.get("currentVersion") or "-")
        if target_sha1 and local_sha1 and target_sha1 == local_sha1:
            next_row = {
                **row,
                "status": "up-to-date",
                "targetVersion": target_ver,
                "targetPlatform": target_platform,
                "downloadUrl": "",
                "targetSha1": target_sha1,
                "targetFileName": str(chosen.get("fileName") or ""),
                "targetFileId": str(chosen.get("fileId") or ""),
                "note": "",
            }
            return name, next_row, "up-to-date", target_ver

        next_row = {
            **row,
            "status": "outdated",
            "targetVersion": target_ver,
            "targetPlatform": target_platform,
            "downloadUrl": str(chosen.get("downloadUrl") or ""),
            "targetSha1": target_sha1,
            "targetFileName": str(chosen.get("fileName") or ""),
            "targetFileId": str(chosen.get("fileId") or ""),
            "note": "",
        }
        return name, next_row, "outdated", f"{current_ver} => {target_ver} ({target_platform})"

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = {pool.submit(check_one, row): row for row in work}
        for fut in as_completed(futures):
            done += 1
            name, next_row, kind, detail = fut.result()
            emit(f"[CHECK] {done}/{total} {name}")
            if kind == "up-to-date":
                up_to_date += 1
                emit(f"  -> up-to-date {name} :: {detail}")
            elif kind == "outdated":
                outdated += 1
                emit(f"  -> outdated {name} :: {detail}")
            elif kind == "unmatched":
                unmatched += 1
                emit(f"  -> unmatched {name} :: {detail}")
                emit(f"[UNMATCH] {name} :: {detail}")
            else:
                emit(f"  -> failed {name} :: {detail}")
                next_row = {**next_row, "status": "failed", "note": detail}
            by_name[name.lower()] = next_row
            if done % 5 == 0 or done == total:
                out_partial = [by_name.get(str(r.get("fileName") or "").lower(), r) for r in rows]
                save_state(out_partial)
            percent = min(99, int(done / total * 100))
            emit(f"[PROGRESS] {percent} checked {done}/{total}")

    # preserve ignored / non-work rows
    out_rows: list[dict[str, Any]] = []
    for row in rows:
        key = str(row.get("fileName") or "").lower()
        out_rows.append(by_name.get(key, row))
    save_state(out_rows)
    emit("[PROGRESS] 100 check finished")
    emit(
        f"[SUMMARY] checked={total} outdated={outdated} upToDate={up_to_date} unmatched={unmatched}"
    )
    emit("[DONE] check completed")
    return 0


def resolve_download_url(
    row: dict[str, Any],
    timeout: int,
    cf_key: str,
    mc_version: str = "",
    loader: str = "",
) -> tuple[str, dict[str, Any]]:
    """Return (url, row_updates). Re-query platform if url missing."""
    url = str(row.get("downloadUrl") or "").strip()
    if url:
        return url, {}

    platform = str(row.get("targetPlatform") or row.get("platform") or "")
    updates: dict[str, Any] = {}

    if platform == "CurseForge" and cf_key:
        mod_id = str(row.get("cfModId") or row.get("projectId") or "")
        file_id = str(row.get("targetFileId") or "")
        if mod_id and file_id:
            data = http_get_json(
                CF_DOWNLOAD_URL.format(mod_id=mod_id, file_id=file_id),
                timeout=timeout,
                cf_key=cf_key,
            )
            resolved = (data or {}).get("data") if isinstance(data, dict) else None
            if resolved:
                return str(resolved), updates

    if mc_version and loader:
        mr_id = str(row.get("projectId") or "") if platform == "Modrinth" else ""
        cf_id = int(row.get("cfModId") or (row.get("projectId") if platform == "CurseForge" else 0) or 0)
        mr_cand = latest_modrinth_candidate(mr_id, mc_version, loader, timeout) if mr_id else None
        cf_cand = (
            latest_curseforge_candidate(cf_id, mc_version, loader, timeout, cf_key)
            if cf_key and cf_id
            else None
        )
        chosen = choose_newer(mr_cand, cf_cand)
        if chosen:
            updates = {
                "downloadUrl": str(chosen.get("downloadUrl") or ""),
                "targetSha1": str(chosen.get("sha1") or "").lower(),
                "targetFileName": str(chosen.get("fileName") or ""),
                "targetFileId": str(chosen.get("fileId") or ""),
                "targetVersion": str(chosen.get("version") or row.get("targetVersion") or "-"),
                "targetPlatform": str(chosen.get("platform") or platform),
            }
            url = str(chosen.get("downloadUrl") or "").strip()
            if not url and chosen.get("platform") == "CurseForge" and cf_key:
                mod_id = str(chosen.get("projectId") or "")
                file_id = str(chosen.get("fileId") or "")
                if mod_id and file_id:
                    data = http_get_json(
                        CF_DOWNLOAD_URL.format(mod_id=mod_id, file_id=file_id),
                        timeout=timeout,
                        cf_key=cf_key,
                    )
                    resolved = (data or {}).get("data") if isinstance(data, dict) else None
                    if resolved:
                        url = str(resolved)
                        updates["downloadUrl"] = url
            return url, updates

    return "", updates


def last_update_path() -> Path:
    return Path("last_update.json")


def save_last_update(meta: dict[str, Any]) -> None:
    last_update_path().write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def load_last_update() -> dict[str, Any] | None:
    path = last_update_path()
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:  # noqa: BLE001
        return None


def resolve_backup_root(mods_path: Path, backup_dir: str) -> Path:
    root = Path(backup_dir.strip() or "mods_backup")
    if not root.is_absolute():
        root = mods_path.parent / root
    return root


def find_latest_backup_dir(mods_path: Path, backup_dir: str) -> Path | None:
    root = resolve_backup_root(mods_path, backup_dir)
    if not root.is_dir():
        return None
    stamps = [p for p in root.iterdir() if p.is_dir()]
    if not stamps:
        return None
    return sorted(stamps, key=lambda p: p.name)[-1]


def backup_root_for(mods_path: Path, backup_dir: str, stamp: str) -> Path:
    return resolve_backup_root(mods_path, backup_dir) / stamp


def update_one(
    row: dict[str, Any],
    mods_path: Path,
    backup_dir: Path | None,
    timeout: int,
    cf_key: str,
    mc_version: str = "",
    loader: str = "",
) -> tuple[str, dict[str, Any], str, str, str]:
    name = str(row.get("fileName") or "")
    old_path = Path(str(row.get("path") or (mods_path / name)))
    if not old_path.is_file():
        candidate = mods_path / name
        if candidate.is_file():
            old_path = candidate
        else:
            return name, row, "failed", f"local jar missing: {name}", ""

    try:
        url, url_updates = resolve_download_url(
            row, timeout=timeout, cf_key=cf_key, mc_version=mc_version, loader=loader
        )
        if url_updates:
            row = {**row, **url_updates}
    except Exception as err:  # noqa: BLE001
        return name, row, "failed", f"resolve url failed: {err}", ""
    if not url:
        return name, row, "failed", "empty download url", ""

    target_name = str(row.get("targetFileName") or "").strip() or name
    if not target_name.lower().endswith(".jar"):
        target_name = f"{target_name}.jar"
    target_sha1 = str(row.get("targetSha1") or "").lower()

    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix="mcmod_",
            suffix=".jar.part",
            dir=str(mods_path),
            delete=False,
        ) as tmp:
            tmp_path = Path(tmp.name)
        http_download(url, tmp_path, timeout=timeout, cf_key=cf_key)
        digested = hash_file(tmp_path)
        got_sha1 = str(digested.get("sha1") or "").lower()
        if target_sha1 and got_sha1 and target_sha1 != got_sha1:
            tmp_path.unlink(missing_ok=True)
            return (
                name,
                row,
                "failed",
                f"hash mismatch expect={target_sha1[:12]} got={got_sha1[:12]}",
                "",
            )

        backup_note = ""
        if backup_dir is not None:
            backup_dir.mkdir(parents=True, exist_ok=True)
            backup_path = backup_dir / old_path.name
            if backup_path.exists():
                backup_path = backup_dir / f"{old_path.stem}_{int(time.time())}{old_path.suffix}"
            shutil.move(str(old_path), str(backup_path))
            backup_note = f"{old_path} => {backup_path}"
        elif old_path.exists():
            old_path.unlink()

        final_path = mods_path / target_name
        if final_path.exists() and final_path.resolve() != tmp_path.resolve():
            final_path.unlink()
        shutil.move(str(tmp_path), str(final_path))
        tmp_path = None

        next_row = {
            **row,
            "fileName": target_name,
            "path": str(final_path),
            "sha1": got_sha1,
            "sha512": digested.get("sha512", ""),
            "fingerprint": digested.get("fingerprint", 0),
            "currentVersion": str(row.get("targetVersion") or row.get("currentVersion") or "-"),
            "status": "updated",
            "note": "",
            "downloadUrl": "",
        }
        return name, next_row, "updated", target_name, backup_note
    except Exception as err:  # noqa: BLE001
        if tmp_path is not None:
            try:
                tmp_path.unlink(missing_ok=True)
            except Exception:  # noqa: BLE001
                pass
        return name, row, "failed", str(err), ""


def action_update(args: argparse.Namespace) -> int:
    if not args.mods_path.strip():
        emit("[ERROR] mods path is required")
        return 2
    mods_path = Path(args.mods_path.strip())
    if not mods_path.is_dir():
        emit(f"[ERROR] mods path not found: {mods_path}")
        return 2

    rows = load_state()
    if not rows:
        emit("[ERROR] no scanned mods; please scan/check first")
        return 2

    only = parse_only(args.only)
    timeout = max(5, int(args.timeout or 30))
    concurrency = max(1, min(int(args.concurrency or 4), 16))
    cf_key = args.curseforge_api_key.strip()
    backup_enabled = bool(args.backup_enabled)
    mc_version = args.mc_version.strip()
    loader = (args.loader or "").strip().lower()

    work: list[dict[str, Any]] = []
    for row in rows:
        name = str(row.get("fileName") or "")
        key = name.lower()
        if not name:
            continue
        if only is not None and key not in only:
            continue
        if row.get("ignored") or row.get("status") == "ignored":
            continue
        status = str(row.get("status") or "")
        if only is not None:
            if status not in ("outdated", "failed"):
                continue
        elif status != "outdated":
            continue
        work.append(row)

    total = len(work)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_dir = backup_root_for(mods_path, args.backup_dir, stamp) if backup_enabled else None
    emit(
        f"[UPDATE] start total={total} backup={'on' if backup_enabled else 'off'}"
        + (f" dir={backup_dir}" if backup_dir else "")
    )
    if total == 0:
        emit("[SUMMARY] scanned=0 outdated=0 unmatched=0 updated=0 failed=0")
        emit("[DONE] update completed")
        return 0

    by_name = {str(r.get("fileName") or "").lower(): dict(r) for r in rows}
    updated = 0
    failed = 0
    done = 0
    state_lock = threading.Lock()
    moved_names: list[str] = []
    added_names: list[str] = []

    def persist_partial() -> None:
        out_rows: list[dict[str, Any]] = []
        seen: set[str] = set()
        for row in rows:
            key = str(row.get("fileName") or "").lower()
            if key in by_name:
                out_rows.append(by_name[key])
                seen.add(key)
        for key, row in by_name.items():
            if key not in seen:
                out_rows.append(row)
        save_state(out_rows)

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = {
            pool.submit(
                update_one, row, mods_path, backup_dir, timeout, cf_key, mc_version, loader
            ): row
            for row in work
        }
        for fut in as_completed(futures):
            done += 1
            old_name, next_row, kind, detail, backup_note = fut.result()
            emit(f"[UPDATE] {done}/{total} {old_name}")
            if backup_note:
                emit(f"  -> backup {backup_note}")
            with state_lock:
                if kind == "updated":
                    updated += 1
                    emit(f"  -> updated {detail}")
                    by_name.pop(old_name.lower(), None)
                    new_name = str(next_row.get("fileName") or old_name)
                    by_name[new_name.lower()] = next_row
                    moved_names.append(old_name)
                    if new_name.lower() != old_name.lower():
                        added_names.append(new_name)
                    else:
                        added_names.append(new_name)
                else:
                    failed += 1
                    next_row = {**next_row, "status": "failed", "note": detail}
                    emit(f"  -> failed {detail}")
                    by_name[old_name.lower()] = next_row
                persist_partial()
            percent = min(99, int(done / total * 100))
            emit(f"[PROGRESS] {percent} updated {done}/{total}")

    persist_partial()
    if backup_dir is not None or updated > 0:
        save_last_update(
            {
                "modsPath": str(mods_path),
                "backupPath": str(backup_dir) if backup_dir else "",
                "stamp": stamp,
                "movedNames": moved_names,
                "addedNames": added_names,
                "updatedAt": datetime.now().isoformat(timespec="seconds"),
            }
        )
        emit(f"[ROLLBACK-META] saved last_update.json stamp={stamp} updated={updated}")
    emit("[PROGRESS] 100 update finished")
    emit(
        f"[SUMMARY] scanned={len(rows)} outdated={total} unmatched=0 updated={updated} failed={failed}"
    )
    emit("[DONE] update completed")
    return 0 if failed == 0 else 1


def collect_missing_deps(
    rows: list[dict[str, Any]],
    mc_version: str,
    loader: str,
    timeout: int,
) -> list[dict[str, Any]]:
    """Return missing required Modrinth dependencies (deduped by projectId)."""
    known_ids = {
        str(r.get("projectId") or "")
        for r in rows
        if str(r.get("platform") or "") == "Modrinth" and r.get("projectId")
    }
    known_lower = {x.lower() for x in known_ids if x}
    missing_by_id: dict[str, dict[str, Any]] = {}
    sources: list[dict[str, Any]] = [
        r
        for r in rows
        if str(r.get("platform") or "") == "Modrinth"
        and r.get("projectId")
        and str(r.get("status") or "") not in ("ignored", "unmatched")
    ]

    total = len(sources)
    for idx, row in enumerate(sources, start=1):
        project_id = str(row.get("projectId") or "")
        mod_name = str(row.get("modName") or row.get("fileName") or project_id)
        if total:
            percent = min(90, int(idx / total * 90))
            if idx == 1 or idx == total or idx % 5 == 0:
                emit(f"[PROGRESS] {percent} deps {idx}/{total} {mod_name}")
        try:
            cand = latest_modrinth_candidate(project_id, mc_version, loader, timeout)
        except Exception as err:  # noqa: BLE001
            emit(f"[WARN] deps lookup failed for {mod_name}: {err}")
            continue
        if not cand:
            continue
        deps = cand.get("dependencies") or []
        if not isinstance(deps, list):
            continue
        for dep in deps:
            if not isinstance(dep, dict):
                continue
            if str(dep.get("dependency_type") or "") != "required":
                continue
            dep_pid = str(dep.get("project_id") or "").strip()
            dep_vid = str(dep.get("version_id") or "").strip()
            if not dep_pid and dep_vid:
                try:
                    ver = modrinth_version_by_id(dep_vid, timeout)
                    dep_pid = str((ver or {}).get("projectId") or "")
                except Exception:  # noqa: BLE001
                    continue
            if not dep_pid:
                continue
            key = dep_pid.lower()
            if key in known_lower or key in missing_by_id:
                continue
            missing_by_id[key] = {
                "projectId": dep_pid,
                "versionId": dep_vid,
                "requiredBy": mod_name,
                "requiredByFile": str(row.get("fileName") or ""),
            }

    titles: dict[str, str] = {}
    try:
        titles = fetch_project_titles([v["projectId"] for v in missing_by_id.values()], timeout=timeout)
    except Exception as err:  # noqa: BLE001
        emit(f"[WARN] dep titles failed: {err}")

    result: list[dict[str, Any]] = []
    for _key, info in missing_by_id.items():
        pid = info["projectId"]
        title = titles.get(pid) or pid
        cand = None
        try:
            if info.get("versionId"):
                cand = modrinth_version_by_id(str(info["versionId"]), timeout)
            if not cand:
                cand = latest_modrinth_candidate(pid, mc_version, loader, timeout)
        except Exception as err:  # noqa: BLE001
            emit(f"[WARN] resolve dep {title} failed: {err}")
            continue
        if not cand or not cand.get("downloadUrl"):
            emit(f"[DEP-MISS] {pid} :: {title} | required by {info['requiredBy']} | no compatible file")
            result.append(
                {
                    **info,
                    "modName": title,
                    "status": "unresolvable",
                    "downloadUrl": "",
                    "fileName": "",
                    "sha1": "",
                    "version": "-",
                }
            )
            continue
        result.append(
            {
                **info,
                "modName": title,
                "status": "missing",
                "downloadUrl": str(cand.get("downloadUrl") or ""),
                "fileName": str(cand.get("fileName") or ""),
                "sha1": str(cand.get("sha1") or ""),
                "version": str(cand.get("version") or "-"),
            }
        )
        emit(
            f"[DEP-MISS] {pid} :: {title} {cand.get('version')} | required by {info['requiredBy']}"
        )
    return result


def action_deps(args: argparse.Namespace) -> int:
    if not args.mc_version.strip():
        emit("[ERROR] mc version is required")
        return 2
    loader = (args.loader or "").strip().lower()
    if loader not in LOADER_TO_CF:
        emit("[ERROR] loader must be forge/fabric/quilt/neoforge")
        return 2
    rows = load_state()
    if not rows:
        emit("[ERROR] no scanned mods; please scan first")
        return 2
    timeout = max(5, int(args.timeout or 30))
    emit(f"[DEP] start mc={args.mc_version.strip()} loader={loader}")
    emit("[PROGRESS] 0 checking deps")
    missing = collect_missing_deps(rows, args.mc_version.strip(), loader, timeout)
    installable = [m for m in missing if m.get("status") == "missing"]
    emit("[PROGRESS] 100 deps checked")
    emit(f"[SUMMARY] depsMissing={len(missing)} installable={len(installable)}")
    emit("[DONE] deps completed")
    return 0


def action_install_deps(args: argparse.Namespace) -> int:
    if not args.mods_path.strip():
        emit("[ERROR] mods path is required")
        return 2
    mods_path = Path(args.mods_path.strip())
    if not mods_path.is_dir():
        emit(f"[ERROR] mods path not found: {mods_path}")
        return 2
    if not args.mc_version.strip():
        emit("[ERROR] mc version is required")
        return 2
    loader = (args.loader or "").strip().lower()
    if loader not in LOADER_TO_CF:
        emit("[ERROR] loader must be forge/fabric/quilt/neoforge")
        return 2

    rows = load_state()
    if not rows:
        emit("[ERROR] no scanned mods; please scan first")
        return 2

    timeout = max(5, int(args.timeout or 30))
    concurrency = max(1, min(int(args.concurrency or 4), 8))
    emit(f"[DEP-INSTALL] start mc={args.mc_version.strip()} loader={loader}")
    missing = collect_missing_deps(rows, args.mc_version.strip(), loader, timeout)
    work = [m for m in missing if m.get("status") == "missing" and m.get("downloadUrl")]
    total = len(work)
    if total == 0:
        emit("[SUMMARY] depsInstalled=0 depsFailed=0")
        emit("[DONE] install-deps completed")
        return 0

    installed = 0
    failed = 0
    done = 0
    new_rows: list[dict[str, Any]] = []

    def install_one(item: dict[str, Any]) -> tuple[dict[str, Any] | None, str, str]:
        url = str(item.get("downloadUrl") or "")
        file_name = str(item.get("fileName") or "").strip()
        if not file_name:
            file_name = f"{item.get('projectId')}.jar"
        if not file_name.lower().endswith(".jar"):
            file_name = f"{file_name}.jar"
        target = mods_path / file_name
        tmp_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                prefix="mcdep_",
                suffix=".jar.part",
                dir=str(mods_path),
                delete=False,
            ) as tmp:
                tmp_path = Path(tmp.name)
            http_download(url, tmp_path, timeout=timeout)
            digested = hash_file(tmp_path)
            expect = str(item.get("sha1") or "").lower()
            got = str(digested.get("sha1") or "").lower()
            if expect and got and expect != got:
                tmp_path.unlink(missing_ok=True)
                return None, "failed", f"hash mismatch {file_name}"
            if target.exists():
                target.unlink()
            shutil.move(str(tmp_path), str(target))
            tmp_path = None
            row = {
                "fileName": file_name,
                "path": str(target),
                "sha1": got,
                "sha512": digested.get("sha512", ""),
                "fingerprint": digested.get("fingerprint", 0),
                "platform": "Modrinth",
                "projectId": str(item.get("projectId") or ""),
                "cfModId": "",
                "modName": str(item.get("modName") or file_name),
                "currentVersion": str(item.get("version") or "-"),
                "targetVersion": str(item.get("version") or "-"),
                "targetPlatform": "Modrinth",
                "downloadUrl": "",
                "targetSha1": got,
                "targetFileName": file_name,
                "targetFileId": "",
                "status": "updated",
                "ignored": False,
                "note": f"installed as dependency for {item.get('requiredBy')}",
            }
            return row, "installed", file_name
        except Exception as err:  # noqa: BLE001
            if tmp_path is not None:
                try:
                    tmp_path.unlink(missing_ok=True)
                except Exception:  # noqa: BLE001
                    pass
            return None, "failed", str(err)

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = {pool.submit(install_one, item): item for item in work}
        for fut in as_completed(futures):
            done += 1
            item = futures[fut]
            row, kind, detail = fut.result()
            name = str(item.get("modName") or item.get("projectId") or "?")
            emit(f"[DEP-INSTALL] {done}/{total} {name}")
            if kind == "installed" and row:
                installed += 1
                emit(f"  -> installed {detail}")
                new_rows.append(row)
            else:
                failed += 1
                emit(f"  -> failed {detail}")
            emit(f"[PROGRESS] {min(99, int(done / total * 100))} deps install {done}/{total}")

    if new_rows:
        by_name = {str(r.get("fileName") or "").lower(): dict(r) for r in rows}
        for row in new_rows:
            by_name[str(row.get("fileName") or "").lower()] = row
        save_state(list(by_name.values()))

    emit("[PROGRESS] 100 deps install finished")
    emit(f"[SUMMARY] depsInstalled={installed} depsFailed={failed}")
    emit("[DONE] install-deps completed")
    return 0 if failed == 0 else 1


def action_rollback(args: argparse.Namespace) -> int:
    if not args.mods_path.strip():
        emit("[ERROR] mods path is required")
        return 2
    mods_path = Path(args.mods_path.strip())
    if not mods_path.is_dir():
        emit(f"[ERROR] mods path not found: {mods_path}")
        return 2

    meta = load_last_update()
    backup_path: Path | None = None
    added_names: list[str] = []

    if meta:
        bp = str(meta.get("backupPath") or "").strip()
        if bp:
            backup_path = Path(bp)
        added_names = [str(x) for x in (meta.get("addedNames") or []) if x]

    if backup_path is None or not backup_path.is_dir():
        backup_path = find_latest_backup_dir(mods_path, args.backup_dir)
        if backup_path is None:
            emit("[ERROR] no backup found to rollback")
            return 2
        emit(f"[WARN] last_update.json missing/invalid, using latest backup: {backup_path}")

    emit(f"[ROLLBACK] start from {backup_path}")
    restored = 0
    removed = 0
    failed = 0

    jars = [p for p in backup_path.iterdir() if p.is_file() and p.suffix.lower() == ".jar"]
    total = max(1, len(jars) + len(added_names))
    done = 0

    for jar in jars:
        done += 1
        dest = mods_path / jar.name
        try:
            shutil.copy2(str(jar), str(dest))
            restored += 1
            emit(f"[ROLLBACK] {done}/{total} {jar.name}")
            emit(f"  -> restored {dest}")
        except Exception as err:  # noqa: BLE001
            failed += 1
            emit(f"[ROLLBACK] {done}/{total} {jar.name}")
            emit(f"  -> failed {err}")
        emit(f"[PROGRESS] {min(99, int(done / total * 100))} rollback")

    for name in added_names:
        if name.lower() in {j.name.lower() for j in jars}:
            continue
        new_path = mods_path / name
        if not new_path.exists():
            continue
        done += 1
        try:
            new_path.unlink()
            removed += 1
            emit(f"[ROLLBACK] {done}/{total} {name}")
            emit(f"  -> removed {new_path}")
        except Exception as err:  # noqa: BLE001
            failed += 1
            emit(f"[ROLLBACK] {done}/{total} {name}")
            emit(f"  -> failed remove {name}: {err}")
        emit(f"[PROGRESS] {min(99, int(done / total * 100))} rollback")

    emit("[PROGRESS] 100 rollback finished")
    emit(f"[SUMMARY] restored={restored} removed={removed} failed={failed}")
    emit("[DONE] rollback completed")
    # hint UI to re-scan
    emit("[HINT] please re-scan mods after rollback")
    return 0 if failed == 0 else 1


def action_dedupe(args: argparse.Namespace) -> int:
    if not args.mods_path.strip():
        emit("[ERROR] mods path is required")
        return 2
    mods_path = Path(args.mods_path.strip())
    if not mods_path.is_dir():
        emit(f"[ERROR] mods path not found: {mods_path}")
        return 2

    apply = bool(args.apply)
    try:
        jars = list_jars(mods_path)
    except FileNotFoundError as err:
        emit(f"[ERROR] {err}")
        return 2

    state_rows = load_state()
    by_name = {str(r.get("fileName") or "").lower(): r for r in state_rows if r.get("fileName")}
    total = len(jars)
    emit(f"[DEDUP] scanning {total} jars ({'apply' if apply else 'dry-run'})")
    emit("[PROGRESS] 0 reading jar metadata")

    candidates: list[dict[str, Any]] = []
    for idx, jar in enumerate(jars, start=1):
        row = by_name.get(jar.name.lower(), {})
        meta = read_jar_mod_meta(jar)
        key = identity_key(row, meta)
        version = resolve_mod_version(row, meta)
        display_name = (
            (meta.get("name") or "").strip()
            or str(row.get("modName") or "").strip()
            or jar.name
        )
        candidates.append(
            {
                "fileName": jar.name,
                "path": jar,
                "key": key,
                "version": version,
                "modName": display_name,
                "modId": (meta.get("modId") or "").strip(),
                "projectId": str(row.get("projectId") or ""),
                "platform": str(row.get("platform") or ""),
                "rank": rank_mod_candidate(version, jar),
            }
        )
        if idx == total or idx % 8 == 0:
            emit(f"[PROGRESS] {min(40, int(idx / max(1, total) * 40))} meta {idx}/{total}")

    groups: dict[str, list[dict[str, Any]]] = {}
    for item in candidates:
        key = item.get("key")
        if not key:
            continue
        groups.setdefault(str(key), []).append(item)

    dup_groups = {k: v for k, v in groups.items() if len(v) > 1}
    drop_plan: list[tuple[dict[str, Any], dict[str, Any]]] = []

    emit(f"[DEDUP] found {len(dup_groups)} duplicate groups")
    for key in sorted(dup_groups.keys()):
        items = sorted(dup_groups[key], key=lambda x: x["rank"], reverse=True)
        keep = items[0]
        drops = items[1:]
        emit(f"[DUP-GROUP] {key} | {len(items)} jars | {keep['modName']}")
        emit(f"[DUP-KEEP] {keep['fileName']} :: {keep['version']}")
        for drop in drops:
            emit(f"[DUP-DROP] {drop['fileName']} :: {drop['version']} | keep={keep['fileName']}")
            drop_plan.append((drop, keep))

    if not drop_plan:
        emit("[PROGRESS] 100 dedupe finished")
        emit("[SUMMARY] groups=0 kept=0 dropped=0 deleted=0 failed=0")
        emit("[DONE] dedupe completed")
        return 0

    deleted = 0
    failed = 0
    backup_root: Path | None = None
    if apply and args.backup_enabled:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_root = backup_root_for(mods_path, args.backup_dir, stamp) / "dedupe"
        backup_root.mkdir(parents=True, exist_ok=True)
        emit(f"[DEDUP] backup dir {backup_root}")

    drop_names: set[str] = set()
    if apply:
        total_drops = len(drop_plan)
        for idx, (drop, keep) in enumerate(drop_plan, start=1):
            path: Path = drop["path"]
            emit(f"[DEDUP] {idx}/{total_drops} {drop['fileName']}")
            try:
                if not path.exists():
                    raise FileNotFoundError("file missing")
                if backup_root is not None:
                    dest = backup_root / path.name
                    if dest.exists():
                        dest = backup_root / f"{path.stem}__{idx}{path.suffix}"
                    shutil.move(str(path), str(dest))
                    emit(f"  -> deleted {path.name} :: backup={dest}")
                else:
                    path.unlink()
                    emit(f"  -> deleted {path.name}")
                deleted += 1
                drop_names.add(path.name.lower())
            except Exception as err:  # noqa: BLE001
                failed += 1
                emit(f"  -> failed {err}")
            emit(f"[PROGRESS] {min(99, 40 + int(idx / total_drops * 60))} cleaning")

        if drop_names:
            remain = [
                r
                for r in state_rows
                if str(r.get("fileName") or "").lower() not in drop_names
            ]
            save_state(remain)
    else:
        emit("[DEDUP] dry-run only; pass --apply to delete lower versions")

    emit("[PROGRESS] 100 dedupe finished")
    emit(
        f"[SUMMARY] groups={len(dup_groups)} kept={len(dup_groups)} "
        f"dropped={len(drop_plan)} deleted={deleted} failed={failed}"
    )
    emit("[DONE] dedupe completed")
    return 0 if failed == 0 else 1


def main() -> int:
    args = build_parser().parse_args()
    emit("[BOOT] mc_mod_updater started")
    emit(
        "[BOOT] params: "
        + json.dumps(
            {
                "action": args.action,
                "modsPath": args.mods_path,
                "mcVersion": args.mc_version,
                "loader": args.loader,
                "backupEnabled": args.backup_enabled,
                "backupDir": args.backup_dir,
                "concurrency": args.concurrency,
                "timeout": args.timeout,
                "curseforgeApiKeyConfigured": bool(args.curseforge_api_key.strip()),
                "only": args.only,
                "apply": bool(getattr(args, "apply", False)),
            },
            ensure_ascii=False,
        )
    )
    if args.action == "scan":
        return action_scan(args)
    if args.action == "check":
        return action_check(args)
    if args.action == "update":
        return action_update(args)
    if args.action == "deps":
        return action_deps(args)
    if args.action == "install-deps":
        return action_install_deps(args)
    if args.action == "rollback":
        return action_rollback(args)
    if args.action == "dedupe":
        return action_dedupe(args)
    emit(f"[ERROR] unknown action: {args.action}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
