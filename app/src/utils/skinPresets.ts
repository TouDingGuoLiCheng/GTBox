import type { CustomSkin, ThemeColors } from "../stores/appearance";

export type SkinPresetId =
  | "preset-clouds"
  | "preset-train"
  | "preset-wheat"
  | "preset-peaceful"
  | "preset-flower"
  | "preset-eye";

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
    cardOpacity: 0,
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

/** 夕阳列车视频 + 暖橙 UI */
export const SKIN_PRESET_TRAIN: SkinPresetDefinition = {
  id: "preset-train",
  label: "夕阳列车",
  description: "车窗夕照循环背景，暖色毛玻璃卡片与琥珀强调色",
  icon: "mdi:train",
  workspaceSubpath: "skin-presets/train.mp4",
  bgmWorkspaceSubpath: "skin-presets/train-bgm.mp3",
  bgmDisplay: { title: "Endless", artist: "Lena Raine" },
  colors: {
    accent: "#e8a060",
    surface: "#120c08",
    surfaceElevated: "#221810",
  },
  skin: {
    blur: 0,
    maskOpacity: 0,
    brightness: 96,
    scale: 1.05,
    fontColor: "light",
    cardMaterial: "acrylic",
    titleMaterial: "plain",
    cardOpacity: 0,
    cardBlur: 18,
    cardBorderOpacity: 12,
    titleOpacity: 0,
    titleBlur: 0,
    titleTextShadow: true,
    keepVideoAudio: false,
  },
  watermark: null,
};

/** 麦田远山视频 + 青绿 UI */
export const SKIN_PRESET_WHEAT: SkinPresetDefinition = {
  id: "preset-wheat",
  label: "麦田远山",
  description: "田野山峦循环背景，清透毛玻璃卡片与青绿强调色",
  icon: "mdi:image-filter-hdr",
  workspaceSubpath: "skin-presets/wheat.mp4",
  bgmWorkspaceSubpath: "skin-presets/wheat-bgm.mp3",
  bgmDisplay: { title: "男子高校生と少年時代", artist: "Audio Highs" },
  colors: {
    accent: "#6ec8a0",
    surface: "#080c0a",
    surfaceElevated: "#142018",
  },
  skin: {
    blur: 0,
    maskOpacity: 0,
    brightness: 94,
    scale: 1.04,
    fontColor: "light",
    cardMaterial: "acrylic",
    titleMaterial: "plain",
    cardOpacity: 0,
    cardBlur: 18,
    cardBorderOpacity: 12,
    titleOpacity: 0,
    titleBlur: 0,
    titleTextShadow: true,
    keepVideoAudio: false,
  },
  watermark: null,
};

/** 云野乡村视频 + 浅灰 UI */
export const SKIN_PRESET_PEACEFUL: SkinPresetDefinition = {
  id: "preset-peaceful",
  label: "云野乡村",
  description: "乡野云雾循环背景，轻盈毛玻璃卡片与雾蓝强调色",
  icon: "mdi:blur-linear",
  workspaceSubpath: "skin-presets/peaceful.mp4",
  bgmWorkspaceSubpath: "skin-presets/peaceful-bgm.mp3",
  bgmDisplay: { title: "Old Man Voll", artist: "Evan Call" },
  colors: {
    accent: "#9ab0c8",
    surface: "#0c0e12",
    surfaceElevated: "#181c22",
  },
  skin: {
    blur: 0,
    maskOpacity: 0,
    brightness: 98,
    scale: 1.03,
    fontColor: "light",
    cardMaterial: "acrylic",
    titleMaterial: "plain",
    cardOpacity: 0,
    cardBlur: 16,
    cardBorderOpacity: 10,
    titleOpacity: 0,
    titleBlur: 0,
    titleTextShadow: true,
    keepVideoAudio: false,
  },
  watermark: null,
};

/** 白花晨光视频 + 柔粉 UI（亮色背景，深色字体） */
export const SKIN_PRESET_FLOWER: SkinPresetDefinition = {
  id: "preset-flower",
  label: "白花晨光",
  description: "晨光花影循环背景，通透卡片与淡粉强调色",
  icon: "mdi:flower-outline",
  workspaceSubpath: "skin-presets/flower.mp4",
  bgmWorkspaceSubpath: "skin-presets/flower-bgm.mp3",
  bgmDisplay: { title: "Comforting Memories", artist: "Kumi Tanioka" },
  colors: {
    accent: "#c06080",
    surface: "#f8f6f4",
    surfaceElevated: "#ffffff",
  },
  skin: {
    blur: 0,
    maskOpacity: 0,
    brightness: 96,
    scale: 1.05,
    fontColor: "dark",
    cardMaterial: "acrylic",
    titleMaterial: "plain",
    cardOpacity: 0,
    cardBlur: 18,
    cardBorderOpacity: 12,
    titleOpacity: 0,
    titleBlur: 0,
    titleTextShadow: true,
    keepVideoAudio: false,
  },
  watermark: null,
};

/** 你的眼眸视频 + 金琥珀 UI */
export const SKIN_PRESET_EYE: SkinPresetDefinition = {
  id: "preset-eye",
  label: "你的眼眸",
  description: "动漫眼眸循环背景，通透毛玻璃卡片与金琥珀强调色",
  icon: "mdi:eye-outline",
  workspaceSubpath: "skin-presets/eye.mp4",
  bgmWorkspaceSubpath: "skin-presets/eye-bgm.mp3",
  bgmDisplay: { title: "Always Watching Over You", artist: "Evan Call" },
  colors: {
    accent: "#d8b050",
    surface: "#100e08",
    surfaceElevated: "#201c14",
  },
  skin: {
    blur: 0,
    maskOpacity: 0,
    brightness: 95,
    scale: 1.06,
    fontColor: "light",
    cardMaterial: "acrylic",
    titleMaterial: "plain",
    cardOpacity: 0,
    cardBlur: 18,
    cardBorderOpacity: 12,
    titleOpacity: 0,
    titleBlur: 0,
    titleTextShadow: true,
    keepVideoAudio: false,
  },
  watermark: null,
};

export const SKIN_PRESETS: Record<SkinPresetId, SkinPresetDefinition> = {
  "preset-clouds": SKIN_PRESET_CLOUDS,
  "preset-train": SKIN_PRESET_TRAIN,
  "preset-wheat": SKIN_PRESET_WHEAT,
  "preset-peaceful": SKIN_PRESET_PEACEFUL,
  "preset-flower": SKIN_PRESET_FLOWER,
  "preset-eye": SKIN_PRESET_EYE,
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
