/** 自定义主题背景是否为视频（路径、data URL 或 blob） */
export function isVideoSkinPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const lower = path.toLowerCase();
  if (lower.startsWith("data:video/")) return true;
  if (lower.startsWith("blob:")) {
    return false;
  }
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(lower);
}

export const SKIN_BACKGROUND_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,image/bmp,video/mp4,video/webm,video/quicktime";

export const SKIN_BACKGROUND_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
  "mp4",
  "webm",
  "mov",
  "m4v",
] as const;
