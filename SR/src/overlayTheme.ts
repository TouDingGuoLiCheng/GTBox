import { layoutToBackgroundStyle, normalizeOverlayBgLayout } from "./overlayBgLayout";
import type { OverlayAppearance, SrSettings } from "./types";
import { themeKey } from "./theme";

const GLASS_RGB: Record<"dark" | "light", [number, number, number]> = {
  dark: [18, 20, 28],
  light: [255, 255, 255],
};

const BAR_RGB: Record<"dark" | "light", [string, string]> = {
  dark: ["#6eb5ff", "#3d7ee8"],
  light: ["#38bdf8", "#2563eb"],
};

function parseHexColor(raw: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(raw.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b]
    .map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0"))
    .join("")}`;
}

function darkenHex(hex: string, amount = 0.22): string {
  const rgb = parseHexColor(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb.map((c) => c * (1 - amount));
  return rgbToHex(r, g, b);
}

export function normalizeOverlayWaveColor(raw: string | undefined | null): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return "";
  const rgb = parseHexColor(trimmed);
  if (!rgb) return "";
  return rgbToHex(...rgb);
}

export function defaultOverlayWaveColor(appTheme: string) {
  return BAR_RGB[themeKey(appTheme)][0];
}

export function defaultOverlayTextColor(appTheme: string) {
  return themeKey(appTheme) === "light" ? "#1a1a22" : "#e8ecf4";
}

export function overlayAppearanceFromSettings(s: SrSettings): OverlayAppearance {
  return {
    appTheme: s.appTheme === "light" ? "light" : "dark",
    overlayOpacity: s.overlayOpacity ?? 88,
    overlayBgLayout: normalizeOverlayBgLayout(s.overlayBgLayout),
    overlayTextColor: s.overlayTextColor?.trim() || "",
    overlayWaveColor: normalizeOverlayWaveColor(s.overlayWaveColor),
  };
}

function waveGradientColors(appearance: OverlayAppearance): [string, string] {
  const key = appearance.appTheme;
  const custom = appearance.overlayWaveColor.trim();
  if (custom) {
    return [custom, darkenHex(custom)];
  }
  return BAR_RGB[key];
}

export function overlayCssVars(appearance: OverlayAppearance): Record<string, string> {
  const key = appearance.appTheme;
  const textColor =
    appearance.overlayTextColor.trim() || defaultOverlayTextColor(appearance.appTheme);
  const [waveA, waveB] = waveGradientColors(appearance);
  return {
    "--overlay-text": textColor,
    "--bar-a": BAR_RGB[key][0],
    "--bar-b": BAR_RGB[key][1],
    "--confirm-color": BAR_RGB[key][0],
    "--wave-a": waveA,
    "--wave-b": waveB,
  };
}

export function overlayGlassStyle(appearance: OverlayAppearance): Record<string, string> {
  const key = appearance.appTheme;
  const a = Math.min(100, Math.max(50, appearance.overlayOpacity)) / 100;
  const [r, g, b] = GLASS_RGB[key];
  return {
    backgroundColor: `rgba(${r}, ${g}, ${b}, ${a})`,
  };
}

export function overlayBgImageStyle(
  appearance: OverlayAppearance,
  backgroundDataUrl: string | null | undefined,
): Record<string, string> | null {
  if (!backgroundDataUrl?.trim()) return null;
  const layout = normalizeOverlayBgLayout(appearance.overlayBgLayout);
  return layoutToBackgroundStyle(layout, backgroundDataUrl.trim());
}

export function overlayCardStyle(
  appearance: OverlayAppearance,
  backgroundDataUrl: string | null | undefined,
): Record<string, string> {
  const key = appearance.appTheme;
  return {
    ...overlayCssVars(appearance),
    ...overlayGlassStyle(appearance),
    ...(overlayBgImageStyle(appearance, backgroundDataUrl) ?? {}),
    border: `1px solid ${key === "light" ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.1)"}`,
  };
}

export function applyOverlayTheme(appearance: OverlayAppearance) {
  const root = document.documentElement;
  root.classList.remove("theme-dark", "theme-light");
  root.classList.add(appearance.appTheme === "light" ? "theme-light" : "theme-dark");
}
