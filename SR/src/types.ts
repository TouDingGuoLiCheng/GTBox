export type OutputMode = "paste" | "type" | "clipboard";

export interface OverlayBgLayout {
  posX: number;
  posY: number;
  zoom: number;
}

export interface OverlayAppearance {
  appTheme: "dark" | "light";
  overlayOpacity: number;
  overlayBgLayout: OverlayBgLayout;
  overlayTextColor: string;
  overlayWaveColor: string;
}

export type BubbleTriggerMode = "click" | "hold";
export type AsrEngineId = "sherpa-onnx";

export interface SrSettings {
  enabled: boolean;
  hotkey: string;
  confirmHotkey: string;
  bubbleTriggerMode: BubbleTriggerMode;
  asrEngine: AsrEngineId;
  /** 由后端自动解析，设置页不展示 */
  modelDir: string;
  audioDeviceName: string | null;
  outputMode: OutputMode;
  restoreClipboard: boolean;
  appTheme: "dark" | "light";
  overlayOpacity: number;
  overlayBackground: string;
  overlayBgLayout: OverlayBgLayout;
  overlayTextColor: string;
  overlayWaveColor: string;
  overlayPlacement: string;
  overlayEdgeMargin: number;
  overlayTrayGap: number;
  launchAtStartup: boolean;
  clearLogOnStartup: boolean;
}

export type SettingsTab = "engine" | "input" | "appearance" | "diag";

export interface EngineStatus {
  state: "idle" | "loading" | "ready" | "error";
  message?: string;
}

export interface AudioDeviceInfo {
  name: string;
  isDefault: boolean;
}
