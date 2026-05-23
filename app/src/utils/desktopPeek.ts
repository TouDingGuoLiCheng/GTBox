export interface DesktopPeekPrefs {
  desktopPeek: boolean;
  desktopPeekAmount: number;
}

/** 已有壁纸/视频背景时不透视（银河、自定义皮肤、视频预设） */
export function canDesktopPeek(
  scheme: string,
  hasCustomWallpaper: boolean,
  prefs: DesktopPeekPrefs,
): boolean {
  if (!prefs.desktopPeek || prefs.desktopPeekAmount <= 0) return false;
  if (scheme === "galaxy") return false;
  if (scheme === "custom" && hasCustomWallpaper) return false;
  return true;
}

/** 0–1，越大透视越强（界面越透） */
export function desktopPeekStrength(prefs: DesktopPeekPrefs): number {
  return Math.min(1, Math.max(0, prefs.desktopPeekAmount / 100));
}

/** 空白区遮罩浓度：透视度越高遮罩越淡，桌面越清晰 */
export function desktopPeekBackdropAlpha(prefs: DesktopPeekPrefs): number {
  const s = desktopPeekStrength(prefs);
  return Math.max(0, 0.65 * (1 - s));
}
