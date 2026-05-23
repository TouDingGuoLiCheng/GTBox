<script setup lang="ts">
import { Icon } from "@iconify/vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";

type MediaEntry = { name: string; path: string };

const router = useRouter();

const form = reactive({
  input: "",
  outputDir: "output",
  mode: "auto" as "auto" | "smart" | "fixed",
  targetHeight: 2200,
  maxHeight: 2800,
  overlap: 40,
  searchRadius: 300,
  blankQuantile: 0.2,
});

const modeOptions = [
  { value: "auto", label: "自动" },
  { value: "smart", label: "智能切" },
  { value: "fixed", label: "固定高度" },
] as const;

const sourceImages = ref<MediaEntry[]>([]);
const selectedSource = ref("");

const resultParts = ref<MediaEntry[]>([]);
const selectedPart = ref("");
const partPreviewUrl = ref("");
const partPreviewLoading = ref(false);
const resultMessage = ref("");

const logs = ref<string[]>([]);
const runId = ref<string | null>(null);
const running = ref(false);
const exitCode = ref<number | null>(null);
const runError = ref<string | null>(null);
/** 系统文件选择对话框已打开时禁用「选文件夹 / 选单图」 */
const pickingDialog = ref(false);
/** folder：按路径扫描；picked：多选图片列表，仅处理勾选的文件 */
const inputMode = ref<"folder" | "picked">("folder");
const unlisteners: UnlistenFn[] = [];
let partPreviewGen = 0;
let previewReloadTimer: ReturnType<typeof setTimeout> | null = null;
let previewResizeObserver: ResizeObserver | null = null;

/** 切片预览缩放档位（与像素预算一致，避免百分比变但画面不变） */
const ZOOM_STEPS = [50, 75, 100, 125, 150, 200, 275, 400] as const;
const PREVIEW_ZOOM_MIN = ZOOM_STEPS[0];
const PREVIEW_ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1];
const previewZoom = ref<number>(100);
/** 适应宽度：长图按容器宽显示，纵向滚动更清晰 */
const previewFitWidth = ref(true);
const previewViewportEl = ref<HTMLElement | null>(null);
const previewViewportWidth = ref(900);
/** 指针是否在预览区内，用于 Ctrl+± 缩放 */
const previewHover = ref(false);

/** 前端预览缓存，避免切换切片重复解码 */
const previewCache = new Map<string, string>();
const MAX_PREVIEW_CACHE = 64;

function previewCacheKey(path: string, maxWidth: number, maxHeight: number) {
  return `${path}|${maxWidth}|${maxHeight}`;
}

function putPreviewCache(key: string, url: string) {
  if (previewCache.size >= MAX_PREVIEW_CACHE) {
    const first = previewCache.keys().next().value;
    if (first) previewCache.delete(first);
  }
  previewCache.set(key, url);
}

const advancedParamsEditable = computed(() => form.mode === "fixed");

const selectedPartName = computed(() => {
  const item = resultParts.value.find((x) => x.path === selectedPart.value);
  return item?.name ?? "";
});

/** 整图可见时 CSS 限制为容器宽，缩放上限 100% */
const previewZoomMax = computed(() => (previewFitWidth.value ? PREVIEW_ZOOM_MAX : 100));

const availableZoomSteps = computed(() =>
  ZOOM_STEPS.filter((s) => s <= previewZoomMax.value),
);

const previewZoomIndex = computed(() => {
  const steps = availableZoomSteps.value;
  const idx = steps.indexOf(previewZoom.value as (typeof ZOOM_STEPS)[number]);
  return idx >= 0 ? idx : steps.indexOf(100) >= 0 ? steps.indexOf(100) : 0;
});

const canZoomOut = computed(() => previewZoomIndex.value > 0);
const canZoomIn = computed(() => previewZoomIndex.value < availableZoomSteps.value.length - 1);

const previewPixelBudget = computed(() => {
  const z = previewZoom.value / 100;
  const vw = Math.max(360, previewViewportWidth.value);
  const maxWidth = Math.min(1400, Math.round(vw * z * 1.05));
  const maxHeight = previewFitWidth.value
    ? Math.min(2600, Math.round(maxWidth * 2.2))
    : Math.min(1800, Math.round(maxWidth * 1.3));
  return { maxWidth, maxHeight };
});

const inputDisplay = computed(() => {
  if (inputMode.value === "picked" && sourceImages.value.length) {
    return `已多选 ${sourceImages.value.length} 张图片`;
  }
  return form.input;
});

const selectedSourceName = computed(() => {
  const item = sourceImages.value.find((x) => x.path === selectedSource.value);
  return item?.name ?? "";
});

const sourceStem = computed(() => {
  const name = selectedSourceName.value;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
});

function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? path;
}

async function refreshSourceList() {
  sourceImages.value = [];
  selectedSource.value = "";
  resultParts.value = [];
  selectedPart.value = "";
  partPreviewUrl.value = "";
  resultMessage.value = "";

  const input = form.input.trim();
  if (!input) return;

  try {
    const files = await invoke<MediaEntry[]>("list_images_at_path", { path: input });
    sourceImages.value = files;
    if (files.length) {
      selectedSource.value = files[0].path;
    } else {
      runError.value = "该路径下没有可处理的图片（png/jpg/jpeg/webp/bmp）";
    }
  } catch (err) {
    runError.value = err instanceof Error ? err.message : String(err);
  }
}

async function resolveOutputDirForStem(stem: string): Promise<string | null> {
  const outRoot = await invoke<string>("workspaces_subpath", {
    subpath: `split_pic/${form.outputDir}`.replace(/\\/g, "/"),
  });
  try {
    const dirs = await invoke<string[]>("list_child_dirs", { path: outRoot });
    const match =
      dirs.find((d) => d === stem) ?? dirs.find((d) => d.startsWith(`${stem}_`));
    if (match) return `${outRoot}\\${match}`;
  } catch {
    /* ignore */
  }
  return null;
}

async function refreshResults() {
  resultParts.value = [];
  selectedPart.value = "";
  partPreviewUrl.value = "";
  previewCache.clear();
  resultMessage.value = "";

  if (!sourceStem.value) {
    resultMessage.value = "请先选择待切割图片";
    return;
  }

  const outDir = await resolveOutputDirForStem(sourceStem.value);
  if (!outDir) {
    resultMessage.value = "尚未生成切割结果，请先运行分割";
    return;
  }

  try {
    const parts = await invoke<MediaEntry[]>("list_images_at_path", { path: outDir });
    resultParts.value = parts.filter((p) => /^part_\d+\.png$/i.test(p.name));
    if (resultParts.value.length) {
      selectedPart.value = resultParts.value[0].path;
      resultMessage.value = `共 ${resultParts.value.length} 张切片 · ${basename(outDir)}`;
      schedulePartPreviewReload();
    } else {
      resultMessage.value = `输出目录为空：${basename(outDir)}`;
    }
  } catch (err) {
    resultMessage.value = err instanceof Error ? err.message : String(err);
  }
}

async function fetchPartPreviewUrl(
  path: string,
  budget: { maxWidth: number; maxHeight: number },
): Promise<string | null> {
  const key = previewCacheKey(path, budget.maxWidth, budget.maxHeight);
  const cached = previewCache.get(key);
  if (cached) return cached;

  try {
    const url = await invoke<string>("read_image_preview_data_url", {
      path,
      maxWidth: budget.maxWidth,
      maxHeight: budget.maxHeight,
      quality: 80,
    });
    putPreviewCache(key, url);
    return url;
  } catch {
    return null;
  }
}

function prefetchNeighborParts(centerPath: string) {
  const idx = resultParts.value.findIndex((p) => p.path === centerPath);
  if (idx < 0) return;
  const budget = previewPixelBudget.value;
  for (const offset of [1, -1]) {
    const neighbor = resultParts.value[idx + offset];
    if (!neighbor) continue;
    const key = previewCacheKey(neighbor.path, budget.maxWidth, budget.maxHeight);
    if (previewCache.has(key)) continue;
    void fetchPartPreviewUrl(neighbor.path, budget);
  }
}

async function loadPartPreview() {
  if (!selectedPart.value) {
    partPreviewUrl.value = "";
    partPreviewLoading.value = false;
    return;
  }

  const budget = previewPixelBudget.value;
  const cacheKey = previewCacheKey(
    selectedPart.value,
    budget.maxWidth,
    budget.maxHeight,
  );
  const cached = previewCache.get(cacheKey);
  if (cached) {
    partPreviewUrl.value = cached;
    partPreviewLoading.value = false;
    prefetchNeighborParts(selectedPart.value);
    return;
  }

  const gen = ++partPreviewGen;
  partPreviewLoading.value = !partPreviewUrl.value;
  const url = await fetchPartPreviewUrl(selectedPart.value, budget);
  if (gen !== partPreviewGen) return;
  partPreviewUrl.value = url ?? "";
  partPreviewLoading.value = false;
  if (url) prefetchNeighborParts(selectedPart.value);
}

async function pickFolder() {
  if (pickingDialog.value) return;
  pickingDialog.value = true;
  try {
    const path = await invoke<string | null>("pick_folder");
    if (path) {
      inputMode.value = "folder";
      form.input = path;
    }
  } finally {
    pickingDialog.value = false;
  }
}

async function pickImages() {
  if (pickingDialog.value) return;
  pickingDialog.value = true;
  try {
    const paths = await invoke<string[]>("pick_image_files");
    if (!paths.length) return;
    inputMode.value = "picked";
    form.input = "";
    runError.value = null;
    sourceImages.value = paths.map((path) => ({
      name: basename(path),
      path,
    }));
    selectedSource.value = paths[0];
    resultParts.value = [];
    selectedPart.value = "";
    partPreviewUrl.value = "";
    resultMessage.value = "";
  } finally {
    pickingDialog.value = false;
  }
}

const PICKED_LIST_SUBPATH = "split_pic/temp/picked_inputs.txt";

function schedulePartPreviewReload(delayMs = 160) {
  if (previewReloadTimer) clearTimeout(previewReloadTimer);
  previewReloadTimer = setTimeout(() => {
    previewReloadTimer = null;
    void loadPartPreview();
  }, delayMs);
}

function bindPreviewViewportObserver() {
  previewResizeObserver?.disconnect();
  const el = previewViewportEl.value;
  if (!el) return;
  previewViewportWidth.value = el.clientWidth || 900;
  previewResizeObserver = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect.width;
    if (w && Math.abs(w - previewViewportWidth.value) > 24) {
      previewViewportWidth.value = w;
      schedulePartPreviewReload(200);
    }
  });
  previewResizeObserver.observe(el);
}

function clampPreviewZoomToSteps(value: number): number {
  const steps = availableZoomSteps.value;
  if (!steps.length) return PREVIEW_ZOOM_MIN;
  let best = steps[0];
  let bestDist = Math.abs(value - best);
  for (const step of steps) {
    const d = Math.abs(value - step);
    if (d < bestDist) {
      best = step;
      bestDist = d;
    }
  }
  return best;
}

/** @returns 是否实际改变了缩放 */
function setPreviewZoom(next: number): boolean {
  const snapped = clampPreviewZoomToSteps(next);
  if (snapped === previewZoom.value) return false;
  previewZoom.value = snapped;
  return true;
}

/** @returns 是否实际改变了缩放 */
function stepPreviewZoom(direction: 1 | -1): boolean {
  const steps = availableZoomSteps.value;
  const idx = previewZoomIndex.value;
  const nextIdx = idx + direction;
  if (nextIdx < 0 || nextIdx >= steps.length) return false;
  const next = steps[nextIdx];
  if (next === previewZoom.value) return false;
  previewZoom.value = next;
  return true;
}

function onPreviewWheel(event: WheelEvent) {
  if (!selectedPart.value || !event.ctrlKey) return;
  const direction: 1 | -1 = event.deltaY < 0 ? 1 : -1;
  if (direction > 0 ? !canZoomIn.value : !canZoomOut.value) return;
  event.preventDefault();
  stepPreviewZoom(direction);
}

function onPreviewKeydown(event: KeyboardEvent) {
  if (!previewHover.value || !selectedPart.value || !event.ctrlKey) return;
  const zoomIn = event.key === "+" || event.key === "=" || event.key === "Add";
  const zoomOut = event.key === "-" || event.key === "_" || event.key === "Subtract";
  if (!zoomIn && !zoomOut) return;
  if (zoomIn && !canZoomIn.value) return;
  if (zoomOut && !canZoomOut.value) return;
  event.preventDefault();
  stepPreviewZoom(zoomIn ? 1 : -1);
}

async function buildParams(): Promise<Record<string, unknown>> {
  const base: Record<string, unknown> = {
    outputDir: form.outputDir,
    mode: form.mode,
  };
  if (form.mode === "fixed") {
    base.targetHeight = form.targetHeight;
    base.maxHeight = form.maxHeight;
    base.overlap = form.overlap;
    base.searchRadius = form.searchRadius;
    base.blankQuantile = form.blankQuantile;
  }

  if (inputMode.value === "picked") {
    if (!sourceImages.value.length) {
      throw new Error("请先选择至少一张图片");
    }
    const listAbs = await invoke<string>("workspaces_subpath", { subpath: PICKED_LIST_SUBPATH });
    const content = sourceImages.value.map((x) => x.path).join("\n");
    await invoke("write_workspaces_file", { subpath: PICKED_LIST_SUBPATH, content });
    return { ...base, inputsFile: listAbs };
  }

  if (!form.input.trim()) {
    throw new Error("请选择图片或文件夹");
  }
  return { ...base, input: form.input };
}

async function runTool() {
  let params: Record<string, unknown>;
  try {
    params = await buildParams();
  } catch (err) {
    runError.value = err instanceof Error ? err.message : String(err);
    return;
  }
  running.value = true;
  exitCode.value = null;
  runError.value = null;
  logs.value = [];
  try {
    const id = await invoke<string>("run_tool", {
      pluginId: "split_pic",
      params,
    });
    runId.value = id;
  } catch (err) {
    running.value = false;
    runError.value = err instanceof Error ? err.message : String(err);
  }
}

async function cancelRun() {
  if (!runId.value) return;
  try {
    await invoke<boolean>("cancel_run", { runId: runId.value });
  } catch (err) {
    runError.value = err instanceof Error ? err.message : String(err);
  }
}

function appendLog(line: string) {
  logs.value = [...logs.value, line].slice(-400);
}

watch(
  () => form.input,
  () => {
    if (inputMode.value === "picked") return;
    void refreshSourceList();
  },
);

watch(selectedSource, () => {
  void refreshResults();
});

watch(selectedPart, () => {
  void loadPartPreview();
});

watch(previewZoom, () => {
  schedulePartPreviewReload();
});

watch(previewFitWidth, () => {
  const clamped = clampPreviewZoomToSteps(previewZoom.value);
  if (clamped !== previewZoom.value) previewZoom.value = clamped;
  schedulePartPreviewReload();
});

onMounted(() => {
  window.addEventListener("keydown", onPreviewKeydown);
  void nextTick(() => bindPreviewViewportObserver());
  void listen<{ runId: string; stream: string; line: string }>("tool:log", (event) => {
    if (!runId.value || event.payload.runId !== runId.value) return;
    appendLog(`[${event.payload.stream}] ${event.payload.line}`);
  }).then((off) => unlisteners.push(off));

  void listen<{ runId: string; code: number }>("tool:exit", (event) => {
    if (!runId.value || event.payload.runId !== runId.value) return;
    running.value = false;
    exitCode.value = event.payload.code;
    appendLog(`进程结束，退出码：${event.payload.code}`);
    if (event.payload.code === 0) {
      void refreshResults();
    }
  }).then((off) => unlisteners.push(off));
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onPreviewKeydown);
  previewResizeObserver?.disconnect();
  if (previewReloadTimer) clearTimeout(previewReloadTimer);
  previewCache.clear();
  unlisteners.forEach((off) => off());
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
    <!-- 顶栏 -->
    <header
      class="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface-elevated/40 px-4 py-3"
    >
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-zinc-400 transition hover:bg-white/5 hover:text-accent"
        @click="router.push('/')"
      >
        <Icon icon="mdi:arrow-left" />
        返回
      </button>
      <div class="flex items-center gap-2 border-l border-border pl-3">
        <span class="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Icon icon="mdi:content-cut" class="text-xl" />
        </span>
        <div>
          <h1 class="text-sm font-semibold text-zinc-100">长截图分割</h1>
          <p class="text-xs text-zinc-500">选择原图 · 中间预览切割结果</p>
        </div>
      </div>

      <div class="ml-auto flex flex-wrap items-center gap-2">
        <button type="button" class="toolbar-btn" :disabled="pickingDialog" @click="pickFolder">
          {{ pickingDialog ? "选择中…" : "选文件夹" }}
        </button>
        <button
          type="button"
          class="toolbar-btn"
          :disabled="pickingDialog"
          title="在对话框中可用 Ctrl、Shift 多选"
          @click="pickImages"
        >
          选择图片
        </button>
        <button
          type="button"
          class="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-black disabled:opacity-50"
          :disabled="running"
          @click="runTool"
        >
          {{ running ? "分割中…" : "开始分割" }}
        </button>
        <button type="button" class="toolbar-btn" :disabled="!running" @click="cancelRun">取消</button>
        <span v-if="exitCode !== null" class="text-xs text-zinc-500">退出 {{ exitCode }}</span>
      </div>
      <p v-if="runError" class="w-full text-sm text-rose-400">{{ runError }}</p>
    </header>

    <!-- 主体：左列表 | 中切片预览 | 右参数 -->
    <div class="flex min-h-0 flex-1 gap-3 overflow-hidden p-3">
      <aside
        class="flex w-44 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-black/25 sm:w-52"
      >
        <div class="shrink-0 border-b border-border px-3 py-2 text-xs font-medium text-zinc-400">
          待切割 ({{ sourceImages.length }})
        </div>
        <ul class="min-h-0 flex-1 overflow-y-auto p-2">
          <li v-if="!sourceImages.length" class="px-2 py-4 text-center text-xs text-zinc-600">
            选择文件夹或单图
          </li>
          <li v-for="item in sourceImages" :key="item.path">
            <button
              type="button"
              class="mb-1 w-full rounded-lg px-2 py-2 text-left text-xs transition"
              :class="
                selectedSource === item.path
                  ? 'bg-accent/15 text-accent ring-1 ring-accent/40'
                  : 'text-zinc-400 hover:bg-white/5'
              "
              @click="selectedSource = item.path"
            >
              <span class="line-clamp-2 break-all">{{ item.name }}</span>
            </button>
          </li>
        </ul>
      </aside>

      <main class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border">
        <div
          class="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-black/25 px-3 py-2"
        >
          <span class="text-xs text-zinc-400">
            切片预览
            <span v-if="selectedPartName" class="text-zinc-500"> — {{ selectedPartName }}</span>
            <span v-else-if="selectedSourceName" class="text-zinc-600"> — {{ selectedSourceName }}</span>
          </span>
          <div class="ml-auto flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              class="preview-tool-btn"
              :class="previewFitWidth ? 'preview-tool-btn-active' : ''"
              :disabled="!selectedPart"
              @click="previewFitWidth = true"
            >
              适应宽度
            </button>
            <button
              type="button"
              class="preview-tool-btn"
              :class="!previewFitWidth ? 'preview-tool-btn-active' : ''"
              :disabled="!selectedPart"
              @click="previewFitWidth = false"
            >
              整图可见
            </button>
            <span class="mx-1 h-4 w-px bg-border" />
            <button
              type="button"
              class="preview-tool-btn"
              :disabled="!selectedPart || !canZoomOut"
              @click="stepPreviewZoom(-1)"
            >
              −
            </button>
            <span class="min-w-[3rem] text-center text-xs text-zinc-400">{{ previewZoom }}%</span>
            <button
              type="button"
              class="preview-tool-btn"
              :disabled="!selectedPart || !canZoomIn"
              @click="stepPreviewZoom(1)"
            >
              +
            </button>
            <button
              type="button"
              class="preview-tool-btn"
              :disabled="!selectedPart"
              @click="setPreviewZoom(100)"
            >
              100%
            </button>
          </div>
        </div>
        <div
          ref="previewViewportEl"
          class="preview-viewport relative min-h-0 flex-1 bg-black/40"
          @mouseenter="previewHover = true"
          @mouseleave="previewHover = false"
          @wheel="onPreviewWheel"
        >
          <p
            v-if="!selectedSource"
            class="flex h-full min-h-[16rem] items-center justify-center px-4 text-center text-sm text-zinc-600"
          >
            左侧选择待切割长图
          </p>
          <p
            v-else-if="!resultParts.length"
            class="flex h-full min-h-[16rem] items-center justify-center px-4 text-center text-sm text-zinc-600"
          >
            {{ resultMessage || "尚未生成切割结果，请先运行分割" }}
          </p>
          <p
            v-else-if="partPreviewLoading"
            class="flex h-full min-h-[16rem] items-center justify-center text-sm text-zinc-500"
          >
            加载预览…
          </p>
          <div v-else-if="partPreviewUrl" class="flex min-h-full justify-center p-2">
            <img
              :src="partPreviewUrl"
              class="preview-image block h-auto select-none"
              :class="previewFitWidth ? 'preview-fit-width' : 'preview-fit-page'"
              :style="
                previewFitWidth
                  ? { width: `${previewZoom}%`, maxWidth: 'none' }
                  : { width: `${previewZoom}%`, maxWidth: '100%' }
              "
              alt="切割切片"
              draggable="false"
            />
          </div>
        </div>
      </main>

      <aside
        class="flex w-56 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-surface-elevated/40 xl:w-64"
      >
        <div class="shrink-0 border-b border-border px-3 py-2 text-xs font-medium text-zinc-400">
          分割参数
        </div>
        <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-sm">
          <label class="block">
            <span class="mb-1 block text-xs text-zinc-500">输入路径</span>
            <input :value="inputDisplay" type="text" class="param-input text-xs" readonly />
          </label>
          <label class="block">
            <span class="mb-1 block text-xs text-zinc-500">模式</span>
            <select v-model="form.mode" class="param-input">
              <option v-for="o in modeOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </label>
          <label class="block">
            <span class="mb-1 block text-xs text-zinc-500">输出目录</span>
            <input v-model="form.outputDir" type="text" class="param-input" />
          </label>
          <fieldset
            class="rounded-lg border border-border/80 p-2.5 transition"
            :class="advancedParamsEditable ? '' : 'opacity-55'"
          >
            <legend class="px-1 text-xs text-zinc-500">
              高级参数
              <span v-if="!advancedParamsEditable" class="text-zinc-600">（自动/智能模式使用 config.yaml）</span>
            </legend>
            <div class="grid grid-cols-2 gap-2">
              <label class="block">
                <span class="mb-1 block text-xs text-zinc-500">目标高</span>
                <input
                  v-model.number="form.targetHeight"
                  type="number"
                  class="param-input"
                  :disabled="!advancedParamsEditable"
                />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs text-zinc-500">最大高</span>
                <input
                  v-model.number="form.maxHeight"
                  type="number"
                  class="param-input"
                  :disabled="!advancedParamsEditable"
                />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs text-zinc-500">重叠</span>
                <input
                  v-model.number="form.overlap"
                  type="number"
                  class="param-input"
                  :disabled="!advancedParamsEditable"
                />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs text-zinc-500">搜索窗</span>
                <input
                  v-model.number="form.searchRadius"
                  type="number"
                  class="param-input"
                  :disabled="!advancedParamsEditable"
                />
              </label>
            </div>
            <label class="mt-2 block">
              <span class="mb-1 block text-xs text-zinc-500">空白分位</span>
              <input
                v-model.number="form.blankQuantile"
                type="number"
                step="0.05"
                min="0.01"
                max="0.9"
                class="param-input"
                :disabled="!advancedParamsEditable"
              />
            </label>
          </fieldset>
        </div>
      </aside>
    </div>

    <!-- 切割结果 -->
    <section class="flex shrink-0 flex-col border-t border-border bg-surface-elevated/30">
      <div class="flex items-center justify-between px-4 py-2">
        <span class="text-xs font-medium text-zinc-400">切割结果</span>
        <span class="text-xs text-zinc-500">{{ resultMessage }}</span>
        <button
          type="button"
          class="text-xs text-accent hover:underline"
          :disabled="!sourceStem"
          @click="refreshResults"
        >
          刷新
        </button>
      </div>
      <div class="flex min-h-0 px-4 pb-3">
        <div
          class="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1"
          :class="resultParts.length ? 'min-h-[5.5rem]' : 'min-h-[3rem]'"
        >
          <p v-if="!resultParts.length" class="flex items-center text-xs text-zinc-600">
            分割完成后在此切换 part_001.png …
          </p>
          <button
            v-for="part in resultParts"
            :key="part.path"
            type="button"
            class="flex shrink-0 flex-col items-center gap-1 rounded-lg border px-2 py-1.5 transition"
            :class="
              selectedPart === part.path
                ? 'border-accent/50 bg-accent/10'
                : 'border-border bg-black/30 hover:border-white/20'
            "
            @click="selectedPart = part.path"
          >
            <span class="text-[11px] font-medium text-zinc-400">{{ part.name.replace(".png", "") }}</span>
          </button>
        </div>
      </div>
    </section>

    <!-- 日志 -->
    <footer class="h-20 shrink-0 border-t border-border bg-black/30">
      <pre class="h-full overflow-auto px-4 py-2 text-[11px] leading-4 text-zinc-500">{{
        logs.length ? logs.join("\n") : "运行日志…"
      }}</pre>
    </footer>
  </div>
</template>

<style scoped>
.toolbar-btn {
  border-radius: 0.5rem;
  border: 1px solid var(--color-border);
  padding: 0.375rem 0.75rem;
  font-size: 0.875rem;
  color: rgb(228 228 231);
  transition: background 0.15s;
}
.toolbar-btn:hover:not(:disabled) {
  background: rgb(255 255 255 / 0.06);
}
.toolbar-btn:disabled {
  opacity: 0.45;
}
.param-input {
  width: 100%;
  border-radius: 0.5rem;
  border: 1px solid var(--color-border);
  background: rgb(0 0 0 / 0.35);
  padding: 0.4rem 0.6rem;
  color: rgb(212 212 216);
}
.param-input:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.preview-viewport {
  overflow: auto;
  overscroll-behavior: contain;
}
.preview-fit-width {
  min-width: min(100%, 480px);
  image-rendering: auto;
}
.preview-fit-page {
  object-fit: contain;
  max-height: none;
}
.preview-tool-btn {
  border-radius: 0.375rem;
  border: 1px solid var(--color-border);
  padding: 0.2rem 0.55rem;
  font-size: 0.75rem;
  color: rgb(161 161 170);
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.preview-tool-btn:hover:not(:disabled) {
  background: rgb(255 255 255 / 0.06);
  color: rgb(228 228 231);
}
.preview-tool-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.preview-tool-btn-active {
  border-color: rgb(34 211 238 / 0.45);
  background: rgb(34 211 238 / 0.12);
  color: rgb(34 211 238);
}
</style>
