import { reactive } from "vue";

/**
 * 应用调试终端日志。仅在「显示媒体调试终端」开启时写入，避免长期占用内存。
 * 新增重要业务操作时请调用 pushMediaDebug，勿直接改 mediaDebugState.entries。
 */
export interface MediaDebugEntry {
  time: string;
  source: string;
  event: string;
  payload?: Record<string, unknown>;
}

const MAX_ENTRIES = 180;

let debugEnabled = false;

export const mediaDebugState = reactive({
  entries: [] as MediaDebugEntry[],
});

export function isMediaDebugEnabled(): boolean {
  return debugEnabled;
}

export function setMediaDebugEnabled(enabled: boolean) {
  debugEnabled = enabled;
  if (!enabled) {
    mediaDebugState.entries = [];
  }
}

export function pushMediaDebug(
  source: string,
  eventOrPayload: string | Record<string, unknown>,
  payload?: Record<string, unknown>,
) {
  if (!debugEnabled) return;

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  const event = typeof eventOrPayload === "string" ? eventOrPayload : "state";
  const mergedPayload =
    typeof eventOrPayload === "string" ? payload : eventOrPayload;

  mediaDebugState.entries.push({
    time: `${hh}:${mm}:${ss}`,
    source,
    event,
    payload: mergedPayload,
  });
  if (mediaDebugState.entries.length > MAX_ENTRIES) {
    mediaDebugState.entries.splice(
      0,
      mediaDebugState.entries.length - MAX_ENTRIES,
    );
  }
}

export function clearMediaDebug() {
  mediaDebugState.entries = [];
}
