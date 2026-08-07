<script setup lang="ts">
import { Icon } from "@iconify/vue";
import { invoke } from "@tauri-apps/api/core";
import { storeToRefs } from "pinia";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  jarKeyOf,
  useMcModUpdaterRunStore,
  type ModItem,
  type ModStatus,
} from "../stores/mcModUpdaterRun";
import { pushDebugLine } from "../utils/mediaDebug";

const MODS_STATE_SUBPATH = "mc_mod_updater/mods_state.json";
const FORM_STORAGE_KEY = "gtbox.mcModUpdater.form";

const router = useRouter();
const runStore = useMcModUpdaterRunStore();
const {
  running,
  logs,
  terminalText,
  lastExitCode,
  lastFinishedAction,
  lastExitCancelled,
  modList,
  unmatchedList,
  outdatedList,
  failedList,
  missingDeps,
  progressPercent,
  progressMessage,
  summaryLine,
  diskSyncPending,
  dupGroups,
  dupDropCount,
} = storeToRefs(runStore);

const form = reactive({
  modsPath: "",
  mcVersion: "",
  loader: "forge",
  backupEnabled: true,
  backupDir: "mods_backup",
  concurrency: 4,
  timeout: 30,
  curseforgeApiKey: "",
});

const pickingFolder = ref(false);
const pickingBackupFolder = ref(false);
const keyword = ref("");
const selectedIds = ref<Set<string>>(new Set());
const lastClickedId = ref("");
const listEl = ref<HTMLElement | null>(null);
const terminalEl = ref<HTMLElement | null>(null);
const showPreview = ref(false);
const previewMode = ref<"all" | "selected">("all");
const showDedupePreview = ref(false);
const infoMessage = ref("");
const infoVisible = ref(false);
let infoHideTimer: ReturnType<typeof setTimeout> | null = null;
let infoClearTimer: ReturnType<typeof setTimeout> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

const filteredMods = computed(() => {
  const key = keyword.value.trim().toLowerCase();
  if (!key) return modList.value;
  return modList.value.filter((item) => {
    const hay = `${item.fileName} ${item.modName} ${item.platform} ${item.targetPlatform}`.toLowerCase();
    return hay.includes(key);
  });
});

const matchedCount = computed(() => modList.value.filter((m) => m.platform).length);
const upToDateCount = computed(
  () => modList.value.filter((m) => m.status === "up-to-date" || m.status === "updated").length,
);
const outdatedCount = computed(() => outdatedList.value.length);
const unmatchedCount = computed(() => unmatchedList.value.length);
const failedCount = computed(() => failedList.value.length);
const ignoredCount = computed(() => modList.value.filter((m) => m.status === "ignored").length);
const selectedOutdatedOrFailed = computed(() =>
  modList.value.filter(
    (m) => selectedIds.value.has(m.id) && (m.status === "outdated" || m.status === "failed"),
  ),
);
const previewTargets = computed(() => {
  if (previewMode.value === "selected") return selectedOutdatedOrFailed.value;
  return outdatedList.value;
});
const missingDepCount = computed(() => missingDeps.value.length);
const installableDepCount = computed(
  () => missingDeps.value.filter((d) => d.status === "missing").length,
);

function showInfo(message: string, durationMs = 4000) {
  if (!message.trim()) return;
  if (infoHideTimer) clearTimeout(infoHideTimer);
  if (infoClearTimer) clearTimeout(infoClearTimer);
  infoMessage.value = message;
  infoVisible.value = true;
  infoHideTimer = setTimeout(() => {
    infoVisible.value = false;
    infoHideTimer = null;
    infoClearTimer = setTimeout(() => {
      infoMessage.value = "";
      infoClearTimer = null;
    }, 400);
  }, durationMs);
}

function statusText(status: ModStatus) {
  if (status === "pending") return "未检查";
  if (status === "checking") return "检查中";
  if (status === "up-to-date") return "已最新";
  if (status === "outdated") return "可更新";
  if (status === "updating") return "更新中";
  if (status === "updated") return "已更新";
  if (status === "unmatched") return "未匹配";
  if (status === "failed") return "失败";
  return "已忽略";
}

function statusIcon(status: ModStatus) {
  if (status === "checking" || status === "updating") return "mdi:loading";
  if (status === "up-to-date" || status === "updated") return "mdi:check-circle";
  if (status === "outdated") return "mdi:arrow-up-circle";
  if (status === "unmatched") return "mdi:alert-circle";
  if (status === "failed") return "mdi:close-circle";
  if (status === "ignored") return "mdi:minus-circle";
  return "mdi:circle-outline";
}

function statusClass(status: ModStatus) {
  if (status === "checking" || status === "updating") return "text-accent";
  if (status === "up-to-date" || status === "updated") return "text-emerald-400";
  if (status === "outdated") return "text-sky-400";
  if (status === "unmatched" || status === "failed") return "text-red-400";
  if (status === "ignored") return "text-zinc-500";
  return "text-zinc-400";
}

function clearSelection() {
  selectedIds.value = new Set();
  lastClickedId.value = "";
}

function onRowClick(item: ModItem, ev: MouseEvent) {
  if (ev.shiftKey && lastClickedId.value) {
    const ids = filteredMods.value.map((m) => m.id);
    const a = ids.indexOf(lastClickedId.value);
    const b = ids.indexOf(item.id);
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      const next = new Set(selectedIds.value);
      for (let i = lo; i <= hi; i++) next.add(ids[i]);
      selectedIds.value = next;
      return;
    }
  }
  if (ev.ctrlKey || ev.metaKey) {
    const next = new Set(selectedIds.value);
    if (next.has(item.id)) next.delete(item.id);
    else next.add(item.id);
    selectedIds.value = next;
    lastClickedId.value = item.id;
    return;
  }
  selectedIds.value = new Set([item.id]);
  lastClickedId.value = item.id;
}

function selectAll() {
  selectedIds.value = new Set(filteredMods.value.map((m) => m.id));
  lastClickedId.value = filteredMods.value[filteredMods.value.length - 1]?.id ?? "";
}

function removeSelected() {
  if (!selectedIds.value.size) return;
  const ids = selectedIds.value;
  const keys = modList.value.filter((m) => ids.has(m.id)).map((m) => m.jarKey);
  const n = keys.length;
  runStore.removeMods(keys);
  clearSelection();
  if (n > 0) {
    showInfo(`已从列表移除 ${n} 项（未删除磁盘文件）`);
    pushDebugLine("MC模组更新器", "remove-selected", `移除 ${n} 项`);
  }
}

function onListKeyDown(ev: KeyboardEvent) {
  if (ev.key === "Delete" || ev.key === "Backspace") {
    if (!selectedIds.value.size) return;
    ev.preventDefault();
    removeSelected();
    return;
  }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "a") {
    ev.preventDefault();
    selectAll();
  }
}

async function pickModsFolder() {
  if (pickingFolder.value) return;
  pickingFolder.value = true;
  try {
    const folder = await invoke<string | null>("pick_folder");
    if (!folder) return;
    form.modsPath = folder;
    pushDebugLine("MC模组更新器", "pick-mods-folder", `选择 mods 文件夹：${folder}`);
  } finally {
    pickingFolder.value = false;
  }
}

async function pickBackupFolder() {
  if (pickingBackupFolder.value) return;
  pickingBackupFolder.value = true;
  try {
    const folder = await invoke<string | null>("pick_folder");
    if (!folder) return;
    form.backupDir = folder;
    pushDebugLine("MC模组更新器", "pick-backup-folder", `选择备份目录：${folder}`);
  } finally {
    pickingBackupFolder.value = false;
  }
}

function buildParams(action: string, only?: string[], extra?: { apply?: boolean }) {
  return {
    action,
    modsPath: form.modsPath,
    mcVersion: form.mcVersion,
    loader: form.loader,
    backupEnabled: form.backupEnabled,
    backupDir: form.backupDir,
    concurrency: Math.max(1, Math.min(16, Number(form.concurrency) || 4)),
    timeout: Math.max(5, Number(form.timeout) || 30),
    curseforgeApiKey: form.curseforgeApiKey,
    only: only?.length ? only.join(",") : "",
    apply: !!extra?.apply,
  };
}

async function runScan() {
  if (running.value) return;
  if (!form.modsPath.trim()) {
    showInfo("请先选择 mods 文件夹");
    return;
  }
  clearSelection();
  pushDebugLine("MC模组更新器", "scan-click", `开始扫描：${form.modsPath}`);
  await runStore.start(buildParams("scan"));
}

async function runCheck(onlyNames?: string[]) {
  if (running.value) return;
  if (!modList.value.length) {
    showInfo("请先扫描 mods");
    return;
  }
  if (!form.mcVersion.trim()) {
    showInfo("请填写 MC 版本");
    return;
  }
  if (!form.loader) {
    showInfo("请选择加载器");
    return;
  }
  await persistState(true);
  pushDebugLine(
    "MC模组更新器",
    "check-click",
    onlyNames?.length ? `重试检查 ${onlyNames.length} 项` : "检查更新",
    { mcVersion: form.mcVersion, loader: form.loader },
  );
  await runStore.start(buildParams("check", onlyNames));
}

function openPreview(mode: "all" | "selected" = "all") {
  previewMode.value = mode;
  if (mode === "selected") {
    if (!selectedOutdatedOrFailed.value.length) {
      showInfo("请先选中可更新或失败的项");
      return;
    }
  } else if (!outdatedList.value.length) {
    showInfo("当前没有可更新项，请先检查更新");
    return;
  }
  showPreview.value = true;
  pushDebugLine(
    "MC模组更新器",
    "preview-open",
    mode === "selected"
      ? `预览选中 ${selectedOutdatedOrFailed.value.length} 项`
      : `预览全部 ${outdatedList.value.length} 项`,
  );
}

function closePreview() {
  showPreview.value = false;
}

async function runUpdate(onlyNames?: string[]) {
  if (running.value) return;
  if (!form.modsPath.trim()) {
    showInfo("请先选择 mods 文件夹");
    return;
  }
  const targets =
    onlyNames?.length
      ? onlyNames
      : outdatedList.value.map((m) => m.fileName);
  if (!targets.length) {
    showInfo("没有可更新项");
    return;
  }
  showPreview.value = false;
  await persistState(true);
  pushDebugLine(
    "MC模组更新器",
    "update-click",
    onlyNames?.length ? `更新指定 ${onlyNames.length} 项` : `一键更新 ${targets.length} 项`,
    { backupEnabled: form.backupEnabled },
  );
  await runStore.start(buildParams("update", onlyNames?.length ? onlyNames : undefined));
}

async function confirmPreviewUpdate() {
  const names = previewTargets.value.map((m) => m.fileName);
  await runUpdate(names);
}

async function retryFailedOne(item: ModItem) {
  if (running.value || item.status !== "failed") return;
  await runUpdate([item.fileName]);
}

async function retryAllFailed() {
  const names = failedList.value.map((m) => m.fileName);
  if (!names.length) return;
  await runUpdate(names);
}

async function runDepsCheck() {
  if (running.value) return;
  if (!modList.value.length) {
    showInfo("请先扫描 mods");
    return;
  }
  if (!form.mcVersion.trim() || !form.loader) {
    showInfo("请填写 MC 版本与加载器");
    return;
  }
  await persistState(true);
  pushDebugLine("MC模组更新器", "deps-click", "检查缺失依赖");
  await runStore.start(buildParams("deps"));
}

async function runInstallDeps() {
  if (running.value) return;
  if (!form.modsPath.trim()) {
    showInfo("请先选择 mods 文件夹");
    return;
  }
  if (!form.mcVersion.trim() || !form.loader) {
    showInfo("请填写 MC 版本与加载器");
    return;
  }
  if (!installableDepCount.value) {
    showInfo("没有可补装的依赖，请先检查依赖");
    return;
  }
  await persistState(true);
  pushDebugLine("MC模组更新器", "install-deps-click", `补装 ${installableDepCount.value} 个依赖`);
  await runStore.start(buildParams("install-deps"));
}

async function runRollback() {
  if (running.value) return;
  if (!form.modsPath.trim()) {
    showInfo("请先选择 mods 文件夹");
    return;
  }
  if (!window.confirm("确认回滚到最近一次更新前的备份？将覆盖当前对应 jar。")) {
    return;
  }
  pushDebugLine("MC模组更新器", "rollback-click", "回滚上次更新");
  await runStore.start(buildParams("rollback"));
}

async function runDedupeScan() {
  if (running.value) return;
  if (!form.modsPath.trim()) {
    showInfo("请先选择 mods 文件夹");
    return;
  }
  showDedupePreview.value = false;
  pushDebugLine("MC模组更新器", "dedupe-scan-click", "排查重复版本（预览）");
  await runStore.start(buildParams("dedupe"));
}

async function confirmDedupeDelete() {
  if (running.value) return;
  if (!dupDropCount.value) {
    showInfo("没有可删除的较低版本");
    return;
  }
  const tip = form.backupEnabled
    ? `确认删除 ${dupDropCount.value} 个较低版本？将先备份到 mods_backup。`
    : `确认删除 ${dupDropCount.value} 个较低版本？未启用备份，将直接删除。`;
  if (!window.confirm(tip)) return;
  showDedupePreview.value = false;
  pushDebugLine("MC模组更新器", "dedupe-apply-click", `删除较低版本 ${dupDropCount.value} 项`, {
    backupEnabled: form.backupEnabled,
  });
  await runStore.start(buildParams("dedupe", undefined, { apply: true }));
}

function closeDedupePreview() {
  showDedupePreview.value = false;
}

function ignoreUnmatchedAll() {
  const keys = unmatchedList.value.map((m) => m.jarKey);
  if (!keys.length) return;
  runStore.ignoreMods(keys);
  showInfo(`已忽略 ${keys.length} 个未匹配项`);
  pushDebugLine("MC模组更新器", "ignore-unmatched", `忽略 ${keys.length} 项`);
}

function ignoreOne(item: ModItem) {
  runStore.ignoreMods([item.jarKey]);
  pushDebugLine("MC模组更新器", "ignore-one", item.fileName);
}

async function retryUnmatched() {
  const names = unmatchedList.value.map((m) => m.fileName);
  if (!names.length) return;
  await runCheck(names);
}

async function cancelRun() {
  await runStore.cancel();
}

function scrollTerminal() {
  void nextTick(() => {
    const el = terminalEl.value;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  });
}

function cancelPersistTimer() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}

async function persistState(immediate = false) {
  if (running.value || diskSyncPending.value) {
    cancelPersistTimer();
    return;
  }
  const run = async () => {
    if (running.value || diskSyncPending.value) return;
    try {
      let existingByName: Record<string, Record<string, unknown>> = {};
      try {
        const prevText = await invoke<string>("read_workspaces_file", {
          subpath: MODS_STATE_SUBPATH,
        });
        const prev = JSON.parse(prevText) as Array<Record<string, unknown>>;
        if (Array.isArray(prev)) {
          for (const row of prev) {
            const name = String(row.fileName ?? "").toLowerCase();
            if (name) existingByName[name] = row;
          }
        }
      } catch {
        existingByName = {};
      }

      if (running.value || diskSyncPending.value) return;

      const payload = JSON.stringify(
        modList.value.map((m) => {
          const old = existingByName[m.jarKey] || {};
          let status = m.status;
          if (status === "checking") status = "pending";
          if (status === "updating") status = "outdated";
          return {
            ...old,
            fileName: m.fileName,
            modName: m.modName,
            platform: m.platform || old.platform || "",
            projectId: m.projectId || old.projectId || "",
            cfModId: old.cfModId || "",
            currentVersion: m.currentVersion,
            targetVersion: m.targetVersion,
            targetPlatform: m.targetPlatform || old.targetPlatform || "",
            status,
            note: m.note ?? "",
            ignored: status === "ignored",
            downloadUrl: m.downloadUrl || old.downloadUrl || "",
            targetSha1: m.targetSha1 || old.targetSha1 || "",
            targetFileName: m.targetFileName || old.targetFileName || "",
            targetFileId: m.targetFileId || old.targetFileId || "",
            sha1: old.sha1 || "",
            sha512: old.sha512 || "",
            fingerprint: old.fingerprint || 0,
            path: old.path || "",
          };
        }),
        null,
        2,
      );
      if (running.value || diskSyncPending.value) return;
      await invoke("write_workspaces_file", { subpath: MODS_STATE_SUBPATH, content: payload });
    } catch (err) {
      pushDebugLine(
        "MC模组更新器",
        "persist-error",
        err instanceof Error ? err.message : String(err),
      );
    }
  };
  if (immediate) {
    cancelPersistTimer();
    await run();
    return;
  }
  cancelPersistTimer();
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void run();
  }, 400);
}

async function loadState() {
  try {
    const text = await invoke<string>("read_workspaces_file", { subpath: MODS_STATE_SUBPATH });
    if (running.value) return;
    const raw = JSON.parse(text) as Array<Record<string, unknown>>;
    if (!Array.isArray(raw)) return;
    const items: ModItem[] = [];
    const seen = new Set<string>();
    for (const row of raw) {
      const fileName = String(row.fileName ?? "").trim();
      if (!fileName) continue;
      const jarKey = jarKeyOf(fileName);
      if (seen.has(jarKey)) continue;
      seen.add(jarKey);
      const statusRaw = String(row.status ?? "pending");
      const allowed: ModStatus[] = [
        "pending",
        "checking",
        "up-to-date",
        "outdated",
        "updating",
        "updated",
        "unmatched",
        "failed",
        "ignored",
      ];
      const status = allowed.includes(statusRaw as ModStatus)
        ? (statusRaw as ModStatus)
        : "pending";
      items.push({
        id: `mod-${jarKey}`,
        jarKey,
        fileName,
        modName: String(row.modName ?? fileName),
        platform: String(row.platform ?? ""),
        projectId: String(row.projectId ?? ""),
        currentVersion: String(row.currentVersion ?? "-"),
        targetVersion: String(row.targetVersion ?? "-"),
        targetPlatform: String(row.targetPlatform ?? ""),
        status: row.ignored === true ? "ignored" : status,
        note: String(row.note ?? "") || undefined,
        downloadUrl: String(row.downloadUrl ?? "") || undefined,
        targetSha1: String(row.targetSha1 ?? "") || undefined,
        targetFileName: String(row.targetFileName ?? "") || undefined,
        targetFileId: String(row.targetFileId ?? "") || undefined,
      });
    }
    if (running.value) return;
    if (items.length) {
      runStore.setModsFromPersisted(items);
      pushDebugLine("MC模组更新器", "load-state", `恢复 ${items.length} 项`);
    }
  } catch {
    // no state yet
  }
}

function saveForm() {
  try {
    localStorage.setItem(
      FORM_STORAGE_KEY,
      JSON.stringify({
        modsPath: form.modsPath,
        mcVersion: form.mcVersion,
        loader: form.loader,
        backupEnabled: form.backupEnabled,
        backupDir: form.backupDir,
        concurrency: Math.max(1, Math.min(16, Number(form.concurrency) || 4)),
        timeout: Math.max(5, Number(form.timeout) || 30),
        // 不持久化 API Key，避免明文落盘
      }),
    );
  } catch {
    // ignore
  }
}

function loadForm() {
  try {
    const raw = localStorage.getItem(FORM_STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (typeof data.modsPath === "string") form.modsPath = data.modsPath;
    if (typeof data.mcVersion === "string") form.mcVersion = data.mcVersion;
    if (typeof data.loader === "string") form.loader = data.loader;
    if (typeof data.backupEnabled === "boolean") form.backupEnabled = data.backupEnabled;
    if (typeof data.backupDir === "string") form.backupDir = data.backupDir;
    if (typeof data.concurrency === "number") {
      form.concurrency = Math.max(1, Math.min(16, data.concurrency));
    }
    if (typeof data.timeout === "number") form.timeout = Math.max(5, data.timeout);
  } catch {
    // ignore
  }
}

watch(
  () => logs.value.length,
  () => scrollTerminal(),
);

watch(
  modList,
  () => {
    if (running.value || diskSyncPending.value) return;
    void persistState();
  },
  { deep: true },
);

watch(diskSyncPending, (pending) => {
  if (pending) cancelPersistTimer();
});

watch(running, (isRunning) => {
  if (isRunning) cancelPersistTimer();
});

watch(
  () => [
    form.modsPath,
    form.mcVersion,
    form.loader,
    form.backupEnabled,
    form.backupDir,
    form.concurrency,
    form.timeout,
  ],
  () => saveForm(),
);

watch(lastExitCode, async (code) => {
  if (code === null) return;
  const action = lastFinishedAction.value;
  const actionLabel =
    action === "check"
      ? "检查"
      : action === "update"
        ? "更新"
        : action === "deps"
          ? "依赖检查"
          : action === "install-deps"
            ? "依赖补装"
            : action === "rollback"
              ? "回滚"
              : action === "dedupe"
                ? "排查重复"
                : "扫描";

  cancelPersistTimer();
  try {
    if (action !== "deps" && action !== "rollback") {
      await loadState();
    }
    if (running.value || lastExitCode.value !== code) return;

    if (lastExitCancelled.value) {
      showInfo(`${actionLabel}已取消`, 4000);
      return;
    }
    if (code === 0) {
      if (action === "dedupe") {
        const droppedMatch = summaryLine.value.match(/dropped=(\d+)/i);
        const deletedMatch = summaryLine.value.match(/deleted=(\d+)/i);
        const dropped = droppedMatch ? Number.parseInt(droppedMatch[1], 10) : dupDropCount.value;
        const deleted = deletedMatch ? Number.parseInt(deletedMatch[1], 10) : 0;
        if (dropped > 0 && deleted === 0) {
          showDedupePreview.value = true;
          showInfo(`发现 ${dupGroups.value.length} 组重复，可删除 ${dropped} 个较低版本`);
        } else {
          showDedupePreview.value = false;
          showInfo(summaryLine.value ? `${actionLabel}完成：${summaryLine.value}` : `${actionLabel}完成`);
        }
      } else {
        showInfo(summaryLine.value ? `${actionLabel}完成：${summaryLine.value}` : `${actionLabel}完成`);
      }
      if (action === "rollback") {
        showInfo("回滚完成，建议重新扫描 mods", 5000);
      } else if (action === "update" && form.mcVersion.trim()) {
        window.setTimeout(() => {
          if (!running.value) void runDepsCheck();
        }, 400);
      }
    } else if (action === "update" && summaryLine.value) {
      showInfo(`更新结束（部分失败）：${summaryLine.value}`, 6000);
    } else if (action === "install-deps" && summaryLine.value) {
      showInfo(`依赖补装结束：${summaryLine.value}`, 6000);
    } else {
      showInfo(`任务异常（退出码 ${code}）`, 6000);
    }
  } finally {
    if (!running.value && lastExitCode.value === code) {
      diskSyncPending.value = false;
    }
  }
});

onMounted(() => {
  loadForm();
  void loadState();
});

onBeforeUnmount(() => {
  if (infoHideTimer) clearTimeout(infoHideTimer);
  if (infoClearTimer) clearTimeout(infoClearTimer);
  cancelPersistTimer();
});
</script>

<template>
  <div class="relative flex min-h-0 flex-1 flex-col p-6">
    <div class="mb-4 flex items-center gap-2">
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-zinc-400 transition hover:bg-white/5 hover:text-accent"
        @click="router.push('/')"
      >
        <Icon icon="mdi:arrow-left" />
        返回首页
      </button>
      <div class="ml-auto flex items-center gap-2 text-sm">
        <Icon icon="mdi:cube-outline" class="h-5 w-5 text-accent" />
        <span class="font-semibold text-zinc-100">MineCraft模组更新器</span>
        <span class="text-xs text-zinc-500">M6</span>
      </div>
    </div>

    <div class="grid min-h-0 flex-1 grid-cols-12 gap-4">
      <section class="col-span-5 flex min-h-0 flex-col rounded-xl border border-border bg-black/20 p-4">
        <div class="mb-3 flex items-center justify-between">
          <h3 class="text-sm font-medium text-zinc-300">本地 Mod 预览</h3>
          <span class="text-xs text-zinc-500">
            共 {{ filteredMods.length }}
            · <span class="text-sky-400">可更新 {{ outdatedCount }}</span>
            · <span class="text-emerald-400">最新 {{ upToDateCount }}</span>
            · <span class="text-red-400">未匹配 {{ unmatchedCount }}</span>
            <template v-if="failedCount">
              · <span class="text-red-400">失败 {{ failedCount }}</span>
            </template>
          </span>
        </div>
        <input
          v-model="keyword"
          class="mb-3 rounded border border-border bg-black/40 px-2 py-1.5 text-sm"
          placeholder="搜索文件名 / mod 名"
        />
        <div class="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border/70 bg-black/35">
          <div
            ref="listEl"
            tabindex="0"
            class="mod-list min-h-0 flex-1 space-y-1 overflow-auto p-2 text-sm outline-none focus:ring-1 focus:ring-inset focus:ring-accent/40"
            @keydown="onListKeyDown"
            @click.self="clearSelection"
          >
            <p v-if="!filteredMods.length" class="px-2 py-8 text-center text-xs text-zinc-500">
              暂无 mod。选择 mods 文件夹后点「扫描」。
            </p>
            <div
              v-for="item in filteredMods"
              :key="item.id"
              class="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 transition"
              :class="selectedIds.has(item.id) ? 'bg-accent/20 ring-1 ring-accent/40' : 'hover:bg-white/5'"
              @click="onRowClick(item, $event)"
            >
              <Icon
                :icon="statusIcon(item.status)"
                class="h-4 w-4 shrink-0"
                :class="[
                  statusClass(item.status),
                  item.status === 'checking' || item.status === 'updating' ? 'animate-spin' : '',
                ]"
              />
              <div class="min-w-0 flex-1">
                <div class="truncate text-zinc-200">{{ item.modName }}</div>
                <div class="truncate text-[11px] text-zinc-500">
                  {{ item.fileName }}
                  <span v-if="item.targetPlatform || item.platform">
                    · {{ item.targetPlatform || item.platform }}
                  </span>
                </div>
              </div>
              <span class="max-w-[9rem] shrink-0 truncate text-right text-xs text-zinc-500" :title="`${item.currentVersion} → ${item.targetVersion}`">
                {{ item.currentVersion }}
                <template v-if="item.targetVersion && item.targetVersion !== '-'">
                  → {{ item.targetVersion }}
                </template>
              </span>
              <span class="w-12 shrink-0 text-right text-xs" :class="statusClass(item.status)">
                {{ statusText(item.status) }}
              </span>
              <button
                v-if="item.status === 'failed'"
                type="button"
                class="icon-btn !p-0.5 shrink-0"
                title="重试此项"
                :disabled="running"
                @click.stop="retryFailedOne(item)"
              >
                <Icon icon="mdi:refresh" class="h-4 w-4" />
              </button>
            </div>
          </div>
          <div
            class="flex shrink-0 flex-wrap items-center gap-2 border-t border-border/80 bg-black/55 px-2 py-2"
            title="单击选中 · Ctrl/⌘ 多选 · Shift 区间 · Delete 删除"
          >
            <button
              type="button"
              class="icon-btn relative"
              :title="selectedIds.size ? `删除选中（${selectedIds.size}）` : '删除选中'"
              :disabled="!selectedIds.size"
              @click="removeSelected"
            >
              <Icon icon="mdi:delete-outline" class="h-5 w-5" />
              <span
                v-if="selectedIds.size"
                class="absolute -right-1 -top-1 min-w-[16px] rounded-full bg-red-500/90 px-1 text-[10px] font-semibold leading-4 text-white"
              >
                {{ selectedIds.size }}
              </span>
            </button>
            <button type="button" class="icon-btn" title="全选" :disabled="!filteredMods.length" @click="selectAll">
              <Icon icon="mdi:check-all" class="h-5 w-5" />
            </button>
            <button
              type="button"
              class="icon-btn"
              title="取消选中"
              :disabled="!selectedIds.size"
              @click="clearSelection"
            >
              <Icon icon="mdi:close" class="h-5 w-5" />
            </button>
            <button
              type="button"
              class="icon-btn"
              title="排查重复版本"
              :disabled="running || !form.modsPath"
              @click="runDedupeScan"
            >
              <Icon icon="mdi:file-multiple-outline" class="h-5 w-5" />
            </button>
            <button
              type="button"
              class="icon-btn"
              title="刷新扫描"
              :disabled="running || !form.modsPath"
              @click="runScan"
            >
              <Icon icon="mdi:refresh" class="h-5 w-5" />
            </button>
          </div>
        </div>
      </section>

      <section class="col-span-7 flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-black/20 p-4">
        <div class="min-h-0 flex-1 overflow-y-auto pr-1">
        <h3 class="mb-3 text-sm font-medium text-zinc-300">参数设置</h3>
        <div class="grid grid-cols-2 gap-3 text-sm">
          <label class="col-span-2 block">
            <span class="mb-1 block text-xs text-zinc-500">mods 文件夹路径</span>
            <div class="flex gap-2">
              <input
                v-model="form.modsPath"
                class="min-w-0 flex-1 rounded border border-border bg-black/40 px-2 py-1.5"
                placeholder="请选择本地 mods 文件夹"
              />
              <button
                type="button"
                class="icon-btn shrink-0"
                :disabled="pickingFolder"
                title="选择文件夹"
                @click="pickModsFolder"
              >
                <Icon icon="mdi:folder-outline" class="h-5 w-5" />
              </button>
            </div>
          </label>
          <label class="block">
            <span class="mb-1 block text-xs text-zinc-500">MC 版本</span>
            <input
              v-model="form.mcVersion"
              class="w-full rounded border border-border bg-black/40 px-2 py-1.5"
              placeholder="例如 1.20.1"
            />
          </label>
          <label class="block">
            <span class="mb-1 block text-xs text-zinc-500">加载器</span>
            <select v-model="form.loader" class="w-full rounded border border-border bg-black/40 px-2 py-1.5">
              <option value="forge">forge</option>
              <option value="fabric">fabric</option>
              <option value="quilt">quilt</option>
              <option value="neoforge">neoforge</option>
            </select>
          </label>
          <label class="col-span-2 block">
            <span class="mb-1 block text-xs text-zinc-500">备份目录</span>
            <div class="flex gap-2">
              <input
                v-model="form.backupDir"
                class="min-w-0 flex-1 rounded border border-border bg-black/40 px-2 py-1.5"
                placeholder="相对 mods 父目录，或选择绝对路径"
              />
              <button
                type="button"
                class="icon-btn shrink-0"
                :disabled="pickingBackupFolder"
                title="选择备份文件夹"
                @click="pickBackupFolder"
              >
                <Icon icon="mdi:folder-outline" class="h-5 w-5" />
              </button>
            </div>
          </label>
          <label class="block">
            <span class="mb-1 block text-xs text-zinc-500">并发数</span>
            <input
              v-model.number="form.concurrency"
              type="number"
              min="1"
              max="16"
              class="w-full rounded border border-border bg-black/40 px-2 py-1.5"
            />
          </label>
          <label class="block">
            <span class="mb-1 block text-xs text-zinc-500">超时（秒）</span>
            <input
              v-model.number="form.timeout"
              type="number"
              min="5"
              class="w-full rounded border border-border bg-black/40 px-2 py-1.5"
            />
          </label>
          <label class="block">
            <span class="mb-1 block text-xs text-zinc-500">CurseForge API Key</span>
            <input
              v-model="form.curseforgeApiKey"
              type="password"
              class="w-full rounded border border-border bg-black/40 px-2 py-1.5"
              placeholder="留空仅使用 Modrinth"
            />
          </label>
          <label class="flex items-center gap-2 text-zinc-300">
            <input v-model="form.backupEnabled" type="checkbox" />
            启用备份（默认开启）
          </label>
        </div>

        <div
          v-if="unmatchedCount > 0"
          class="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
        >
          <Icon icon="mdi:alert-circle-outline" class="h-4 w-4" />
          <span>未匹配 {{ unmatchedCount }} 项</span>
          <span v-if="ignoredCount" class="text-zinc-400">· 已忽略 {{ ignoredCount }}</span>
          <span class="ml-auto flex gap-1">
            <button
              type="button"
              class="rounded border border-border/70 px-2 py-1 text-zinc-200 hover:border-accent/50 hover:text-accent"
              :disabled="running"
              title="忽略全部未匹配"
              @click="ignoreUnmatchedAll"
            >
              忽略
            </button>
            <button
              type="button"
              class="rounded border border-border/70 px-2 py-1 text-zinc-200 hover:border-accent/50 hover:text-accent"
              :disabled="running"
              title="重试未匹配项"
              @click="retryUnmatched"
            >
              重试
            </button>
          </span>
        </div>
        <div v-if="unmatchedCount > 0" class="mt-2 max-h-24 space-y-1 overflow-auto text-xs">
          <div
            v-for="item in unmatchedList.slice(0, 30)"
            :key="item.id"
            class="flex items-center gap-2 rounded bg-black/25 px-2 py-1 text-zinc-400"
          >
            <span class="min-w-0 flex-1 truncate" :title="item.note || item.fileName">{{ item.fileName }}</span>
            <button type="button" class="icon-btn !p-0.5" title="忽略此项" @click="ignoreOne(item)">
              <Icon icon="mdi:minus-circle-outline" class="h-4 w-4" />
            </button>
          </div>
        </div>

        <div
          v-if="failedCount > 0"
          class="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100"
        >
          <Icon icon="mdi:alert-outline" class="h-4 w-4" />
          <span>失败 {{ failedCount }} 项</span>
          <button
            type="button"
            class="ml-auto rounded border border-border/70 px-2 py-1 text-zinc-200 hover:border-accent/50 hover:text-accent"
            :disabled="running"
            title="重试全部失败项"
            @click="retryAllFailed"
          >
            全部重试
          </button>
        </div>

        <div
          v-if="missingDepCount > 0"
          class="mt-3 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs text-violet-100"
        >
          <div class="mb-2 flex flex-wrap items-center gap-2">
            <Icon icon="mdi:puzzle-outline" class="h-4 w-4" />
            <span>缺失依赖 {{ missingDepCount }}</span>
            <span v-if="installableDepCount" class="text-zinc-400">· 可补装 {{ installableDepCount }}</span>
            <button
              type="button"
              class="ml-auto rounded border border-border/70 px-2 py-1 text-zinc-200 hover:border-accent/50 hover:text-accent"
              :disabled="running || !installableDepCount"
              title="下载并安装缺失的 required 依赖（Modrinth）"
              @click="runInstallDeps"
            >
              补装依赖
            </button>
          </div>
          <div class="max-h-24 space-y-1 overflow-auto">
            <div
              v-for="dep in missingDeps.slice(0, 20)"
              :key="dep.projectId"
              class="flex items-center gap-2 rounded bg-black/25 px-2 py-1 text-zinc-300"
            >
              <span class="min-w-0 flex-1 truncate" :title="dep.requiredBy">
                {{ dep.modName }}
                <span class="text-zinc-500">{{ dep.version !== '-' ? dep.version : '' }}</span>
              </span>
              <span class="shrink-0 text-[10px] text-zinc-500">
                {{ dep.status === 'unresolvable' ? '无法解析' : `需于 ${dep.requiredBy || '-'}` }}
              </span>
            </div>
          </div>
        </div>

        <div v-if="running || progressPercent > 0" class="mt-3 rounded-lg border border-border bg-black/30 p-3">
          <div class="mb-1.5 flex items-center justify-between text-xs text-zinc-400">
            <span>{{ progressMessage || (running ? "运行中…" : "完成") }}</span>
            <span>{{ progressPercent }}%</span>
          </div>
          <div class="h-2 overflow-hidden rounded-full bg-zinc-800">
            <div
              class="h-full rounded-full bg-accent transition-[width] duration-300"
              :style="{ width: `${progressPercent}%` }"
            />
          </div>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="rounded border border-border px-3 py-1.5 text-sm text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="running || !form.modsPath"
            title="扫描本地 jar 并识别"
            @click="runScan"
          >
            {{ running ? "运行中..." : "扫描" }}
          </button>
          <button
            type="button"
            class="rounded bg-accent px-3 py-1.5 text-sm text-black disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="running || !modList.length"
            title="按 MC 版本 + 加载器检查更新"
            @click="runCheck()"
          >
            检查更新
          </button>
          <button
            type="button"
            class="rounded border border-sky-500/40 px-3 py-1.5 text-sm text-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="running || !outdatedCount"
            title="预览并一键更新全部可更新项"
            @click="openPreview('all')"
          >
            一键更新（{{ outdatedCount }}）
          </button>
          <button
            type="button"
            class="rounded border border-border px-3 py-1.5 text-sm text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="running || !selectedOutdatedOrFailed.length"
            title="仅更新选中的可更新/失败项"
            @click="openPreview('selected')"
          >
            更新选中（{{ selectedOutdatedOrFailed.length }}）
          </button>
          <button
            type="button"
            class="rounded border border-violet-500/40 px-3 py-1.5 text-sm text-violet-300 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="running || !modList.length"
            title="检查 Modrinth required 依赖是否缺失"
            @click="runDepsCheck"
          >
            检查依赖
          </button>
          <button
            type="button"
            class="rounded border border-orange-500/40 px-3 py-1.5 text-sm text-orange-200 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="running || !form.modsPath"
            title="排查同模组多版本，预览后可删除较低版本"
            @click="runDedupeScan"
          >
            排查重复
          </button>
          <button
            type="button"
            class="rounded border border-amber-500/40 px-3 py-1.5 text-sm text-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="running || !form.modsPath"
            title="从最近一次备份回滚"
            @click="runRollback"
          >
            回滚
          </button>
          <button
            type="button"
            class="rounded border border-border px-3 py-1.5 text-sm text-zinc-300 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!running"
            @click="cancelRun"
          >
            取消
          </button>
          <span class="ml-auto text-xs text-zinc-500">
            识别 {{ matchedCount }} · 退出码 {{ lastExitCode === null ? "-" : lastExitCode }}
          </span>
        </div>
        <div class="mt-4 flex min-h-44 flex-col overflow-hidden rounded-lg border border-border bg-black/30">
          <div class="shrink-0 border-b border-border px-3 py-2 text-xs text-zinc-500">实时日志终端</div>
          <pre
            ref="terminalEl"
            class="max-h-64 min-h-44 overflow-auto px-3 py-2 text-xs leading-5 text-zinc-300"
          >{{ terminalText }}</pre>
        </div>
        </div>
      </section>
    </div>

    <Transition name="info-toast">
      <div v-if="infoMessage && infoVisible" class="info-toast" :title="infoMessage">
        {{ infoMessage }}
      </div>
    </Transition>

    <Transition name="preview-modal">
      <div v-if="showPreview" class="preview-backdrop" @click.self="closePreview">
        <div class="preview-modal" role="dialog" aria-modal="true">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-base font-semibold text-zinc-100">
              {{ previewMode === "selected" ? "更新选中预览" : "一键更新预览" }}
            </h3>
            <button type="button" class="icon-btn" title="关闭" @click="closePreview">
              <Icon icon="mdi:close" class="h-5 w-5" />
            </button>
          </div>
          <p class="mb-3 text-xs text-zinc-400">
            共 {{ previewTargets.length }} 项将被下载替换。
            <template v-if="form.backupEnabled">旧 jar 会备份到所选备份目录下的「时间戳」子文件夹。</template>
            <template v-else>已关闭备份，将直接覆盖。</template>
          </p>
          <div class="max-h-[50vh] space-y-1 overflow-auto text-sm">
            <div
              v-for="item in previewTargets"
              :key="item.id"
              class="flex items-center gap-2 rounded border border-border/60 bg-black/30 px-2 py-1.5"
            >
              <Icon
                :icon="item.status === 'failed' ? 'mdi:close-circle' : 'mdi:arrow-up-circle'"
                class="h-4 w-4"
                :class="item.status === 'failed' ? 'text-red-400' : 'text-sky-400'"
              />
              <div class="min-w-0 flex-1">
                <div class="truncate text-zinc-200">{{ item.modName }}</div>
                <div class="truncate text-[11px] text-zinc-500">{{ item.fileName }}</div>
              </div>
              <span class="shrink-0 text-xs text-zinc-400">
                {{ item.currentVersion }} → {{ item.targetVersion }}
              </span>
              <span class="shrink-0 text-xs text-sky-300">{{ item.targetPlatform || item.platform }}</span>
            </div>
          </div>
          <div class="mt-4 flex justify-end gap-2">
            <button type="button" class="rounded border border-border px-3 py-1.5 text-sm" @click="closePreview">
              取消
            </button>
            <button
              type="button"
              class="rounded bg-accent px-3 py-1.5 text-sm text-black disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="running || !previewTargets.length"
              title="确认下载并替换"
              @click="confirmPreviewUpdate"
            >
              确认更新（{{ previewTargets.length }}）
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="preview-modal">
      <div v-if="showDedupePreview" class="preview-backdrop" @click.self="closeDedupePreview">
        <div class="preview-modal" role="dialog" aria-modal="true">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-base font-semibold text-zinc-100">重复版本排查</h3>
            <button type="button" class="icon-btn" title="关闭" @click="closeDedupePreview">
              <Icon icon="mdi:close" class="h-5 w-5" />
            </button>
          </div>
          <p class="mb-3 text-xs text-zinc-400">
            共 {{ dupGroups.length }} 组同模组多版本，将删除 {{ dupDropCount }} 个较低版本，保留每组最高版本。
            <template v-if="form.backupEnabled">删除前会备份到备份目录下的「时间戳/dedupe」。</template>
            <template v-else>未启用备份，将直接删除磁盘文件。</template>
          </p>
          <div class="max-h-[50vh] space-y-3 overflow-auto text-sm">
            <div
              v-for="group in dupGroups"
              :key="group.key"
              class="rounded border border-border/60 bg-black/30 px-3 py-2"
            >
              <div class="mb-1.5 flex items-center gap-2">
                <Icon icon="mdi:file-multiple-outline" class="h-4 w-4 text-orange-300" />
                <span class="min-w-0 flex-1 truncate font-medium text-zinc-100">{{ group.modName }}</span>
                <span class="shrink-0 text-[11px] text-zinc-500">{{ group.jarCount }} 份</span>
              </div>
              <div class="mb-1 flex items-center gap-2 text-xs text-emerald-300">
                <Icon icon="mdi:check-circle" class="h-3.5 w-3.5" />
                <span class="min-w-0 flex-1 truncate" :title="group.keepFileName">
                  保留 {{ group.keepFileName }}
                </span>
                <span class="shrink-0 text-zinc-400">{{ group.keepVersion }}</span>
              </div>
              <div
                v-for="drop in group.drops"
                :key="drop.fileName"
                class="flex items-center gap-2 text-xs text-red-300/90"
              >
                <Icon icon="mdi:delete-outline" class="h-3.5 w-3.5" />
                <span class="min-w-0 flex-1 truncate" :title="drop.fileName">删除 {{ drop.fileName }}</span>
                <span class="shrink-0 text-zinc-500">{{ drop.version }}</span>
              </div>
            </div>
          </div>
          <div class="mt-4 flex justify-end gap-2">
            <button type="button" class="rounded border border-border px-3 py-1.5 text-sm" @click="closeDedupePreview">
              取消
            </button>
            <button
              type="button"
              class="rounded bg-orange-500 px-3 py-1.5 text-sm text-black disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="running || !dupDropCount"
              title="确认删除较低版本"
              @click="confirmDedupeDelete"
            >
              删除较低版本（{{ dupDropCount }}）
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
button {
  cursor: pointer;
}

button:disabled {
  opacity: 0.6;
}

.mod-list {
  user-select: none;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.375rem;
  border: 1px solid rgb(63 63 70 / 0.9);
  background: rgb(0 0 0 / 0.4);
  color: rgb(228 228 231);
  padding: 0.35rem;
  opacity: 1;
  transition:
    background-color 0.2s ease,
    color 0.2s ease,
    border-color 0.2s ease;
}

.icon-btn:hover:not(:disabled) {
  border-color: rgb(34 211 238 / 0.65);
  color: rgb(34 211 238);
  background: rgb(0 0 0 / 0.6);
}

.icon-btn:disabled {
  opacity: 1;
  cursor: not-allowed;
  color: rgb(161 161 170);
  background: rgb(0 0 0 / 0.25);
}

.info-toast {
  position: fixed;
  right: 1.25rem;
  bottom: 1.25rem;
  z-index: 100;
  max-width: min(24rem, calc(100vw - 2.5rem));
  padding: 0.5rem 0.875rem;
  border-radius: 0.5rem;
  border: 1px solid rgb(63 63 70 / 0.9);
  background: rgb(24 24 27 / 0.92);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.45);
  font-size: 0.75rem;
  line-height: 1.35;
  color: rgb(212 212 216);
  pointer-events: none;
  backdrop-filter: blur(8px);
}

.info-toast-enter-active,
.info-toast-leave-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}

.info-toast-enter-from,
.info-toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.preview-backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 0.55);
  backdrop-filter: blur(4px);
  padding: 1.5rem;
}

.preview-modal {
  width: min(720px, 100%);
  max-height: calc(100vh - 6rem);
  display: flex;
  flex-direction: column;
  border-radius: 0.75rem;
  border: 1px solid rgb(63 63 70 / 0.95);
  background: rgb(24 24 27 / 0.96);
  padding: 1.25rem;
  box-shadow: 0 24px 48px rgb(0 0 0 / 0.55);
}

.preview-modal-enter-active,
.preview-modal-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.preview-modal-enter-from,
.preview-modal-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
</style>
