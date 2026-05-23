import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { defineStore } from "pinia";
import { ref, watch } from "vue";
import galaxyBgUrl from "../assets/themes/galaxy-bg.png";
import { syncDesktopPeekWindow } from "../composables/syncDesktopPeek";
import { canDesktopPeek } from "../utils/desktopPeek";
import {
  getSkinPreset,
  SKIN_PRESET_LIST,
  type SkinPresetId,
} from "../utils/skinPresets";
import { parseBgmFileLabel } from "../utils/bgmDisplay";
import {
  pushMediaDebug,
  setMediaDebugEnabled,
} from "../utils/mediaDebug";
import { isVideoSkinPath, SKIN_BACKGROUND_EXTENSIONS } from "../utils/skinMedia";
import type { SkinPresetBgmDisplay } from "../utils/skinPresets";

export type { SkinPresetId } from "../utils/skinPresets";
export { SKIN_PRESET_LIST, getSkinPreset } from "../utils/skinPresets";

export type ColorScheme = "dark" | "light" | "galaxy" | "pixel" | "custom";

export const GALAXY_THEME_BG = galaxyBgUrl;
export type SkinFontColor = "light" | "dark";
export type CornerRadius = "compact" | "standard" | "rounded";
export type FontScale = "standard" | "large";
export type ToolGridCols = "auto" | "2" | "3";

export interface UiPreferences {
  pageAnimation: boolean;
  cardAnimation: boolean;
  cornerRadius: CornerRadius;
  fontScale: FontScale;
  toolGridCols: ToolGridCols;
  /** 透视桌面：窗口透明，可见身后真实桌面 */
  desktopPeek: boolean;
  /** 透视强度 0–100，越大越能看见桌面 */
  desktopPeekAmount: number;
  /** 透视桌面时是否隐藏创意背景（粒子星空等） */
  desktopPeekHideCreative: boolean;
  /** 主界面：隐藏侧栏、标题与工具卡片，仅留背景 */
  contentUiHidden: boolean;
  /** 右下角媒体调试终端浮层 */
  mediaDebugOverlay: boolean;
  /** 诊断：禁用主题遮罩与滤镜，仅显示原图/原视频 */
  disableSkinFxForDebug: boolean;
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  pageAnimation: true,
  cardAnimation: true,
  cornerRadius: "standard",
  fontScale: "standard",
  toolGridCols: "auto",
  desktopPeek: false,
  desktopPeekAmount: 55,
  desktopPeekHideCreative: false,
  contentUiHidden: false,
  mediaDebugOverlay: false,
  disableSkinFxForDebug: false,
};

export type CreativeBackgroundEffect =
  | "none"
  | "matrix-rain"
  | "particle-stars"
  | "laser-bands"
  | "ascii-art"
  | "rain-ripples";

export interface ParticleStarsSettings {
  /** 绕天极旋转时是否绘制同色渐隐星轨 */
  starTrails: boolean;
  /** 随机十字星芒 */
  showFlares: boolean;
  /** 偶发快速弧线流星，带淡出尾迹与微粒 */
  showMeteors: boolean;
  /** 界面卡片与顶栏透明，露出创意背景 */
  transparentCards: boolean;
}

export const DEFAULT_PARTICLE_STARS: ParticleStarsSettings = {
  starTrails: false,
  showFlares: true,
  showMeteors: false,
  transparentCards: false,
};

/** 0/1 字符画：用户上传图片或 GIF，按帧转为字符网格 */
export interface AsciiArtSettings {
  /** workspaces 相对路径，如 creative/ascii-art/source.gif */
  sourceSubpath: string | null;
  fileName: string | null;
  /** 亮度阈值 0–255，低于视为点亮为 1 */
  threshold: number;
  invert: boolean;
  /** 动图播放帧率（FPS），实际播放不超过源 GIF 帧数 */
  frameCount: number;
  /** 递增以触发字符画重新解析（无需重传文件） */
  refreshNonce: number;
  /** 魔棒容差 8–96：越大越易把相近色当成背景 */
  wandTolerance: number;
  /** 正方形格子边长（px），4–14，越小越精细 */
  cellSize: number;
}

export const DEFAULT_ASCII_ART: AsciiArtSettings = {
  sourceSubpath: null,
  fileName: null,
  threshold: 128,
  invert: false,
  frameCount: 24,
  refreshNonce: 0,
  wandTolerance: 36,
  cellSize: 6,
};

export interface CreativeBackgroundSettings {
  effect: CreativeBackgroundEffect;
  /** 10–200：影响密度、速度与可见度（100 为基准） */
  intensity: number;
  particleStars: ParticleStarsSettings;
  asciiArt: AsciiArtSettings;
}

export const DEFAULT_CREATIVE_BACKGROUND: CreativeBackgroundSettings = {
  effect: "none",
  intensity: 80,
  particleStars: { ...DEFAULT_PARTICLE_STARS },
  asciiArt: { ...DEFAULT_ASCII_ART },
};

/** 设置页可选且已实现的效果 */
export const CREATIVE_BACKGROUND_OPTIONS: {
  id: CreativeBackgroundEffect;
  label: string;
  description: string;
}[] = [
  { id: "none", label: "无", description: "仅显示主题底色" },
  {
    id: "matrix-rain",
    label: "字符雨",
    description: "列头向下延伸新字符，旧字符数秒后淡出消失",
  },
  {
    id: "particle-stars",
    label: "粒子星辰",
    description: "绕天极同速旋转，可开关星轨与星芒",
  },
  {
    id: "laser-bands",
    label: "激光带",
    description: "顶部与底部斜向柔光带，随主题强调色缓慢流动",
  },
  {
    id: "ascii-art",
    label: "字符画",
    description: "上传图片或动图，按固定帧率播放；帧率越高越流畅",
  },
  {
    id: "rain-ripples",
    label: "雨滴涟漪",
    description: "细雨丝落下，水面随机泛起扩散涟漪",
  },
];
export type UiMaterial = "glass" | "solid" | "acrylic" | "frosted";
export type TitleMaterial = UiMaterial | "plain";

export interface ThemeColors {
  accent: string;
  surface: string;
  surfaceElevated: string;
}

/** 自定义皮肤自选背景音乐（workspaces 相对路径） */
export interface CustomSkinBgm {
  workspaceSubpath: string | null;
  fileName: string | null;
  title: string;
  artist: string;
}

export const DEFAULT_CUSTOM_SKIN_BGM: CustomSkinBgm = {
  workspaceSubpath: null,
  fileName: null,
  title: "",
  artist: "",
};

export interface CustomSkin {
  backgroundImage: string | null;
  blur: number;
  maskOpacity: number;
  brightness: number;
  scale: number;
  fontColor: SkinFontColor;
  cardMaterial: UiMaterial;
  titleMaterial: TitleMaterial;
  cardOpacity: number;
  cardBlur: number;
  cardBorderOpacity: number;
  titleOpacity: number;
  titleBlur: number;
  titleTextShadow: boolean;
  /** 视频背景是否播放素材原声（与本地音乐互斥） */
  keepVideoAudio: boolean;
  bgm: CustomSkinBgm;
}

export interface ActiveSkinBgm {
  workspaceSubpath: string;
  display: SkinPresetBgmDisplay;
}

export const MATERIAL_PRESETS: Record<
  UiMaterial,
  Pick<CustomSkin, "cardOpacity" | "cardBlur" | "cardBorderOpacity" | "titleOpacity" | "titleBlur">
> = {
  glass: { cardOpacity: 55, cardBlur: 12, cardBorderOpacity: 14, titleOpacity: 35, titleBlur: 10 },
  solid: { cardOpacity: 88, cardBlur: 0, cardBorderOpacity: 8, titleOpacity: 75, titleBlur: 0 },
  acrylic: { cardOpacity: 38, cardBlur: 20, cardBorderOpacity: 10, titleOpacity: 28, titleBlur: 14 },
  frosted: { cardOpacity: 48, cardBlur: 28, cardBorderOpacity: 18, titleOpacity: 42, titleBlur: 18 },
};

const STORAGE_KEY = "toolbox-appearance";

export const THEME_PRESETS: Record<Exclude<ColorScheme, "custom">, ThemeColors> = {
  dark: {
    accent: "#22d3ee",
    surface: "#0f0f12",
    surfaceElevated: "#1a1a22",
  },
  light: {
    accent: "#ea580c",
    surface: "#f4f4f5",
    surfaceElevated: "#ffffff",
  },
  galaxy: {
    accent: "#a5b4fc",
    surface: "#0a0812",
    surfaceElevated: "#16102a",
  },
  pixel: {
    accent: "#5dbd4c",
    surface: "#3c3f41",
    surfaceElevated: "#c6c6c6",
  },
};

/** 银河主题：地球视角银河壁纸 + 星河 UI 材质 */
/** 像素主题：实心石质面板，无模糊与壁纸 */
export const PIXEL_SKIN: CustomSkin = {
  backgroundImage: null,
  blur: 0,
  maskOpacity: 0,
  brightness: 100,
  scale: 1,
  fontColor: "dark",
  cardMaterial: "solid",
  titleMaterial: "plain",
  cardOpacity: 100,
  cardBlur: 0,
  cardBorderOpacity: 100,
  titleOpacity: 0,
  titleBlur: 0,
  titleTextShadow: false,
  keepVideoAudio: true,
  bgm: { ...DEFAULT_CUSTOM_SKIN_BGM },
};

export const GALAXY_SKIN: CustomSkin = {
  backgroundImage: GALAXY_THEME_BG,
  blur: 0,
  maskOpacity: 36,
  brightness: 90,
  scale: 1.06,
  fontColor: "light",
  cardMaterial: "glass",
  titleMaterial: "plain",
  cardOpacity: 38,
  cardBlur: 16,
  cardBorderOpacity: 10,
  titleOpacity: 0,
  titleBlur: 0,
  titleTextShadow: true,
  keepVideoAudio: false,
  bgm: { ...DEFAULT_CUSTOM_SKIN_BGM },
};

export const DEFAULT_CUSTOM: ThemeColors = {
  accent: "#e11d48",
  surface: "#0a0a0c",
  surfaceElevated: "#141418",
};

/** 皮肤预设配套背景音乐（如云彩流动） */
export interface SkinPresetBgmSettings {
  enabled: boolean;
  /** 0–100 */
  volume: number;
}

export const DEFAULT_SKIN_PRESET_BGM: SkinPresetBgmSettings = {
  enabled: false,
  volume: 45,
};

export const DEFAULT_SKIN: CustomSkin = {
  backgroundImage: null,
  blur: 0,
  maskOpacity: 50,
  brightness: 100,
  scale: 1,
  fontColor: "light",
  cardMaterial: "glass",
  titleMaterial: "glass",
  cardOpacity: 55,
  cardBlur: 12,
  cardBorderOpacity: 14,
  titleOpacity: 35,
  titleBlur: 10,
  titleTextShadow: true,
  keepVideoAudio: true,
  bgm: { ...DEFAULT_CUSTOM_SKIN_BGM },
};

function normalizeCustomSkinBgm(raw?: Partial<CustomSkinBgm>): CustomSkinBgm {
  return {
    ...DEFAULT_CUSTOM_SKIN_BGM,
    ...raw,
    workspaceSubpath: raw?.workspaceSubpath ?? null,
    fileName: raw?.fileName ?? null,
    title: String(raw?.title ?? "").trim(),
    artist: String(raw?.artist ?? "").trim(),
  };
}

function normalizeCustomSkin(raw?: Partial<CustomSkin>): CustomSkin {
  return {
    ...DEFAULT_SKIN,
    ...raw,
    keepVideoAudio: Boolean(raw?.keepVideoAudio ?? DEFAULT_SKIN.keepVideoAudio),
    bgm: normalizeCustomSkinBgm(raw?.bgm),
  };
}

export function isCustomSkinVideoBackground(
  backgroundImage: string | null | undefined,
  resolvedUrl?: string | null,
): boolean {
  return (
    isVideoSkinPath(backgroundImage) ||
    isVideoSkinPath(resolvedUrl ?? null)
  );
}

function usesCustomVideoAudio(skin: CustomSkin): boolean {
  return skin.keepVideoAudio && isCustomSkinVideoBackground(skin.backgroundImage);
}

interface AppearanceState {
  colorScheme: ColorScheme;
  customColors: ThemeColors;
  customSkin: CustomSkin;
  skinPresetId: SkinPresetId | null;
  skinPresetBgm: SkinPresetBgmSettings;
  uiPreferences: UiPreferences;
  creativeBackground: CreativeBackgroundSettings;
}

const IMPLEMENTED_CREATIVE_EFFECTS: CreativeBackgroundEffect[] = [
  "none",
  "matrix-rain",
  "particle-stars",
  "laser-bands",
  "ascii-art",
  "rain-ripples",
];

function isWorkspaceSkinSubpath(path: string): boolean {
  return /^skin-(presets|custom)\//i.test(path) || /^creative\//i.test(path);
}

function normalizeCreativeBackground(
  raw?: Partial<CreativeBackgroundSettings> & { effect?: string },
): CreativeBackgroundSettings {
  let effect = (raw?.effect as string | undefined) ?? DEFAULT_CREATIVE_BACKGROUND.effect;
  if (effect === "binary-stream") effect = "ascii-art";
  if (effect === "parallax-clouds") effect = "rain-ripples";

  const merged: CreativeBackgroundSettings = {
    ...DEFAULT_CREATIVE_BACKGROUND,
    ...raw,
    effect: effect as CreativeBackgroundEffect,
  };
  if (!IMPLEMENTED_CREATIVE_EFFECTS.includes(merged.effect)) {
    merged.effect = "none";
  }
  merged.intensity = Math.min(200, Math.max(10, Number(merged.intensity) || 80));
  merged.particleStars = {
    ...DEFAULT_PARTICLE_STARS,
    ...raw?.particleStars,
  };
  merged.asciiArt = {
    ...DEFAULT_ASCII_ART,
    ...raw?.asciiArt,
  };
  merged.asciiArt.threshold = Math.min(
    255,
    Math.max(0, Number(merged.asciiArt.threshold) || 128),
  );
  merged.asciiArt.frameCount = Math.min(
    120,
    Math.max(1, Math.floor(Number(merged.asciiArt.frameCount) || 24)),
  );
  merged.asciiArt.wandTolerance = Math.min(
    96,
    Math.max(8, Math.floor(Number(merged.asciiArt.wandTolerance) || 36)),
  );
  merged.asciiArt.cellSize = Math.min(
    14,
    Math.max(4, Math.floor(Number(merged.asciiArt.cellSize) || 6)),
  );
  return merged;
}

function normalizeSkinPresetBgm(raw?: Partial<SkinPresetBgmSettings>): SkinPresetBgmSettings {
  const merged = { ...DEFAULT_SKIN_PRESET_BGM, ...raw };
  merged.volume = Math.min(100, Math.max(0, Math.round(Number(merged.volume) || 45)));
  merged.enabled = Boolean(merged.enabled);
  return merged;
}

function loadState(): AppearanceState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<AppearanceState>;
    return {
      colorScheme: VALID_COLOR_SCHEMES.includes(parsed.colorScheme as ColorScheme)
        ? (parsed.colorScheme as ColorScheme)
        : "dark",
      customColors: { ...DEFAULT_CUSTOM, ...parsed.customColors },
      customSkin: normalizeCustomSkin(parsed.customSkin),
      skinPresetId:
        parsed.skinPresetId === "preset-clouds" ? "preset-clouds" : null,
      skinPresetBgm: normalizeSkinPresetBgm(parsed.skinPresetBgm),
      uiPreferences: normalizeUiPreferences(parsed.uiPreferences),
      creativeBackground: normalizeCreativeBackground(parsed.creativeBackground),
    };
  } catch {
    return defaultState();
  }
}

function normalizeUiPreferences(raw?: Partial<UiPreferences>): UiPreferences {
  const merged = { ...DEFAULT_UI_PREFERENCES, ...raw };
  merged.desktopPeekAmount = Math.min(
    100,
    Math.max(0, Math.floor(Number(merged.desktopPeekAmount) || 0)),
  );
  merged.desktopPeek = Boolean(merged.desktopPeek);
  merged.desktopPeekHideCreative = Boolean(merged.desktopPeekHideCreative);
  merged.contentUiHidden = Boolean(merged.contentUiHidden);
  merged.mediaDebugOverlay = Boolean(merged.mediaDebugOverlay);
  merged.disableSkinFxForDebug = Boolean(merged.disableSkinFxForDebug);
  return merged;
}

function defaultState(): AppearanceState {
  return {
    colorScheme: "dark",
    customColors: { ...DEFAULT_CUSTOM },
    customSkin: normalizeCustomSkin(),
    skinPresetId: null,
    skinPresetBgm: { ...DEFAULT_SKIN_PRESET_BGM },
    uiPreferences: { ...DEFAULT_UI_PREFERENCES },
    creativeBackground: { ...DEFAULT_CREATIVE_BACKGROUND },
  };
}

const RADIUS_MAP: Record<CornerRadius, string> = {
  compact: "0.75rem",
  standard: "1rem",
  rounded: "1.25rem",
};

function applyUiPreferences(root: HTMLElement, prefs: UiPreferences, scheme: ColorScheme) {
  root.dataset.pageAnimation = prefs.pageAnimation ? "on" : "off";
  root.dataset.cardAnimation = prefs.cardAnimation ? "on" : "off";
  root.dataset.radius = scheme === "pixel" ? "pixel" : prefs.cornerRadius;
  root.dataset.fontScale = prefs.fontScale;
  root.dataset.gridCols = prefs.toolGridCols;
  const radius =
    scheme === "pixel" ? "0" : RADIUS_MAP[prefs.cornerRadius];
  root.style.setProperty("--ui-radius", radius);
  root.style.fontSize =
    scheme === "pixel"
      ? prefs.fontScale === "large"
        ? "18px"
        : "16px"
      : prefs.fontScale === "large"
        ? "17px"
        : "15px";
}

function cloneSkin(skin: CustomSkin): CustomSkin {
  return {
    ...skin,
    bgm: { ...skin.bgm },
  };
}

function normalizeSkinMediaPath(path: string): string {
  // 兼容 Windows 长路径前缀和反斜杠，避免 convertFileSrc 解析异常
  return path.replace(/^\\\\\?\\/, "").replace(/\\/g, "/");
}

const VALID_COLOR_SCHEMES: ColorScheme[] = [
  "dark",
  "light",
  "galaxy",
  "pixel",
  "custom",
];

function resolveColors(scheme: ColorScheme, custom: ThemeColors): ThemeColors {
  if (scheme === "custom") return custom;
  return THEME_PRESETS[scheme];
}

function resolveSkinForScheme(scheme: ColorScheme, skin: CustomSkin): CustomSkin {
  if (scheme === "galaxy") return GALAXY_SKIN;
  if (scheme === "pixel") return PIXEL_SKIN;
  return skin;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function applyUiMaterialVars(root: HTMLElement, skin: CustomSkin) {
  const [sr, sg, sb] = hexToRgb(skin.fontColor === "light" ? "#0c0c10" : "#f4f4f5");
  const cardA = skin.cardOpacity / 100;
  const titleA =
    skin.titleMaterial === "plain" ? 0 : skin.titleOpacity / 100;

  root.dataset.cardMaterial = skin.cardMaterial;
  root.dataset.titleMaterial = skin.titleMaterial;

  root.style.setProperty("--ui-card-bg", `rgba(${sr}, ${sg}, ${sb}, ${cardA})`);
  root.style.setProperty("--ui-card-blur", `${skin.cardBlur}px`);
  root.style.setProperty(
    "--ui-card-border-alpha",
    String(skin.cardBorderOpacity / 100),
  );
  root.style.setProperty("--ui-title-bg", `rgba(${sr}, ${sg}, ${sb}, ${titleA})`);
  root.style.setProperty("--ui-title-blur", `${skin.titleBlur}px`);
  root.style.setProperty(
    "--ui-title-border-alpha",
    String(Math.min(skin.cardBorderOpacity + 4, 30) / 100),
  );

  const shadow =
    skin.titleTextShadow && skin.fontColor === "light"
      ? "0 1px 8px rgb(0 0 0 / 0.55)"
      : skin.titleTextShadow && skin.fontColor === "dark"
        ? "0 1px 4px rgb(255 255 255 / 0.5)"
        : "none";
  root.style.setProperty("--ui-title-shadow", shadow);
  root.style.setProperty(
    "--ui-title-box-shadow",
    skin.titleMaterial === "frosted" ? "0 4px 24px rgb(0 0 0 / 0.25)" : "none",
  );
}

function applyToDocument(
  scheme: ColorScheme,
  colors: ThemeColors,
  skin: CustomSkin,
  prefs: UiPreferences,
  creative: CreativeBackgroundSettings,
  skinPresetId: SkinPresetId | null,
) {
  const root = document.documentElement;
  root.dataset.theme = scheme;
  root.style.setProperty("--color-surface", colors.surface);
  root.style.setProperty("--color-surface-elevated", colors.surfaceElevated);
  root.style.setProperty("--color-accent", colors.accent);
  root.style.colorScheme = scheme === "light" ? "light" : "dark";

  const isGalaxy = scheme === "galaxy";
  const isPixel = scheme === "pixel";
  root.dataset.pixelTheme = isPixel ? "true" : "";
  const isCustom = scheme === "custom";
  const activeSkin = isCustom || isGalaxy || isPixel;
  const activeSkinConfig = resolveSkinForScheme(scheme, skin);

  root.dataset.skinActive = activeSkin ? "true" : "false";
  root.dataset.fontColor = activeSkin ? activeSkinConfig.fontColor : "";
  root.dataset.skinPreset = scheme === "custom" && skinPresetId ? skinPresetId : "";

  if (activeSkin && activeSkinConfig.backgroundImage) {
    const normalized = normalizeSkinMediaPath(activeSkinConfig.backgroundImage);
    let url = normalized;
    if (
      !url.startsWith("data:") &&
      !url.startsWith("blob:") &&
      !url.startsWith("/") &&
      !url.startsWith("http://") &&
      !url.startsWith("https://")
    ) {
      try {
        url = convertFileSrc(normalized);
      } catch {
        url = normalized;
      }
    }
    if (url && !isVideoSkinPath(normalized)) {
      root.style.setProperty("--skin-bg-url", `url("${url}")`);
    } else {
      root.style.removeProperty("--skin-bg-url");
    }
  } else {
    root.style.removeProperty("--skin-bg-url");
  }

  root.style.setProperty("--skin-blur", `${activeSkinConfig.blur}px`);
  root.style.setProperty(
    "--skin-mask-opacity",
    String(activeSkinConfig.maskOpacity / 100),
  );
  root.style.setProperty(
    "--skin-brightness",
    String(activeSkinConfig.brightness / 100),
  );
  root.style.setProperty("--skin-scale", String(activeSkinConfig.scale));

  if (activeSkin) {
    applyUiMaterialVars(root, activeSkinConfig);
  } else {
    root.dataset.cardMaterial = "";
    root.dataset.titleMaterial = "";
  }

  applyUiPreferences(root, prefs, scheme);

  const creativeBlockedBySkinMedia =
    scheme === "custom" && !!skin.backgroundImage;
  const creativeActive = !creativeBlockedBySkinMedia && creative.effect !== "none";
  root.dataset.creativeEffect = creativeActive ? creative.effect : "";
  const transparentCards =
    creativeActive &&
    creative.effect === "particle-stars" &&
    creative.particleStars.transparentCards;
  root.dataset.creativeTransparentCards = transparentCards ? "true" : "";

  const peekActive = canDesktopPeek(
    scheme,
    isCustom && !!skin.backgroundImage,
    prefs,
  );
  root.dataset.desktopPeek = peekActive ? "true" : "";
  root.dataset.contentUiHidden = prefs.contentUiHidden ? "true" : "";
  root.dataset.mediaDebugOverlay = prefs.mediaDebugOverlay ? "true" : "";
  root.dataset.disableSkinFxForDebug = prefs.disableSkinFxForDebug ? "true" : "";

  void syncDesktopPeekWindow(
    scheme,
    isCustom && !!skin.backgroundImage,
    prefs,
    colors.surface,
  );
}

export function applyMaterialPresetToSkin(
  material: UiMaterial,
  target: "card" | "title" | "both",
): Partial<CustomSkin> {
  const preset = MATERIAL_PRESETS[material];
  const patch: Partial<CustomSkin> = {};
  if (target === "card" || target === "both") {
    patch.cardMaterial = material;
    patch.cardOpacity = preset.cardOpacity;
    patch.cardBlur = preset.cardBlur;
    patch.cardBorderOpacity = preset.cardBorderOpacity;
  }
  if (target === "title" || target === "both") {
    patch.titleMaterial = material;
    patch.titleOpacity = preset.titleOpacity;
    patch.titleBlur = preset.titleBlur;
  }
  return patch;
}

function logAppearance(event: string, payload?: Record<string, unknown>) {
  pushMediaDebug("appearance", event, payload);
}

function briefPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const normalized = path.replace(/\\/g, "/");
  if (normalized.length <= 96) return normalized;
  return `…${normalized.slice(-92)}`;
}

export const useAppearanceStore = defineStore("appearance", () => {
  const saved = loadState();
  const colorScheme = ref<ColorScheme>(saved.colorScheme);
  const customColors = ref<ThemeColors>({ ...saved.customColors });
  const customSkin = ref<CustomSkin>(cloneSkin(saved.customSkin));
  const skinDraft = ref<CustomSkin>(cloneSkin(saved.customSkin));
  const skinPresetId = ref<SkinPresetId | null>(saved.skinPresetId);
  const skinPresetBgm = ref<SkinPresetBgmSettings>({ ...saved.skinPresetBgm });
  const skinBgmSyncNonce = ref(0);
  const skinBgmPlaying = ref(false);

  function setSkinBgmPlaying(playing: boolean) {
    skinBgmPlaying.value = playing;
  }
  const skinDialogOpen = ref(false);
  const uiPreferences = ref<UiPreferences>({ ...saved.uiPreferences });
  setMediaDebugEnabled(uiPreferences.value.mediaDebugOverlay);
  const creativeBackground = ref<CreativeBackgroundSettings>({
    ...saved.creativeBackground,
  });

  /** 字符画解析/缓存进行中（不写入 localStorage） */
  const asciiArtLoading = ref(false);
  const asciiArtProgress = ref(0);
  /** 当前素材源 GIF 帧数（静态图为 1） */
  const asciiArtSourceFrames = ref<number | null>(null);
  /** 按 GIF 原始延时估算的帧率，用于限制滑块上限 */
  const asciiArtNativeFps = ref<number | null>(null);
  const asciiArtNativeLoopMs = ref<number | null>(null);

  function setAsciiArtLoading(loading: boolean, progress?: number) {
    asciiArtLoading.value = loading;
    if (progress !== undefined) {
      asciiArtProgress.value = Math.min(100, Math.max(0, Math.round(progress)));
    }
    if (!loading) {
      asciiArtProgress.value = 0;
    }
  }

  function setAsciiArtSourceFrames(count: number | null) {
    asciiArtSourceFrames.value =
      count != null && count > 0 ? Math.floor(count) : null;
  }

  function setAsciiArtPlaybackMeta(
    meta: { sourceFrames: number; nativeFps: number; nativeLoopMs: number } | null,
  ) {
    if (!meta) {
      asciiArtSourceFrames.value = null;
      asciiArtNativeFps.value = null;
      asciiArtNativeLoopMs.value = null;
      return;
    }
    asciiArtSourceFrames.value = Math.floor(meta.sourceFrames);
    asciiArtNativeFps.value =
      meta.nativeFps > 0 ? Math.round(meta.nativeFps * 10) / 10 : null;
    asciiArtNativeLoopMs.value =
      meta.nativeLoopMs > 0 ? Math.round(meta.nativeLoopMs) : null;
  }

  /** 银河/自定义壁纸与透视桌面互斥，自动关闭已保存的透视开关 */
  function clearDesktopPeekIfBlocked() {
    const blocked =
      colorScheme.value === "galaxy" ||
      (colorScheme.value === "custom" && !!customSkin.value.backgroundImage);
    if (blocked && uiPreferences.value.desktopPeek) {
      uiPreferences.value.desktopPeek = false;
    }
  }

  function applyTheme() {
    const colors = resolveColors(colorScheme.value, customColors.value);
    applyToDocument(
      colorScheme.value,
      colors,
      customSkin.value,
      uiPreferences.value,
      creativeBackground.value,
      skinPresetId.value,
    );
  }

  async function resolveWorkspaceSkinPath(path: string | null): Promise<string | null> {
    if (!path || !isWorkspaceSkinSubpath(path)) return path;
    try {
      return await invoke<string>("workspaces_subpath", { subpath: path });
    } catch {
      return path;
    }
  }

  async function ensureSkinMediaResolved() {
    const bg = customSkin.value.backgroundImage;
    if (bg && isWorkspaceSkinSubpath(bg)) {
      const abs = await resolveWorkspaceSkinPath(bg);
      if (abs && abs !== bg) {
        customSkin.value = { ...customSkin.value, backgroundImage: abs };
        skinDraft.value = cloneSkin(customSkin.value);
        logAppearance("resolve-skin-media-path", {
          from: briefPath(bg),
          to: briefPath(abs),
        });
      }
    }
    if (
      !skinPresetId.value &&
      customSkin.value.backgroundImage?.toLowerCase().includes("cloud.mp4")
    ) {
      skinPresetId.value = "preset-clouds";
    }
  }

  async function applySkinPreset(id: SkinPresetId) {
    const preset = getSkinPreset(id);
    if (!preset) return;
    let abs: string;
    try {
      abs = await invoke<string>("workspaces_subpath", {
        subpath: preset.workspaceSubpath,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logAppearance("apply-skin-preset-failed", { presetId: id, error: errMsg });
      console.error(err);
      return;
    }
    customColors.value = { ...preset.colors };
    customSkin.value = {
      ...cloneSkin(DEFAULT_SKIN),
      ...preset.skin,
      backgroundImage: abs,
      keepVideoAudio: false,
    };
    skinDraft.value = cloneSkin(customSkin.value);
    skinPresetId.value = id;
    if (creativeBackground.value.effect !== "none") {
      creativeBackground.value = { ...creativeBackground.value, effect: "none" };
    }
    colorScheme.value = "custom";
    clearDesktopPeekIfBlocked();
    applyTheme();
    persist();
    skinDialogOpen.value = false;
    requestSkinBgmSync();
    logAppearance("apply-skin-preset", {
      presetId: id,
      background: briefPath(abs),
    });
  }

  function requestSkinBgmSync() {
    skinBgmSyncNonce.value += 1;
  }

  function persist() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        colorScheme: colorScheme.value,
        customColors: customColors.value,
        customSkin: customSkin.value,
        skinPresetId: skinPresetId.value,
        skinPresetBgm: skinPresetBgm.value,
        uiPreferences: uiPreferences.value,
        creativeBackground: creativeBackground.value,
      }),
    );
  }

  function patchSkinPresetBgm(patch: Partial<SkinPresetBgmSettings>) {
    logAppearance("patch-skin-preset-bgm", { ...patch });
    Object.assign(skinPresetBgm.value, patch);
    skinPresetBgm.value.volume = Math.min(
      100,
      Math.max(0, Math.round(Number(skinPresetBgm.value.volume) || 0)),
    );
    persist();
    requestSkinBgmSync();
  }

  function patchCreativeBackground(
    patch: Partial<Omit<CreativeBackgroundSettings, "particleStars" | "asciiArt">> & {
      particleStars?: Partial<ParticleStarsSettings>;
      asciiArt?: Partial<AsciiArtSettings>;
    },
  ) {
    const { particleStars, asciiArt, ...rest } = patch;
    Object.assign(creativeBackground.value, rest);
    if (particleStars) {
      Object.assign(creativeBackground.value.particleStars, particleStars);
    }
    if (asciiArt) {
      Object.assign(creativeBackground.value.asciiArt, asciiArt);
    }
    applyTheme();
    persist();
    logAppearance("patch-creative-background", {
      effect: creativeBackground.value.effect,
      particleStars: particleStars ? { ...particleStars } : undefined,
      asciiArt: asciiArt ? { ...asciiArt } : undefined,
      rest: Object.keys(rest).length ? rest : undefined,
    });
  }

  async function pickAsciiArtSource() {
    const path = await invoke<string | null>("pick_ascii_media_file");
    if (!path) return;
    const name = path.split(/[/\\]/).pop() ?? "source";
    const extMatch = name.match(/\.([a-zA-Z0-9]+)$/);
    const ext = (extMatch?.[1] ?? "png").toLowerCase();
    const subpath = `creative/ascii-art/source.${ext}`;
    await invoke<string>("copy_file_to_workspaces", {
      sourceAbs: path,
      subpath,
    });
    patchCreativeBackground({
      asciiArt: { sourceSubpath: subpath, fileName: name },
    });
    logAppearance("pick-ascii-art-source", { subpath, fileName: name });
  }

  function clearAsciiArtSource() {
    setAsciiArtPlaybackMeta(null);
    patchCreativeBackground({
      asciiArt: { sourceSubpath: null, fileName: null },
    });
    logAppearance("clear-ascii-art-source");
  }

  function refreshAsciiArt() {
    const n = creativeBackground.value.asciiArt.refreshNonce + 1;
    patchCreativeBackground({ asciiArt: { refreshNonce: n } });
  }

  function patchUiPreferences(patch: Partial<UiPreferences>) {
    Object.assign(uiPreferences.value, patch);
    if ("mediaDebugOverlay" in patch) {
      setMediaDebugEnabled(uiPreferences.value.mediaDebugOverlay);
      if (uiPreferences.value.mediaDebugOverlay) {
        logAppearance("debug-terminal-enabled");
      }
    }
    applyTheme();
    persist();
    logAppearance("patch-ui-preferences", { ...patch });
  }

  function setColorScheme(scheme: ColorScheme) {
    if (scheme === "custom") {
      openSkinDialog();
      return;
    }
    const prev = colorScheme.value;
    colorScheme.value = scheme;
    skinPresetId.value = null;
    clearDesktopPeekIfBlocked();
    applyTheme();
    persist();
    logAppearance("set-color-scheme", { from: prev, to: scheme });
  }

  function setCustomColor(key: keyof ThemeColors, value: string) {
    customColors.value[key] = value;
    if (colorScheme.value === "custom") {
      applyTheme();
      persist();
    }
  }

  function resetCustomColors() {
    customColors.value = { ...DEFAULT_CUSTOM };
    if (colorScheme.value === "custom") {
      applyTheme();
      persist();
    }
    logAppearance("reset-custom-colors");
  }

  function openSkinDialog() {
    if (colorScheme.value === "custom") {
      skinDraft.value = cloneSkin(customSkin.value);
    } else {
      skinDraft.value = cloneSkin(DEFAULT_SKIN);
    }
    skinDialogOpen.value = true;
    logAppearance("open-skin-dialog", {
      scheme: colorScheme.value,
      presetId: skinPresetId.value,
      hasBackground: !!skinDraft.value.backgroundImage,
    });
  }

  function closeSkinDialog() {
    skinDialogOpen.value = false;
    logAppearance("close-skin-dialog");
  }

  function patchSkinDraft(
    patch: Partial<Omit<CustomSkin, "bgm">> & { bgm?: Partial<CustomSkinBgm> },
  ) {
    if (patch.titleMaterial === "plain") {
      patch.titleOpacity = 0;
      patch.titleBlur = 0;
    }
    const { bgm, ...rest } = patch;
    Object.assign(skinDraft.value, rest);
    if (bgm) {
      Object.assign(skinDraft.value.bgm, bgm);
    }
  }

  function setKeepVideoAudio(keep: boolean, useDraft = false) {
    logAppearance("set-keep-video-audio", { keep, useDraft });
    if (keep) {
      const empty = { ...DEFAULT_CUSTOM_SKIN_BGM };
      if (useDraft || skinDialogOpen.value) {
        patchSkinDraft({ keepVideoAudio: true, bgm: empty });
      } else {
        customSkin.value = { ...cloneSkin(customSkin.value), keepVideoAudio: true, bgm: empty };
        skinDraft.value = cloneSkin(customSkin.value);
        persist();
      }
      if (skinPresetBgm.value.enabled) {
        patchSkinPresetBgm({ enabled: false });
      } else {
        requestSkinBgmSync();
      }
      return;
    }
    if (useDraft || skinDialogOpen.value) {
      patchSkinDraft({ keepVideoAudio: false });
    } else {
      customSkin.value = { ...cloneSkin(customSkin.value), keepVideoAudio: false };
      skinDraft.value = cloneSkin(customSkin.value);
      persist();
      requestSkinBgmSync();
    }
  }

  function afterBackgroundPicked(path: string, useDraft = true) {
    const isVideo = isCustomSkinVideoBackground(path);
    logAppearance("background-picked", {
      useDraft,
      isVideo,
      path: briefPath(path),
    });
    if (isVideo) {
      const empty = { ...DEFAULT_CUSTOM_SKIN_BGM };
      if (useDraft || skinDialogOpen.value) {
        patchSkinDraft({
          backgroundImage: path,
          keepVideoAudio: true,
          bgm: empty,
        });
      } else {
        customSkin.value = {
          ...cloneSkin(customSkin.value),
          backgroundImage: path,
          keepVideoAudio: true,
          bgm: empty,
        };
        skinDraft.value = cloneSkin(customSkin.value);
      }
      if (skinPresetBgm.value.enabled) {
        patchSkinPresetBgm({ enabled: false });
      }
    } else if (useDraft || skinDialogOpen.value) {
      patchSkinDraft({ backgroundImage: path, keepVideoAudio: false });
    } else {
      patchSkinDraft({ backgroundImage: path, keepVideoAudio: false });
    }
  }

  function canPickCustomSkinBgm(useDraft = false): boolean {
    const skin = useDraft || skinDialogOpen.value ? skinDraft.value : customSkin.value;
    if (skinPresetId.value && colorScheme.value === "custom") return false;
    return !usesCustomVideoAudio(skin);
  }

  async function pickCustomSkinBgm(useDraft = false) {
    if (!canPickCustomSkinBgm(useDraft)) return;

    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: "音频",
          extensions: ["mp3", "wav", "ogg", "flac", "m4a", "aac", "webm"],
        },
      ],
    });
    if (!selected || Array.isArray(selected)) return;

    logAppearance("pick-custom-skin-bgm-start", { useDraft });

    const name = selected.split(/[/\\]/).pop() ?? "bgm.mp3";
    const extMatch = name.match(/\.([a-zA-Z0-9]+)$/);
    const ext = (extMatch?.[1] ?? "mp3").toLowerCase();
    const subpath = `skin-custom/bgm.${ext}`;
    await invoke<string>("copy_file_to_workspaces", {
      sourceAbs: selected,
      subpath,
    });
    const display = parseBgmFileLabel(name);
    const bgmPatch = {
      workspaceSubpath: subpath,
      fileName: name,
      title: display.title,
      artist: display.artist,
    };
    if (useDraft || skinDialogOpen.value) {
      patchSkinDraft({ bgm: bgmPatch });
    } else {
      customSkin.value = {
        ...cloneSkin(customSkin.value),
        bgm: { ...normalizeCustomSkinBgm(bgmPatch) },
      };
      skinDraft.value = cloneSkin(customSkin.value);
      persist();
    }
    if (!skinPresetBgm.value.enabled) {
      patchSkinPresetBgm({ enabled: true });
    } else {
      requestSkinBgmSync();
    }
    logAppearance("pick-custom-skin-bgm", { subpath, useDraft });
  }

  function clearCustomSkinBgm(useDraft = false) {
    logAppearance("clear-custom-skin-bgm", { useDraft });
    const empty = { ...DEFAULT_CUSTOM_SKIN_BGM };
    if (useDraft || skinDialogOpen.value) {
      patchSkinDraft({ bgm: empty });
    } else {
      customSkin.value = { ...cloneSkin(customSkin.value), bgm: empty };
      skinDraft.value = cloneSkin(customSkin.value);
      persist();
    }
    requestSkinBgmSync();
  }

  function patchCustomSkinBgmMeta(
    patch: Partial<Pick<CustomSkinBgm, "title" | "artist">>,
    useDraft = false,
  ) {
    if (useDraft || skinDialogOpen.value) {
      patchSkinDraft({ bgm: patch });
      return;
    }
    Object.assign(customSkin.value.bgm, patch);
    skinDraft.value = cloneSkin(customSkin.value);
    persist();
    requestSkinBgmSync();
  }

  function setCardMaterial(material: UiMaterial) {
    patchSkinDraft(applyMaterialPresetToSkin(material, "card"));
  }

  function setTitleMaterial(material: TitleMaterial) {
    if (material === "plain") {
      patchSkinDraft({ titleMaterial: "plain", titleOpacity: 0, titleBlur: 0 });
      return;
    }
    patchSkinDraft(applyMaterialPresetToSkin(material, "title"));
  }

  function getSkinImageUrl(path: string | null): string | null {
    if (!path) return null;
    const normalized = normalizeSkinMediaPath(path);
    // 打包资源（银河壁纸等）、data/blob、http — 勿走 convertFileSrc
    if (
      normalized.startsWith("data:") ||
      normalized.startsWith("blob:") ||
      normalized.startsWith("http://") ||
      normalized.startsWith("https://") ||
      normalized.startsWith("/") ||
      normalized.startsWith("asset://")
    ) {
      return normalized;
    }
    try {
      return convertFileSrc(normalized);
    } catch {
      return normalized;
    }
  }

  function activeSkinPreset() {
    return getSkinPreset(skinPresetId.value);
  }

  function activeSkinBgm(): ActiveSkinBgm | null {
    if (colorScheme.value !== "custom") return null;

    const preset = getSkinPreset(skinPresetId.value);
    if (preset?.bgmWorkspaceSubpath) {
      return {
        workspaceSubpath: preset.bgmWorkspaceSubpath,
        display: preset.bgmDisplay ?? { title: "背景音乐", artist: "" },
      };
    }

    if (usesCustomVideoAudio(customSkin.value)) {
      return null;
    }

    const bgm = customSkin.value.bgm;
    if (bgm.workspaceSubpath) {
      return {
        workspaceSubpath: bgm.workspaceSubpath,
        display: {
          title: bgm.title || bgm.fileName?.replace(/\.[^.]+$/, "") || "本地音乐",
          artist: bgm.artist,
        },
      };
    }

    return null;
  }

  function setBackgroundFromFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        skinPresetId.value = null;
        afterBackgroundPicked(reader.result, true);
      }
    };
    reader.readAsDataURL(file);
  }

  async function pickBackgroundImage() {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: "图片 / 视频",
          extensions: [...SKIN_BACKGROUND_EXTENSIONS],
        },
      ],
    });
    if (!selected || Array.isArray(selected)) return;
    skinPresetId.value = null;
    afterBackgroundPicked(selected, true);
  }

  function clearBackgroundImage() {
    skinPresetId.value = null;
    patchSkinDraft({ backgroundImage: null });
    logAppearance("clear-background-image");
  }

  function saveAndApplySkin() {
    customSkin.value = cloneSkin(skinDraft.value);
    const stillPreset = SKIN_PRESET_LIST.some(
      (p) =>
        customSkin.value.backgroundImage?.replace(/\\/g, "/").includes(p.workspaceSubpath),
    );
    if (!stillPreset) {
      skinPresetId.value = null;
    }
    colorScheme.value = "custom";
    applyTheme();
    persist();
    closeSkinDialog();
    requestSkinBgmSync();
    logAppearance("save-and-apply-skin", {
      presetId: skinPresetId.value,
      background: briefPath(customSkin.value.backgroundImage),
      keepVideoAudio: customSkin.value.keepVideoAudio,
    });
  }

  async function init() {
    await ensureSkinMediaResolved();
    clearDesktopPeekIfBlocked();
    applyTheme();
    if (
      colorScheme.value === "galaxy" ||
      (colorScheme.value === "custom" && customSkin.value.backgroundImage)
    ) {
      persist();
    }
    logAppearance("init", {
      colorScheme: colorScheme.value,
      presetId: skinPresetId.value,
      hasBackground: !!customSkin.value.backgroundImage,
      desktopPeek: uiPreferences.value.desktopPeek,
    });
  }

  watch(customColors, () => {
    if (colorScheme.value === "custom") {
      applyTheme();
      persist();
    }
  }, { deep: true });

  return {
    colorScheme,
    customColors,
    customSkin,
    skinPresetId,
    skinPresetBgm,
    skinBgmPlaying,
    setSkinBgmPlaying,
    skinBgmSyncNonce,
    requestSkinBgmSync,
    skinDraft,
    skinDialogOpen,
    uiPreferences,
    creativeBackground,
    asciiArtLoading,
    asciiArtProgress,
    asciiArtSourceFrames,
    asciiArtNativeFps,
    asciiArtNativeLoopMs,
    setAsciiArtLoading,
    setAsciiArtSourceFrames,
    setAsciiArtPlaybackMeta,
    init,
    applyTheme,
    setColorScheme,
    setCustomColor,
    resetCustomColors,
    openSkinDialog,
    closeSkinDialog,
    patchSkinDraft,
    setCardMaterial,
    setTitleMaterial,
    getSkinImageUrl,
    activeSkinPreset,
    activeSkinBgm,
    applySkinPreset,
    patchSkinPresetBgm,
    setKeepVideoAudio,
    canPickCustomSkinBgm,
    pickCustomSkinBgm,
    clearCustomSkinBgm,
    patchCustomSkinBgmMeta,
    isCustomSkinVideoBackground,
    pickBackgroundImage,
    setBackgroundFromFile,
    clearBackgroundImage,
    saveAndApplySkin,
    patchUiPreferences,
    patchCreativeBackground,
    pickAsciiArtSource,
    clearAsciiArtSource,
    refreshAsciiArt,
    resolveActiveColors: () => resolveColors(colorScheme.value, customColors.value),
  };
});
