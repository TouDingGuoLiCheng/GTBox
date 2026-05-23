import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { defineStore } from "pinia";
import { computed, ref } from "vue";

export type ImageScanStatus = "pending" | "scanning" | "done" | "error";
export type BatchPhase = "idle" | "warming" | "scanning" | "finalizing";
export type ActivePlugin = "playlist_ocr" | "full_auto_download" | null;

export type BatchImage = { path: string; name: string; key: string };

function imageCacheKey(imagePath: string) {
  return imagePath.replace(/\\/g, "/").toLowerCase();
}

function stripLogPrefix(line: string) {
  const m = line.match(/^\[(stdout|stderr)\]\s*(.*)$/);
  return m ? m[2] : line;
}

export const useMusicCrawlRunStore = defineStore("musicCrawlRun", () => {
  const runId = ref<string | null>(null);
  const running = ref(false);
  const activePlugin = ref<ActivePlugin>(null);
  const logs = ref<string[]>([]);
  const lastExitCode = ref<number | null>(null);
  const lastFinishedPlugin = ref<ActivePlugin>(null);

  const batchImages = ref<BatchImage[]>([]);
  const imageStatus = ref<Record<string, ImageScanStatus>>({});
  const nameToKey = ref<Record<string, string>>({});
  const batchPhase = ref<BatchPhase>("idle");
  const batchDone = ref(0);
  const batchCurrentKey = ref("");
  const batchCurrentName = ref("");
  /** 批量扫描中刚完成一张图，供 UI 从 regions 缓存加载 OCR 框 */
  const lastRegionsReady = ref<{ name: string; path: string } | null>(null);

  let listenersAttached = false;
  const unlisteners: UnlistenFn[] = [];

  const ocrBatchActive = computed(
    () => running.value && activePlugin.value === "playlist_ocr" && batchImages.value.length > 0,
  );
  const batchTotal = computed(() => batchImages.value.length);
  const batchProgressPercent = computed(() => {
    if (!ocrBatchActive.value || batchTotal.value === 0) return 0;
    if (batchPhase.value === "warming" && batchDone.value === 0) return 8;
    if (batchPhase.value === "finalizing") return 100;
    return Math.min(100, Math.round((batchDone.value / batchTotal.value) * 100));
  });
  const batchStatusLabel = computed(() => {
    if (!ocrBatchActive.value) return "";
    if (batchPhase.value === "warming" && batchDone.value === 0) {
      return "正在加载识别引擎，请稍候…";
    }
    if (batchPhase.value === "finalizing") {
      return "正在汇总并写入歌单…";
    }
    if (batchCurrentName.value) {
      return `正在识别：${batchCurrentName.value}（${batchDone.value}/${batchTotal.value}）`;
    }
    return `批量识别中（${batchDone.value}/${batchTotal.value}）`;
  });

  function appendLog(line: string) {
    logs.value = [...logs.value, line].slice(-800);
  }

  function resetBatch() {
    batchImages.value = [];
    imageStatus.value = {};
    nameToKey.value = {};
    batchPhase.value = "idle";
    batchDone.value = 0;
    batchCurrentKey.value = "";
    batchCurrentName.value = "";
  }

  function beginBatchScan(images: Array<{ name: string; path: string }>) {
    const list: BatchImage[] = images.map((img) => ({
      name: img.name,
      path: img.path,
      key: imageCacheKey(img.path),
    }));
    const status: Record<string, ImageScanStatus> = {};
    const names: Record<string, string> = {};
    for (const img of list) {
      status[img.key] = "pending";
      names[img.name] = img.key;
    }
    if (list.length > 0) {
      status[list[0].key] = "scanning";
      batchCurrentKey.value = list[0].key;
      batchCurrentName.value = list[0].name;
    }
    batchImages.value = list;
    imageStatus.value = status;
    nameToKey.value = names;
    batchPhase.value = "warming";
    batchDone.value = 0;
    lastRegionsReady.value = null;
  }

  function setImageStatus(key: string, status: ImageScanStatus) {
    if (!key) return;
    imageStatus.value = { ...imageStatus.value, [key]: status };
  }

  function advanceAfterImageDone(finishedName: string) {
    const finishedKey = nameToKey.value[finishedName];
    if (finishedKey) {
      setImageStatus(finishedKey, "done");
    }
    const finishedImg = batchImages.value.find((img) => img.name === finishedName);
    if (finishedImg) {
      lastRegionsReady.value = { name: finishedName, path: finishedImg.path };
    }
    batchDone.value += 1;
    batchPhase.value = "scanning";

    const next = batchImages.value.find((img) => imageStatus.value[img.key] === "pending");
    if (next) {
      setImageStatus(next.key, "scanning");
      batchCurrentKey.value = next.key;
      batchCurrentName.value = next.name;
    } else {
      batchCurrentKey.value = "";
      batchCurrentName.value = "";
      batchPhase.value = "finalizing";
    }
  }

  function handleLogLine(rawLine: string) {
    const line = stripLogPrefix(rawLine);
    const doneMatch = line.match(/\[([^\]]+)\]\s*识别:/);
    if (doneMatch) {
      advanceAfterImageDone(doneMatch[1]);
      return;
    }
    if (/songs\.txt\s*已写入/i.test(line) || /已写入:\s*.+songs\.txt/i.test(line)) {
      batchPhase.value = "finalizing";
    }
    if (batchPhase.value === "warming" && /Creating model|OCR 设备|PP-OCR/i.test(line)) {
      batchPhase.value = "scanning";
    }
  }

  function finishBatch(success: boolean) {
    const next: Record<string, ImageScanStatus> = { ...imageStatus.value };
    for (const img of batchImages.value) {
      const cur = next[img.key];
      if (cur === "scanning") {
        next[img.key] = success ? "done" : "error";
      } else if (success && cur === "pending") {
        next[img.key] = "done";
      }
    }
    imageStatus.value = next;
    batchPhase.value = "idle";
    batchCurrentKey.value = "";
    batchCurrentName.value = "";
  }

  function getImageStatus(path: string): ImageScanStatus | null {
    if (!path) return null;
    return imageStatus.value[imageCacheKey(path)] ?? null;
  }

  async function ensureListeners() {
    if (listenersAttached) return;
    listenersAttached = true;

    unlisteners.push(
      await listen<{ runId: string; stream: string; line: string }>("tool:log", (event) => {
        if (!runId.value || event.payload.runId !== runId.value) return;
        const line = `[${event.payload.stream}] ${event.payload.line}`;
        appendLog(line);
        handleLogLine(line);
      }),
    );

    unlisteners.push(
      await listen<{ runId: string; code: number }>("tool:exit", (event) => {
        if (!runId.value || event.payload.runId !== runId.value) return;
        lastExitCode.value = event.payload.code;
        const plugin = activePlugin.value;
        lastFinishedPlugin.value = plugin;
        const success = event.payload.code === 0;
        if (plugin === "playlist_ocr") {
          finishBatch(success);
        }
        appendLog(`进程结束，退出码：${event.payload.code}`);
        running.value = false;
        runId.value = null;
        activePlugin.value = null;
      }),
    );
  }

  async function startTool(pluginId: ActivePlugin, params: Record<string, unknown>) {
    if (!pluginId || running.value) return;
    await ensureListeners();
    lastExitCode.value = null;
    logs.value = [];
    running.value = true;
    activePlugin.value = pluginId;
    try {
      runId.value = await invoke<string>("run_tool", { pluginId, params });
    } catch (err) {
      running.value = false;
      activePlugin.value = null;
      if (pluginId === "playlist_ocr") {
        finishBatch(false);
      }
      throw err;
    }
  }

  async function cancelRun() {
    if (!runId.value) return;
    await invoke<boolean>("cancel_run", { runId: runId.value });
  }

  return {
    runId,
    running,
    activePlugin,
    logs,
    lastExitCode,
    lastFinishedPlugin,
    batchImages,
    imageStatus,
    batchPhase,
    batchDone,
    batchCurrentKey,
    batchCurrentName,
    lastRegionsReady,
    ocrBatchActive,
    batchTotal,
    batchProgressPercent,
    batchStatusLabel,
    toImageCacheKey: imageCacheKey,
    appendLog,
    resetBatch,
    beginBatchScan,
    getImageStatus,
    ensureListeners,
    startTool,
    cancelRun,
  };
});
