import type { CustomSkin, ThemeColors } from "../stores/appearance";

export type SkinPresetId = "preset-clouds";

export interface SkinWatermarkCover {
  /** 像素定位（相对 refWidth/refHeight 全屏参考） */
  widthPx?: number;
  heightPx?: number;
  insetRightPx?: number;
  insetBottomPx?: number;
  /** 设计稿参考分辨率，contain 预览时按比例缩放遮罩 */
  refWidth?: number;
  refHeight?: number;
  /** 百分比定位（备用，相对画面内容区） */
  widthPercent?: number;
  heightPercent?: number;
  insetRightPercent?: number;
  insetBottomPercent?: number;
}

export interface MediaContentRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SkinPresetBgmDisplay {
  title: string;
  artist: string;
}

export interface SkinPresetDefinition {
  id: SkinPresetId;
  label: string;
  description: string;
  icon: string;
  workspaceSubpath: string;
  bgmWorkspaceSubpath?: string;
  bgmDisplay?: SkinPresetBgmDisplay;
  colors: ThemeColors;
  skin: Omit<CustomSkin, "backgroundImage" | "bgm">;
  watermark: SkinWatermarkCover | null;
}

/** 积云流动视频 + 天蓝 UI */
export const SKIN_PRESET_CLOUDS: SkinPresetDefinition = {
  id: "preset-clouds",
  label: "云彩流动",
  description: "积云视频循环背景，毛玻璃卡片与天蓝强调色",
  icon: "mdi:weather-cloudy",
  workspaceSubpath: "skin-presets/cloud.mp4",
  bgmWorkspaceSubpath: "skin-presets/cloud-bgm.mp3",
  bgmDisplay: { title: "Aerie", artist: "Lena Raine" },
  colors: {
    accent: "#6ec8e8",
    surface: "#0b1018",
    surfaceElevated: "#152030",
  },
  skin: {
    blur: 0,
    maskOpacity: 0,
    brightness: 94,
    scale: 1.05,
    fontColor: "light",
    cardMaterial: "acrylic",
    titleMaterial: "plain",
    cardOpacity: 40,
    cardBlur: 18,
    cardBorderOpacity: 12,
    titleOpacity: 0,
    titleBlur: 0,
    titleTextShadow: true,
    keepVideoAudio: false,
  },
  watermark: {
    refWidth: 1920,
    refHeight: 1080,
    widthPx: 258,
    heightPx: 78,
    insetRightPx: 0,
    insetBottomPx: 0,
  },
};

export const SKIN_PRESETS: Record<SkinPresetId, SkinPresetDefinition> = {
  "preset-clouds": SKIN_PRESET_CLOUDS,
};

export const SKIN_PRESET_LIST = Object.values(SKIN_PRESETS);

export function getSkinPreset(id: SkinPresetId | null | undefined): SkinPresetDefinition | null {
  if (!id) return null;
  return SKIN_PRESETS[id] ?? null;
}

/** object-fit 下视频/图片实际显示区域（含 letterbox 偏移） */
export function computeObjectFitContentRect(
  containerW: number,
  containerH: number,
  mediaW: number,
  mediaH: number,
  fit: "cover" | "contain",
): MediaContentRect | null {
  if (containerW <= 0 || containerH <= 0 || mediaW <= 0 || mediaH <= 0) return null;

  const scale =
    fit === "contain"
      ? Math.min(containerW / mediaW, containerH / mediaH)
      : Math.max(containerW / mediaW, containerH / mediaH);

  const w = mediaW * scale;
  const h = mediaH * scale;
  return {
    x: (containerW - w) / 2,
    y: (containerH - h) / 2,
    w,
    h,
  };
}

/** 对内容区施加与视频相同的 scale 变换（绕中心放大） */
export function applyContentRectScale(
  rect: MediaContentRect,
  scale: number,
): MediaContentRect {
  if (scale === 1) return rect;
  const w = rect.w * scale;
  const h = rect.h * scale;
  return {
    x: rect.x + rect.w / 2 - w / 2,
    y: rect.y + rect.h / 2 - h / 2,
    w,
    h,
  };
}

/** 遮罩贴在内容区右下角，随 contain/cover 与容器尺寸自适应 */
export function watermarkCoverAdaptiveStyle(
  cover: SkinWatermarkCover,
  rect: MediaContentRect,
): Record<string, string> {
  const refW = cover.refWidth ?? 1920;
  const refH = cover.refHeight ?? 1080;

  if (cover.widthPx != null && cover.heightPx != null) {
    const ww = Math.max(8, (cover.widthPx / refW) * rect.w);
    const wh = Math.max(6, (cover.heightPx / refH) * rect.h);
    const ir = ((cover.insetRightPx ?? 0) / refW) * rect.w;
    const ib = ((cover.insetBottomPx ?? 0) / refH) * rect.h;
    return {
      left: `${rect.x + rect.w - ww - ir}px`,
      top: `${rect.y + rect.h - wh - ib}px`,
      width: `${ww}px`,
      height: `${wh}px`,
    };
  }

  const ww = ((cover.widthPercent ?? 10) / 100) * rect.w;
  const wh = ((cover.heightPercent ?? 6) / 100) * rect.h;
  const ir = ((cover.insetRightPercent ?? 0) / 100) * rect.w;
  const ib = ((cover.insetBottomPercent ?? 0) / 100) * rect.h;
  return {
    left: `${rect.x + rect.w - ww - ir}px`,
    top: `${rect.y + rect.h - wh - ib}px`,
    width: `${ww}px`,
    height: `${wh}px`,
  };
}

/** 全屏 cover 时容器即内容区，仍走自适应（与旧逻辑等价） */
export function watermarkCoverStyle(
  cover: SkinWatermarkCover,
  containerW?: number,
  containerH?: number,
): Record<string, string> {
  if (containerW && containerH) {
    const rect = computeObjectFitContentRect(
      containerW,
      containerH,
      containerW,
      containerH,
      "cover",
    );
    if (rect) return watermarkCoverAdaptiveStyle(cover, rect);
  }
  if (cover.widthPx != null && cover.heightPx != null) {
    return {
      right: `${cover.insetRightPx ?? 0}px`,
      bottom: `${cover.insetBottomPx ?? 0}px`,
      width: `${cover.widthPx}px`,
      height: `${cover.heightPx}px`,
    };
  }
  return {
    right: `${cover.insetRightPercent ?? 0}%`,
    bottom: `${cover.insetBottomPercent ?? 0}%`,
    width: `${cover.widthPercent ?? 10}%`,
    height: `${cover.heightPercent ?? 6}%`,
  };
}
