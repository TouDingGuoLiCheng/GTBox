import { convertFileSrc } from "@tauri-apps/api/core";

const DISPLAY_URL_CACHE_MAX = 12;
const displayUrlCache = new Map<string, string>();

export function isWorkspaceSkinSubpath(path: string): boolean {
  return /^skin-(presets|custom)\//i.test(path) || /^creative\//i.test(path);
}

function normalizePathKey(path: string): string {
  return path.replace(/^\\\\\?\\/, "").replace(/\\/g, "/");
}

function isDirectDisplayUrl(path: string): boolean {
  return (
    path.startsWith("data:") ||
    path.startsWith("blob:") ||
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("/") ||
    path.startsWith("asset://")
  );
}

export function deleteCachedDisplayUrl(cacheKey: string) {
  displayUrlCache.delete(normalizePathKey(cacheKey));
}

/** 与 resolveSkinDisplayUrl 写入缓存时使用的键一致 */
export async function skinMediaCacheKey(
  path: string | null | undefined,
  resolveWorkspace: (subpath: string) => Promise<string | null>,
): Promise<string | null> {
  if (!path) return null;
  const normalized = normalizePathKey(path);
  if (isDirectDisplayUrl(normalized)) return normalized;
  if (isWorkspaceSkinSubpath(normalized)) {
    const abs = await resolveWorkspace(normalized);
    return abs ? normalizePathKey(abs) : null;
  }
  return normalized;
}

export function clearSkinDisplayUrlCache() {
  displayUrlCache.clear();
}

/**
 * 将皮肤媒体路径解析为 WebView 可显示的 URL（workspace 相对路径需先 resolve 为绝对路径）。
 */
export async function resolveSkinDisplayUrl(
  path: string | null | undefined,
  resolveWorkspace: (subpath: string) => Promise<string | null>,
): Promise<string | null> {
  if (!path) return null;

  const normalized = normalizePathKey(path);
  if (isDirectDisplayUrl(normalized)) {
    return normalized;
  }

  let cacheKey = normalized;
  if (isWorkspaceSkinSubpath(normalized)) {
    const abs = await resolveWorkspace(normalized);
    if (!abs) return null;
    cacheKey = normalizePathKey(abs);
  }

  const cached = displayUrlCache.get(cacheKey);
  if (cached) return cached;

  try {
    const url = convertFileSrc(cacheKey);
    displayUrlCache.set(cacheKey, url);
    if (displayUrlCache.size > DISPLAY_URL_CACHE_MAX) {
      const oldest = displayUrlCache.keys().next().value;
      if (oldest) displayUrlCache.delete(oldest);
    }
    return url;
  } catch {
    return cacheKey;
  }
}
