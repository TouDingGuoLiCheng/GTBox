export type AsrEngineId = "sherpa-onnx";

export interface AsrEngineOption {
  id: AsrEngineId | string;
  name: string;
  available: boolean;
  badge?: string;
}

/** 可切换的识别引擎（未开放的项仅展示，不可选） */
export const ASR_ENGINE_OPTIONS: AsrEngineOption[] = [
  { id: "sherpa-onnx", name: "Sherpa-ONNX", available: true },
  { id: "whisper-local", name: "Whisper", available: false, badge: "即将推出" },
];

export function normalizeAsrEngine(id: string | undefined): AsrEngineId {
  return id === "sherpa-onnx" ? "sherpa-onnx" : "sherpa-onnx";
}

export function engineDisplayName(id: string): string {
  return ASR_ENGINE_OPTIONS.find((e) => e.id === id)?.name ?? id;
}
