import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { pushDebugLine } from "../utils/mediaDebug";

export type ModStatus =
  | "pending"
  | "checking"
  | "up-to-date"
  | "outdated"
  | "updating"
  | "updated"
  | "unmatched"
  | "failed"
  | "ignored";

export type ModItem = {
  id: string;
  jarKey: string;
  fileName: string;
  modName: string;
  platform: string;
  projectId: string;
  currentVersion: string;
  targetVersion: string;
  targetPlatform: string;
  status: ModStatus;
  note?: string;
  downloadUrl?: string;
  targetSha1?: string;
  targetFileName?: string;
  targetFileId?: string;
};

type ToolLogEvent = { runId: string; stream: string; line: string };
type ToolExitEvent = { runId: string; code: number };
export type McAction = "scan" | "check" | "update" | "deps" | "install-deps" | "rollback" | "dedupe";

export type DepMissItem = {
  projectId: string;
  modName: string;
  version: string;
  requiredBy: string;
  status: "missing" | "unresolvable";
};

export type DupDropItem = {
  fileName: string;
  version: string;
  keepFileName: string;
};

export type DupGroup = {
  key: string;
  modName: string;
  jarCount: number;
  keepFileName: string;
  keepVersion: string;
  drops: DupDropItem[];
};

export function jarKeyOf(fileName: string) {
  return fileName.trim().toLowerCase();
}

function stripLogPrefix(line: string) {
  const m = line.match(/^\[(stdout|stderr)\]\s*(.*)$/);
  return m ? m[2] : line;
}

function makeId(jarKey: string) {
  return `mod-${jarKey}`;
}

export const useMcModUpdaterRunStore = defineStore("mcModUpdaterRun", () => {
  const runId = ref<string | null>(null);
  const running = ref(false);
  const activeAction = ref<McAction | null>(null);
  const logs = ref<string[]>([]);
  const lastExitCode = ref<number | null>(null);
  const lastFinishedAction = ref<McAction | null>(null);
  const mods = ref<Record<string, ModItem>>({});
  const progressPercent = ref(0);
  const progressMessage = ref("");
  const summaryLine = ref("");
  const currentCheckJar = ref("");
  const currentUpdateJar = ref("");
  const cancelled = ref(false);
  const lastExitCancelled = ref(false);
  const missingDeps = ref<DepMissItem[]>([]);
  const diskSyncPending = ref(false);
  const dupGroups = ref<DupGroup[]>([]);
  let currentDupKey = "";

  const modList = computed(() =>
    Object.values(mods.value).sort((a, b) => a.fileName.localeCompare(b.fileName, "en")),
  );
  const unmatchedList = computed(() =>
    modList.value.filter((m) => m.status === "unmatched"),
  );
  const outdatedList = computed(() =>
    modList.value.filter((m) => m.status === "outdated"),
  );
  const failedList = computed(() => modList.value.filter((m) => m.status === "failed"));
  const dupDropCount = computed(() =>
    dupGroups.value.reduce((sum, g) => sum + g.drops.length, 0),
  );

  const terminalText = computed(() => {
    if (logs.value.length) return logs.value.join("\n");
    if (running.value) return "正在启动子进程...";
    return "就绪。扫描 / 检查更新 / 一键更新后日志会显示在此。";
  });

  let listenersAttached = false;
  const unlisteners: UnlistenFn[] = [];

  function upsertMod(partial: Partial<ModItem> & { fileName: string }) {
    const jarKey = jarKeyOf(partial.fileName);
    const prev = mods.value[jarKey];
    const next: ModItem = {
      id: prev?.id ?? makeId(jarKey),
      jarKey,
      fileName: partial.fileName,
      modName: partial.modName ?? prev?.modName ?? partial.fileName,
      platform: partial.platform ?? prev?.platform ?? "",
      projectId: partial.projectId ?? prev?.projectId ?? "",
      currentVersion: partial.currentVersion ?? prev?.currentVersion ?? "-",
      targetVersion: partial.targetVersion ?? prev?.targetVersion ?? "-",
      targetPlatform: partial.targetPlatform ?? prev?.targetPlatform ?? "",
      status: partial.status ?? prev?.status ?? "pending",
      note: partial.note !== undefined ? partial.note : prev?.note,
      downloadUrl: partial.downloadUrl ?? prev?.downloadUrl,
      targetSha1: partial.targetSha1 ?? prev?.targetSha1,
      targetFileName: partial.targetFileName ?? prev?.targetFileName,
      targetFileId: partial.targetFileId ?? prev?.targetFileId,
    };
    mods.value = { ...mods.value, [jarKey]: next };
  }

  function patchModStatus(jarKey: string, status: ModStatus, extra?: Partial<ModItem>) {
    const prev = mods.value[jarKey];
    if (!prev) return;
    mods.value = {
      ...mods.value,
      [jarKey]: { ...prev, ...extra, status },
    };
  }

  function renameModKey(oldKey: string, newFileName: string, extra?: Partial<ModItem>) {
    const prev = mods.value[oldKey];
    if (!prev) return;
    const newKey = jarKeyOf(newFileName);
    const next: ModItem = {
      ...prev,
      ...extra,
      fileName: newFileName,
      jarKey: newKey,
      id: makeId(newKey),
    };
    const copy = { ...mods.value };
    delete copy[oldKey];
    copy[newKey] = next;
    mods.value = copy;
  }

  function setModsFromPersisted(items: ModItem[]) {
    const next: Record<string, ModItem> = {};
    for (const item of items) {
      const jarKey = jarKeyOf(item.fileName || item.jarKey);
      if (!jarKey) continue;
      next[jarKey] = {
        ...item,
        id: item.id || makeId(jarKey),
        jarKey,
        fileName: item.fileName || jarKey,
        modName: item.modName || item.fileName || jarKey,
        platform: item.platform || "",
        projectId: item.projectId || "",
        currentVersion: item.currentVersion || "-",
        targetVersion: item.targetVersion || "-",
        targetPlatform: item.targetPlatform || "",
        status: item.status || "pending",
      };
    }
    mods.value = next;
  }

  function removeMods(jarKeys: string[]) {
    if (!jarKeys.length) return;
    const next = { ...mods.value };
    for (const key of jarKeys) delete next[key];
    mods.value = next;
  }

  function clearMods() {
    mods.value = {};
  }

  function ignoreMods(jarKeys: string[]) {
    for (const key of jarKeys) {
      patchModStatus(key, "ignored", { note: "ignored" });
    }
  }

  function appendLog(line: string) {
    logs.value = [...logs.value, line].slice(-500);
    const isStderr = /^\[stderr\]/i.test(line);
    pushDebugLine(
      "MC模组更新器",
      isStderr ? "python-stderr" : "python-stdout",
      line.replace(/^\[(stdout|stderr)\]\s*/i, ""),
    );
  }

  function normalizeTransientStatuses() {
    const next = { ...mods.value };
    let changed = false;
    for (const key of Object.keys(next)) {
      const item = next[key];
      if (item.status === "checking") {
        next[key] = { ...item, status: "pending" };
        changed = true;
      } else if (item.status === "updating") {
        next[key] = { ...item, status: "outdated" };
        changed = true;
      }
    }
    if (changed) mods.value = next;
  }

  function handleLogLine(rawLine: string) {
    const line = stripLogPrefix(rawLine).trim();
    if (!line) return;

    const progress = line.match(/^\[PROGRESS\]\s*(\d+)\s+(.*)$/);
    if (progress) {
      progressPercent.value = Math.min(100, Number.parseInt(progress[1], 10) || 0);
      progressMessage.value = progress[2] || "";
      return;
    }

    const scan = line.match(/^\[SCAN\]\s+found\s+(\d+)\s+jars\s+in\s+(.+)$/i);
    if (scan) {
      clearMods();
      progressMessage.value = `发现 ${scan[1]} 个 jar`;
      pushDebugLine("MC模组更新器", "scan-found", progressMessage.value);
      return;
    }

    const jar = line.match(/^\[JAR\]\s+(.+)$/);
    if (jar) {
      upsertMod({
        fileName: jar[1].trim(),
        status: "pending",
        currentVersion: "-",
        targetVersion: "-",
        targetPlatform: "",
      });
      return;
    }

    const match = line.match(/^\[MATCH\]\s+(.+?)\s+::\s+([^|]+)\|([^|]*)\|([^|]*)(?:\|(.*))?$/);
    if (match) {
      upsertMod({
        fileName: match[1].trim(),
        platform: match[2].trim(),
        projectId: match[3].trim(),
        currentVersion: match[4].trim() || "-",
        modName: (match[5] || "").trim() || match[1].trim(),
        status: "pending",
        targetVersion: "-",
        targetPlatform: "",
      });
      return;
    }

    const checkHead = line.match(/^\[CHECK\]\s+(\d+)\/(\d+)\s+(.+)$/);
    if (checkHead) {
      currentCheckJar.value = checkHead[3].trim();
      upsertMod({
        fileName: currentCheckJar.value,
        status: "checking",
      });
      return;
    }

    const updateHead = line.match(/^\[UPDATE\]\s+(\d+)\/(\d+)\s+(.+)$/);
    if (updateHead) {
      currentUpdateJar.value = updateHead[3].trim();
      upsertMod({
        fileName: currentUpdateJar.value,
        status: "updating",
      });
      return;
    }

    const result = line.match(
      /^\s*->\s*(up-to-date|outdated|unmatched|failed|updated|backup)\s+(.+)$/i,
    );
    if (result) {
      const kind = result[1].toLowerCase();
      const detail = result[2].trim();

      if (kind === "backup") {
        pushDebugLine("MC模组更新器", "backup", detail);
        return;
      }

      if (kind === "updated" && currentUpdateJar.value) {
        const oldKey = jarKeyOf(currentUpdateJar.value);
        // 兼容 `name :: newName` 与纯文件名
        const newName = (detail.includes(" :: ") ? detail.split(" :: ").pop() : detail)?.trim()
          || currentUpdateJar.value;
        const prev = mods.value[oldKey];
        if (prev && jarKeyOf(newName) !== oldKey) {
          renameModKey(oldKey, newName, {
            status: "updated",
            currentVersion: prev.targetVersion || prev.currentVersion,
            note: "",
          });
        } else {
          upsertMod({
            fileName: newName,
            status: "updated",
            currentVersion: prev?.targetVersion || prev?.currentVersion || "-",
            note: "",
          });
        }
        return;
      }

      // `file.jar :: detail` 或仅 detail（回退 currentCheckJar / currentUpdateJar）
      let fileName = "";
      let payload = detail;
      const named = detail.match(/^(.+?)\s+::\s+(.+)$/);
      if (named && /\.jar$/i.test(named[1].trim())) {
        fileName = named[1].trim();
        payload = named[2].trim();
      } else {
        fileName = currentUpdateJar.value || currentCheckJar.value;
      }

      if (kind === "failed") {
        if (!fileName) return;
        upsertMod({
          fileName,
          status: "failed",
          note: payload,
        });
        return;
      }

      if (!fileName) return;

      if (kind === "up-to-date") {
        upsertMod({
          fileName,
          status: "up-to-date",
          targetVersion: payload,
          note: "",
        });
        return;
      }
      if (kind === "outdated") {
        const m = payload.match(/^(.+?)\s*=>\s*(.+?)\s*\(([^)]+)\)\s*$/);
        if (m) {
          upsertMod({
            fileName,
            status: "outdated",
            currentVersion: m[1].trim(),
            targetVersion: m[2].trim(),
            targetPlatform: m[3].trim(),
            note: "",
          });
        } else {
          upsertMod({
            fileName,
            status: "outdated",
            targetVersion: payload,
          });
        }
        return;
      }
      if (kind === "unmatched") {
        upsertMod({
          fileName,
          status: "unmatched",
          targetVersion: "-",
          targetPlatform: "",
          note: payload,
        });
        return;
      }
      upsertMod({
        fileName,
        status: "failed",
        note: payload,
      });
      return;
    }

    const unmatch = line.match(/^\[UNMATCH\]\s+(.+?)\s+::\s+(.+)$/);
    if (unmatch) {
      upsertMod({
        fileName: unmatch[1].trim(),
        status: "unmatched",
        note: unmatch[2].trim(),
        targetVersion: "-",
        targetPlatform: "",
      });
      return;
    }

    const depMiss = line.match(/^\[DEP-MISS\]\s+(\S+)\s+::\s+(.+)$/i);
    if (depMiss) {
      const projectId = depMiss[1].trim();
      const rest = depMiss[2].trim();
      const parts = rest.split("|").map((s) => s.trim());
      const head = parts[0] || "";
      const requiredByPart = parts.find((p) => /^required by\s+/i.test(p));
      const requiredBy = requiredByPart ? requiredByPart.replace(/^required by\s+/i, "").trim() : "";
      const unresolvable = parts.some((p) => /no compatible file/i.test(p));
      const headBits = head.split(/\s+/);
      const version = !unresolvable && headBits.length > 1 ? headBits[headBits.length - 1] : "-";
      const modName = !unresolvable && headBits.length > 1 ? headBits.slice(0, -1).join(" ") : head;
      const next = missingDeps.value.filter((d) => d.projectId !== projectId);
      next.push({
        projectId,
        modName: modName || projectId,
        version,
        requiredBy,
        status: unresolvable ? "unresolvable" : "missing",
      });
      missingDeps.value = next;
      return;
    }

    const dupHead = line.match(/^\[DEDUP\]\s+scanning\s+/i);
    if (dupHead) {
      dupGroups.value = [];
      currentDupKey = "";
      return;
    }

    const dupGroup = line.match(/^\[DUP-GROUP\]\s+(.+?)\s+\|\s+(\d+)\s+jars(?:\s+\|\s+(.*))?$/i);
    if (dupGroup) {
      currentDupKey = dupGroup[1].trim();
      const jarCount = Number.parseInt(dupGroup[2], 10) || 0;
      const modName = (dupGroup[3] || currentDupKey).trim();
      const next = dupGroups.value.filter((g) => g.key !== currentDupKey);
      next.push({
        key: currentDupKey,
        modName,
        jarCount,
        keepFileName: "",
        keepVersion: "-",
        drops: [],
      });
      dupGroups.value = next;
      return;
    }

    const dupKeep = line.match(/^\[DUP-KEEP\]\s+(.+?)\s+::\s+(.+)$/i);
    if (dupKeep && currentDupKey) {
      const fileName = dupKeep[1].trim();
      const version = dupKeep[2].trim();
      dupGroups.value = dupGroups.value.map((g) =>
        g.key === currentDupKey ? { ...g, keepFileName: fileName, keepVersion: version } : g,
      );
      return;
    }

    const dupDrop = line.match(/^\[DUP-DROP\]\s+(.+?)\s+::\s+(.+?)\s+\|\s+keep=(.+)$/i);
    if (dupDrop && currentDupKey) {
      const fileName = dupDrop[1].trim();
      const version = dupDrop[2].trim();
      const keepFileName = dupDrop[3].trim();
      dupGroups.value = dupGroups.value.map((g) => {
        if (g.key !== currentDupKey) return g;
        const drops = g.drops.filter((d) => d.fileName.toLowerCase() !== fileName.toLowerCase());
        drops.push({ fileName, version, keepFileName });
        return { ...g, drops };
      });
      return;
    }

    const deleted = line.match(/^\s*->\s*deleted\s+(.+?)(?:\s+::\s+.*)?$/i);
    if (deleted) {
      const fileName = deleted[1].trim();
      removeMods([jarKeyOf(fileName)]);
      return;
    }

    const depInstall = line.match(/^\s*->\s*installed\s+(.+)$/i);
    if (depInstall) {
      const fileName = depInstall[1].trim();
      upsertMod({
        fileName,
        status: "updated",
        platform: "Modrinth",
        note: "dependency installed",
      });
      return;
    }

    const summary = line.match(/^\[SUMMARY\]\s+(.+)$/);
    if (summary) {
      summaryLine.value = summary[1].trim();
      pushDebugLine("MC模组更新器", "summary", summaryLine.value);
    }
  }

  async function ensureListeners() {
    if (listenersAttached) return;
    listenersAttached = true;

    unlisteners.push(
      await listen<ToolLogEvent>("tool:log", (event) => {
        if (!runId.value || event.payload.runId !== runId.value) return;
        const line = `[${event.payload.stream}] ${event.payload.line}`;
        appendLog(line);
        handleLogLine(line);
      }),
    );

    unlisteners.push(
      await listen<ToolExitEvent>("tool:exit", (event) => {
        if (!runId.value || event.payload.runId !== runId.value) return;
        diskSyncPending.value = true;
        lastExitCode.value = event.payload.code;
        lastFinishedAction.value = activeAction.value;
        const wasCancelled = cancelled.value;
        lastExitCancelled.value = wasCancelled;
        if (wasCancelled) {
          appendLog("已取消运行");
          pushDebugLine("MC模组更新器", "run-cancelled", "用户取消");
          normalizeTransientStatuses();
        } else {
          appendLog(`进程结束，退出码：${event.payload.code}`);
          pushDebugLine(
            "MC模组更新器",
            event.payload.code === 0 ? "run-exit-ok" : "run-exit-error",
            `进程结束，退出码 ${event.payload.code}`,
          );
          normalizeTransientStatuses();
        }
        running.value = false;
        runId.value = null;
        activeAction.value = null;
        currentCheckJar.value = "";
        currentUpdateJar.value = "";
        cancelled.value = false;
        if (progressPercent.value < 100 && (event.payload.code === 0 || wasCancelled)) {
          progressPercent.value = wasCancelled ? progressPercent.value : 100;
        }
        if (wasCancelled) {
          progressMessage.value = progressMessage.value
            ? `${progressMessage.value}（已取消）`
            : "已取消";
        }
      }),
    );
  }

  function resolveAction(params: Record<string, unknown>): McAction {
    const raw = String(params.action ?? "scan");
    if (
      raw === "check" ||
      raw === "update" ||
      raw === "deps" ||
      raw === "install-deps" ||
      raw === "rollback" ||
      raw === "dedupe"
    ) {
      return raw;
    }
    return "scan";
  }

  async function start(params: Record<string, unknown>) {
    if (running.value) return;
    await ensureListeners();
    logs.value = [];
    lastExitCode.value = null;
    lastFinishedAction.value = null;
    lastExitCancelled.value = false;
    progressPercent.value = 0;
    progressMessage.value = "";
    summaryLine.value = "";
    currentCheckJar.value = "";
    currentUpdateJar.value = "";
    cancelled.value = false;
    diskSyncPending.value = false;
    const action = resolveAction(params);
    if (action === "deps" || action === "install-deps") {
      missingDeps.value = [];
    }
    if (action === "dedupe" && !params.apply) {
      dupGroups.value = [];
      currentDupKey = "";
    }
    running.value = true;
    activeAction.value = action;
    if (action === "deps") progressMessage.value = "检查依赖…";
    else if (action === "install-deps") progressMessage.value = "补装依赖…";
    else if (action === "check") progressMessage.value = "检查更新…";
    else if (action === "update") progressMessage.value = "更新中…";
    else if (action === "rollback") progressMessage.value = "回滚中…";
    else if (action === "dedupe") {
      progressMessage.value = params.apply ? "删除较低版本…" : "排查重复版本…";
    } else if (action === "scan") progressMessage.value = "扫描中…";
    pushDebugLine("MC模组更新器", "run-start", "启动子进程", params);
    try {
      runId.value = await invoke<string>("run_tool", {
        pluginId: "mc_mod_updater",
        params,
      });
      pushDebugLine("MC模组更新器", "run-spawned", `子进程已创建 runId=${runId.value ?? "?"}`);
    } catch (err) {
      running.value = false;
      runId.value = null;
      activeAction.value = null;
      cancelled.value = false;
      const message = err instanceof Error ? err.message : String(err);
      appendLog(`[stderr] 启动失败：${message}`);
      pushDebugLine("MC模组更新器", "run-error", message);
    }
  }

  async function cancel() {
    if (!runId.value) return;
    cancelled.value = true;
    await invoke<boolean>("cancel_run", { runId: runId.value });
    pushDebugLine("MC模组更新器", "cancel-click", "请求取消运行");
  }

  return {
    runId,
    running,
    activeAction,
    logs,
    terminalText,
    lastExitCode,
    lastFinishedAction,
    lastExitCancelled,
    cancelled,
    missingDeps,
    mods,
    modList,
    unmatchedList,
    outdatedList,
    failedList,
    dupGroups,
    dupDropCount,
    progressPercent,
    progressMessage,
    summaryLine,
    diskSyncPending,
    start,
    cancel,
    setModsFromPersisted,
    removeMods,
    clearMods,
    ignoreMods,
    patchModStatus,
    normalizeTransientStatuses,
  };
});
