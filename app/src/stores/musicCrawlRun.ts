import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { pushDebugLine } from "../utils/mediaDebug";

export type ImageScanStatus = "pending" | "scanning" | "done" | "error";
export type BatchPhase = "idle" | "warming" | "scanning" | "finalizing";
export type ActivePlugin = "playlist_ocr" | "full_auto_download" | null;

export type BatchImage = { path: string; name: string; key: string };

export type CrawlSongStatus = "success" | "failed";
export type CrawlSongResult = { status: CrawlSongStatus; note?: string };

/** 把「歌名-歌手」字符串规范化成稳定的匹配 key（忽略空格、大小写）。
 * 后端脚本里 query = `${song}-${artist}`，前端按这个 key 去比对。 */
export function songQueryKey(query: string) {
  return query.trim().toLowerCase().replace(/\s+/g, "");
}

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
  /** OCR 引擎加载进度（由 Python `[OCR-PROGRESS]` 日志驱动） */
  const engineLoadPercent = ref(0);
  /** 最近一次 `[OCR-PROGRESS]` 文案，用于进度条标题 */
  const engineLoadMessage = ref("");
  /** 批量扫描中刚完成一张图，供 UI 从 regions 缓存加载 OCR 框 */
  const lastRegionsReady = ref<{ name: string; path: string } | null>(null);

  /** 阶段B：按 songQueryKey 缓存每首歌的最新下载状态。
   * 由日志驱动；视图层订阅后写回自己的 songs 列表与持久化文件。 */
  const crawlStatuses = ref<Record<string, CrawlSongResult>>({});
  /** 当前正在被脚本处理的 query 字符串（原始 song-artist），未规范化。 */
  const crawlCurrentQuery = ref("");
  /** 阶段B：2t58 触发每日下载限制时由日志驱动置 true，UI 据此弹出更新 Cookie 对话框。
   * 用 number（时间戳）便于触发多次提示 / watch 同值不重复触发。 */
  const siteRateLimitHitAt = ref(0);
  const siteRateLimitMessage = ref("");
  /** 阶段B：自动过人机验证失败时由 [human-verify] 日志驱动，UI 弹窗并打开网页。 */
  const humanVerifyHitAt = ref(0);
  const humanVerifyMessage = ref("");

  let listenersAttached = false;
  const unlisteners: UnlistenFn[] = [];

  const ocrBatchActive = computed(
    () => running.value && activePlugin.value === "playlist_ocr" && batchImages.value.length > 0,
  );
  const batchTotal = computed(() => batchImages.value.length);
  const batchProgressPercent = computed(() => {
    if (!ocrBatchActive.value || batchTotal.value === 0) return 0;
    if (engineLoadPercent.value > 0) {
      return engineLoadPercent.value;
    }
    if (batchPhase.value === "warming" && batchDone.value === 0) return 0;
    if (batchPhase.value === "finalizing") return 100;
    return Math.min(100, Math.round((batchDone.value / batchTotal.value) * 100));
  });
  const batchStatusLabel = computed(() => {
    if (!ocrBatchActive.value) return "";
    if (engineLoadMessage.value) return engineLoadMessage.value;
    if (batchPhase.value === "warming" && batchDone.value === 0) {
      return engineLoadMessage.value || "正在启动子进程…";
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
    const plugin = activePlugin.value;
    if (!plugin) return;
    const stripped = stripLogPrefix(line);
    const isStderr = /^\[stderr\]/i.test(line);
    const source = plugin === "playlist_ocr" ? "歌单OCR" : "音乐爬取";
    pushDebugLine(
      source,
      isStderr ? "python-stderr" : "python-stdout",
      stripped,
      { plugin, stream: isStderr ? "stderr" : "stdout" },
    );
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
    engineLoadPercent.value = 0;
    engineLoadMessage.value = "";
    lastRegionsReady.value = null;
    pushDebugLine(
      "歌单OCR",
      "batch-init",
      `批量任务初始化：${list.length} 张截图`,
      { names: list.map((i) => i.name) },
    );
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
    if (activePlugin.value === "full_auto_download") {
      handleCrawlLogLine(line);
      return;
    }
    const progressMatch = line.match(/^\[OCR-PROGRESS\]\s*(\d+)\s+(.+)$/);
    if (progressMatch) {
      engineLoadPercent.value = Math.min(100, Number.parseInt(progressMatch[1], 10));
      engineLoadMessage.value = progressMatch[2];
      pushDebugLine("歌单OCR", "engine-progress", progressMatch[2], {
        percent: engineLoadPercent.value,
      });
      if (batchPhase.value === "warming" && engineLoadPercent.value >= 18) {
        batchPhase.value = "scanning";
      }
      if (engineLoadPercent.value >= 93) {
        batchPhase.value = "finalizing";
      }
    }
    const doneMatch = line.match(/\[([^\]]+)\]\s*识别:/);
    if (doneMatch) {
      pushDebugLine("歌单OCR", "image-done", `单张完成：${doneMatch[1]}`, { raw: line });
      advanceAfterImageDone(doneMatch[1]);
      return;
    }
    if (/songs\.txt\s*已写入/i.test(line) || /已写入:\s*.+songs\.txt/i.test(line)) {
      batchPhase.value = "finalizing";
      pushDebugLine("歌单OCR", "phase-finalizing", line);
    }
    if (batchPhase.value === "warming" && (engineLoadPercent.value >= 18 || /Creating model|PP-OCR/i.test(line))) {
      batchPhase.value = "scanning";
      pushDebugLine("歌单OCR", "phase-scanning", `引擎就绪：${line}`);
    }
    if (/未找到|read_failed|跳过无效路径/i.test(line)) {
      pushDebugLine("歌单OCR", "ocr-warn", line);
    }
  }

  /** 解析阶段B（全自动下载）每首歌的成功/失败日志，写入 crawlStatuses。
   * 后端关键日志格式（来自 full_auto_download_2t58.py）：
   *   [N/M] quark|website|http|searching: <song-artist> [ -> ...]
   *     -> downloaded[...]:   成功
   *     -> failed: <err>      失败
   *     -> timeout (...)      失败（超时）
   *     -> crawl失败: <err>   搜索/取链阶段失败
   *     -> ok | ...           搜索阶段 OK（仅作为进度，最终成败看下载行）
   */
  function handleCrawlLogLine(line: string) {
    // 站点级限制：脚本检测到 site_daily_download_limit 后会打印此前缀，
    // UI 弹窗提示用户去网站完成口令验证并把新 Cookie 粘回来。
    const siteLimitMatch = line.match(/^\s*\[site-limit\]\s*(.+)$/);
    if (siteLimitMatch) {
      siteRateLimitMessage.value = siteLimitMatch[1].trim();
      siteRateLimitHitAt.value = Date.now();
      pushDebugLine("音乐爬取", "site-rate-limit", siteLimitMatch[1].trim());
      return;
    }
    // 人机验证：自动勾选失败 / 站点换了验证形态时，弹窗并打开网页让用户手动过。
    const humanVerifyMatch = line.match(/^\s*\[human-verify\]\s*(.+)$/);
    if (humanVerifyMatch) {
      humanVerifyMessage.value = humanVerifyMatch[1].trim();
      humanVerifyHitAt.value = Date.now();
      pushDebugLine("音乐爬取", "human-verify", humanVerifyMatch[1].trim());
      return;
    }
    const stageMatch = line.match(/^\s*\[\d+\/\d+\]\s*(?:quark|website|http|searching)\s*:\s*(.+?)\s*(?:->.*)?$/);
    if (stageMatch) {
      crawlCurrentQuery.value = stageMatch[1].trim();
      return;
    }
    const resultMatch = line.match(/^\s*->\s*(.+)$/);
    if (!resultMatch || !crawlCurrentQuery.value) return;
    const rest = resultMatch[1].trim();
    const key = songQueryKey(crawlCurrentQuery.value);
    if (!key) return;
    if (/^downloaded\b/i.test(rest)) {
      crawlStatuses.value = { ...crawlStatuses.value, [key]: { status: "success", note: rest } };
      return;
    }
    if (/^failed\b/i.test(rest)) {
      crawlStatuses.value = {
        ...crawlStatuses.value,
        [key]: { status: "failed", note: rest.replace(/^failed:\s*/i, "") },
      };
      return;
    }
    if (/^timeout\b/i.test(rest)) {
      crawlStatuses.value = {
        ...crawlStatuses.value,
        [key]: { status: "failed", note: rest },
      };
      return;
    }
    if (/^crawl失败/i.test(rest)) {
      crawlStatuses.value = {
        ...crawlStatuses.value,
        [key]: { status: "failed", note: rest.replace(/^crawl失败[:：]\s*/i, "") },
      };
      return;
    }
  }

  /** 阶段B 开新一轮爬取前清空状态。
   * 注意：仅清当前会话的 reactive map，UI 自己保存的持久化数据不动。 */
  function resetCrawl() {
    crawlStatuses.value = {};
    crawlCurrentQuery.value = "";
    siteRateLimitMessage.value = "";
    humanVerifyMessage.value = "";
  }
  /** UI 处理完限制提示后，清掉触发时间戳，等下一次再触发时 watch 才会再开对话框。 */
  function ackSiteRateLimit() {
    siteRateLimitHitAt.value = 0;
  }
  function ackHumanVerify() {
    humanVerifyHitAt.value = 0;
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
    engineLoadPercent.value = 0;
    engineLoadMessage.value = "";
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
        pushDebugLine(
          plugin === "playlist_ocr" ? "歌单OCR" : "音乐爬取",
          success ? "run-exit-ok" : "run-exit-error",
          `进程结束，退出码 ${event.payload.code}`,
        );
        running.value = false;
        runId.value = null;
        activePlugin.value = null;
      }),
    );
  }

  function summarizeOcrParams(params: Record<string, unknown>) {
    const imagesRaw = params.images;
    const imageList =
      typeof imagesRaw === "string"
        ? imagesRaw.split("|").filter(Boolean)
        : [];
    return {
      input: params.input ?? null,
      imageCount: imageList.length || null,
      images: imageList.length ? imageList.map((p) => p.split(/[/\\]/).pop()) : null,
      output: params.output,
      merge: params.merge,
      device: params.device,
      regionsDir: params.regionsDir,
    };
  }

  async function startTool(pluginId: ActivePlugin, params: Record<string, unknown>) {
    if (!pluginId || running.value) return;
    await ensureListeners();
    lastExitCode.value = null;
    logs.value = [];
    running.value = true;
    activePlugin.value = pluginId;
    if (pluginId === "playlist_ocr") {
      pushDebugLine("歌单OCR", "run-start", "启动 playlist_ocr 子进程", summarizeOcrParams(params));
    } else if (pluginId === "full_auto_download") {
      pushDebugLine("音乐爬取", "run-start", "启动全自动下载", {
        input: params.input,
        mode: params.mode,
      });
    }
    try {
      runId.value = await invoke<string>("run_tool", { pluginId, params });
      pushDebugLine(
        pluginId === "playlist_ocr" ? "歌单OCR" : "音乐爬取",
        "run-spawned",
        `子进程已创建 runId=${runId.value ?? "?"}`,
      );
    } catch (err) {
      running.value = false;
      activePlugin.value = null;
      const msg = err instanceof Error ? err.message : String(err);
      pushDebugLine(
        pluginId === "playlist_ocr" ? "歌单OCR" : "音乐爬取",
        "run-error",
        msg,
      );
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
    engineLoadPercent,
    engineLoadMessage,
    lastRegionsReady,
    ocrBatchActive,
    batchTotal,
    batchProgressPercent,
    batchStatusLabel,
    crawlStatuses,
    crawlCurrentQuery,
    siteRateLimitHitAt,
    siteRateLimitMessage,
    humanVerifyHitAt,
    humanVerifyMessage,
    toImageCacheKey: imageCacheKey,
    appendLog,
    resetBatch,
    beginBatchScan,
    getImageStatus,
    ensureListeners,
    startTool,
    cancelRun,
    resetCrawl,
    ackSiteRateLimit,
    ackHumanVerify,
  };
});
