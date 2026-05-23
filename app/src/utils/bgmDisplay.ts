/** 从音频文件名解析顶栏展示：优先「歌手 - 歌名」 */
export function parseBgmFileLabel(fileName: string): { title: string; artist: string } {
  const stem = fileName.replace(/\.[^.]+$/, "").trim();
  if (!stem) return { title: "本地音乐", artist: "" };

  const parts = stem.split(/\s*[-–—]\s+/);
  if (parts.length >= 2) {
    const artist = parts[0]?.trim() || "";
    const title = parts.slice(1).join(" - ").trim() || stem;
    return { title, artist };
  }

  return { title: stem, artist: "" };
}
