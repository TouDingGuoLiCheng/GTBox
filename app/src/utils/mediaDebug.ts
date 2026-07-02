import { reactive } from "vue";

/**
 * 应用调试终端日志。仅在「显示调试终端」开启时写入，避免长期占用内存。
 * 新增重要业务操作时请调用 pushMediaDebug，勿直接改 mediaDebugState.entries。
 */
export interface MediaDebugEntry {
  time: string;
  source: string;
  event: string;
  /** 可读单行说明（优先于 payload 展示） */
  detail?: string;
  payload?: Record<string, unknown>;
}

const MAX_ENTRIES = 500;

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

/** 写入一行调试日志（detail 为主文案，payload 为补充字段） */
export function pushDebugLine(
  source: string,
  event: string,
  detail?: string,
  payload?: Record<string, unknown>,
) {
  pushMediaDebug(source, event, detail, payload);
}

export function pushMediaDebug(
  source: string,
  eventOrPayload: string | Record<string, unknown>,
  detailOrPayload?: string | Record<string, unknown>,
  payload?: Record<string, unknown>,
) {
  if (!debugEnabled) return;

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");

  let event: string;
  let detail: string | undefined;
  let mergedPayload: Record<string, unknown> | undefined;

  if (typeof eventOrPayload === "string") {
    event = eventOrPayload;
    if (typeof detailOrPayload === "string") {
      detail = detailOrPayload;
      mergedPayload = payload;
    } else {
      mergedPayload = detailOrPayload;
    }
  } else {
    event = "state";
    mergedPayload = eventOrPayload;
  }

  mediaDebugState.entries.push({
    time: `${hh}:${mm}:${ss}.${ms}`,
    source,
    event,
    detail,
    payload: mergedPayload && Object.keys(mergedPayload).length ? mergedPayload : undefined,
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
