import { normalizeOverlayWaveColor } from "./overlayTheme";
import { normalizeOverlayBgLayout } from "./overlayBgLayout";
import { normalizeOverlayPlacement } from "./overlayLayout";
import { normalizeAsrEngine } from "./engines";
import type { SrSettings } from "./types";

export type ThemeKey = "dark" | "light";

export function themeKey(appTheme: string): ThemeKey {
  return appTheme === "light" ? "light" : "dark";
}

export function applyAppTheme(settings: Pick<SrSettings, "appTheme">) {
  const key = themeKey(settings.appTheme);
  const root = document.documentElement;
  root.classList.remove("theme-dark", "theme-light");
  root.classList.add(`theme-${key}`);
  document.body.style.background = "var(--shell-bg)";
  const app = document.getElementById("app");
  if (app) app.style.background = "var(--shell-bg)";
}

export function normalizeSettings(raw: SrSettings): SrSettings {
  return {
    ...raw,
    asrEngine: normalizeAsrEngine(raw.asrEngine),
    bubbleTriggerMode: raw.bubbleTriggerMode === "hold" ? "hold" : "click",
    appTheme: raw.appTheme === "light" ? "light" : "dark",
    overlayOpacity: Math.min(100, Math.max(50, raw.overlayOpacity ?? 88)),
    overlayBackground: raw.overlayBackground?.trim() ?? "",
    overlayBgLayout: normalizeOverlayBgLayout(raw.overlayBgLayout),
    overlayTextColor: raw.overlayTextColor?.trim() ?? "",
    overlayWaveColor: normalizeOverlayWaveColor(raw.overlayWaveColor),
    overlayPlacement: normalizeOverlayPlacement(raw.overlayPlacement),
    overlayEdgeMargin: Math.min(120, Math.max(0, raw.overlayEdgeMargin ?? 12)),
    overlayTrayGap: Math.min(160, Math.max(40, raw.overlayTrayGap ?? 72)),
  };
}
