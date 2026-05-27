import type { OverlayBgLayout } from "./types";

export const DEFAULT_OVERLAY_BG_LAYOUT: OverlayBgLayout = {
  posX: 50,
  posY: 50,
  zoom: 100,
};

export function clampBgPos(v: number) {
  return Math.min(100, Math.max(0, Math.round(v)));
}

export function clampBgZoom(v: number) {
  return Math.min(250, Math.max(50, Math.round(v)));
}

export function normalizeOverlayBgLayout(raw?: Partial<OverlayBgLayout>): OverlayBgLayout {
  return {
    posX: clampBgPos(raw?.posX ?? DEFAULT_OVERLAY_BG_LAYOUT.posX),
    posY: clampBgPos(raw?.posY ?? DEFAULT_OVERLAY_BG_LAYOUT.posY),
    zoom: clampBgZoom(raw?.zoom ?? DEFAULT_OVERLAY_BG_LAYOUT.zoom),
  };
}

export function layoutToBackgroundStyle(
  layout: OverlayBgLayout,
  dataUrl: string,
): Record<string, string> {
  const size = layout.zoom === 100 ? "cover" : `${layout.zoom}%`;
  return {
    backgroundImage: `url("${dataUrl}")`,
    backgroundPosition: `${layout.posX}% ${layout.posY}%`,
    backgroundSize: size,
    backgroundRepeat: "no-repeat",
  };
}

export function panLayoutByPixels(
  layout: OverlayBgLayout,
  dx: number,
  dy: number,
  boxW: number,
  boxH: number,
): OverlayBgLayout {
  if (boxW <= 0 || boxH <= 0) return layout;
  const scale = Math.max(layout.zoom, 80) / 100;
  const factor = 100 / scale;
  return {
    ...layout,
    posX: clampBgPos(layout.posX - (dx / boxW) * factor),
    posY: clampBgPos(layout.posY - (dy / boxH) * factor),
  };
}

export function zoomLayoutByWheel(layout: OverlayBgLayout, deltaY: number): OverlayBgLayout {
  const step = deltaY > 0 ? -4 : 4;
  return { ...layout, zoom: clampBgZoom(layout.zoom + step) };
}
