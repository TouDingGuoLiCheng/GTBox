/** 悬浮条与 Tauri 窗口共用尺寸（须与 src-tauri/src/overlay.rs 一致） */

export const OVERLAY_CARD_WIDTH = 336;

export const OVERLAY_FOOTER_HEIGHT = 52;

export const OVERLAY_CARD_HEIGHT = OVERLAY_FOOTER_HEIGHT;

export const OVERLAY_TEXT_LINE_HEIGHT = 20;

export const OVERLAY_TEXT_PADDING_Y = 8;

export const OVERLAY_TEXT_PADDING_X = 12;

/** 文字区最大高度，超出后内部滚动 */

export const OVERLAY_MAX_TEXT_HEIGHT = 108;

export const OVERLAY_MAX_HEIGHT =

  OVERLAY_FOOTER_HEIGHT + OVERLAY_MAX_TEXT_HEIGHT;

export const OVERLAY_BAR_COUNT = 28;

export const OVERLAY_BAR_WIDTH = 4;

export const OVERLAY_BAR_GAP = 3;

export const OVERLAY_WAVE_HEIGHT = 32;

export const OVERLAY_SILENT_RMS = 0.025;

export const OVERLAY_IDLE_BAR_HEIGHT = 4;



export const OVERLAY_WAVE_WIDTH =

  OVERLAY_BAR_COUNT * OVERLAY_BAR_WIDTH +

  (OVERLAY_BAR_COUNT - 1) * OVERLAY_BAR_GAP;



export type OverlayPlacement =

  | "bottom-center"

  | "bottom-right"

  | "bottom-left"

  | "top-center"

  | "top-right"

  | "top-left"

  | "center";



export const OVERLAY_PLACEMENT_OPTIONS: { value: OverlayPlacement; label: string }[] =

  [

    { value: "bottom-center", label: "底部居中" },

    { value: "bottom-right", label: "底部靠右" },

    { value: "bottom-left", label: "底部靠左" },

    { value: "top-center", label: "顶部居中" },

    { value: "top-right", label: "顶部靠右" },

    { value: "top-left", label: "顶部靠左" },

    { value: "center", label: "屏幕正中" },

  ];



export function normalizeOverlayPlacement(raw?: string): OverlayPlacement {

  const allowed = OVERLAY_PLACEMENT_OPTIONS.map((o) => o.value);

  if (raw && allowed.includes(raw as OverlayPlacement)) {

    return raw as OverlayPlacement;

  }

  return "bottom-center";

}



export function clampOverlayHeight(height: number): number {

  return Math.min(

    OVERLAY_MAX_HEIGHT,

    Math.max(OVERLAY_FOOTER_HEIGHT, Math.round(height)),

  );

}



export function overlayHeightForText(text: string): number {

  const trimmed = text.trim();

  if (!trimmed) return OVERLAY_FOOTER_HEIGHT;

  const lines = trimmed.split("\n").length;

  const approxCharsPerLine = 28;

  const wrapped = Math.ceil(trimmed.length / approxCharsPerLine);

  const lineCount = Math.max(lines, wrapped, 1);

  const textHeight = Math.min(

    OVERLAY_MAX_TEXT_HEIGHT,

    lineCount * OVERLAY_TEXT_LINE_HEIGHT + OVERLAY_TEXT_PADDING_Y * 2,

  );

  return clampOverlayHeight(OVERLAY_FOOTER_HEIGHT + textHeight);

}


