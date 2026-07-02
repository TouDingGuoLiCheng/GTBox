<script setup lang="ts">
import { Icon } from "@iconify/vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import CompareDetailList from "../components/textCompare/CompareDetailList.vue";
import CompareOptions from "../components/textCompare/CompareOptions.vue";
import CompareStats from "../components/textCompare/CompareStats.vue";
import FolderDiffTree from "../components/textCompare/FolderDiffTree.vue";
import FolderInputPair from "../components/textCompare/FolderInputPair.vue";
import ModeTabs from "../components/textCompare/ModeTabs.vue";
import TextDiffView from "../components/textCompare/TextDiffView.vue";
import TextInputPair from "../components/textCompare/TextInputPair.vue";
import RuleGraphEditor from "../components/textCompare/ruleGraph/RuleGraphEditor.vue";
import type { CompareMode, CompareResult, TextCompareFormState } from "../types/textCompare";
import type { RuleGraph } from "../types/ruleGraph";
import { defaultTextCompareForm } from "../types/textCompare";
import { buildCompareReport, type ReportFormat } from "../utils/exportCompareReport";
import {
  type FolderCompareResultRaw,
  mapFolderCompareResult,
} from "../utils/folderCompare";
import { compareWithRuleGraph, createDefaultRuleGraph } from "../utils/ruleGraph";
import { compareFullText, compareLines, compareRegex } from "../utils/textCompare";
import { isLargeText } from "../utils/textDiff";

const MAX_COMPARE_CHARS = 2_000_000;

interface TextCompareSettingsPersisted {
  mode: CompareMode;
  fullText: TextCompareFormState["fullText"];
  line: TextCompareFormState["line"];
  regex: TextCompareFormState["regex"];
  ruleGraph?: RuleGraph;
  legacyRegex?: string;
  useLegacyRegex?: boolean;
}

const router = useRouter();
const form = reactive(defaultTextCompareForm());
const result = ref<CompareResult | null>(null);
const compareError = ref<string | null>(null);
const compareWarning = ref<string | null>(null);
const comparing = ref(false);
const exporting = ref(false);
const settingsReady = ref(false);
const lastFullTarget = ref("");
const lastFullCandidate = ref("");
const folderProgress = ref<{
  scanned: number;
  total: number;
  currentPath: string;
  phase: string;
} | null>(null);

const pickingCandidate = ref(false);

const unlisteners: UnlistenFn[] = [];

async function importCandidateFile() {
  if (pickingCandidate.value) return;
  pickingCandidate.value = true;
  compareError.value = null;
  try {
    const path = await invoke<string | null>("pick_song_list_file");
    if (!path) return;
    form.candidateFile = path;
    form.candidateText = await invoke<string>("read_text_file", { path });
  } catch (err) {
    compareError.value = err instanceof Error ? err.message : String(err);
  } finally {
    pickingCandidate.value = false;
  }
}
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const isFolderMode = computed(() => form.mode === "folder");
const isRegexMode = computed(() => form.mode === "regex");
const isFullMode = computed(() => form.mode === "full");
const isFolderResult = computed(() => !!result.value?.folderDiffs);
const showFullDiff = computed(
  () => isFullMode.value && !!lastFullTarget.value && !!lastFullCandidate.value,
);

const modeHint = computed(() => {
  switch (form.mode) {
    case "line":
      return "按行比对：适合歌单、清单等。空行与纯空白行不参与比对。";
    case "full":
      return "全文比对：默认字节级一致，可通过选项放宽换行、BOM 等差异。";
    case "regex":
      return "规则比对：拖拽积木组合匹配规则，检验待比对项格式是否符合。";
    case "folder":
      return "文件夹比对：递归比较目录结构与每个文件内容。";
  }
});

const modeLabel = computed(() => {
  switch (form.mode) {
    case "line":
      return "按行比对";
    case "full":
      return "全文比对";
    case "regex":
      return "规则比对";
    case "folder":
      return "文件夹比对";
  }
});

const progressPercent = computed(() => {
  if (!folderProgress.value || folderProgress.value.total <= 0) return 0;
  return Math.min(
    100,
    Math.round((folderProgress.value.scanned / folderProgress.value.total) * 100),
  );
});

function toPersistedSettings(): TextCompareSettingsPersisted {
  return {
    mode: form.mode,
    fullText: { ...form.fullText },
    line: { ...form.line },
    regex: { ...form.regex },
    ruleGraph: structuredClone(form.ruleGraph),
    legacyRegex: form.legacyRegex,
    useLegacyRegex: form.useLegacyRegex,
  };
}

function isRuleGraph(value: unknown): value is RuleGraph {
  if (!value || typeof value !== "object") return false;
  const g = value as RuleGraph;
  return g.version === 1 && Array.isArray(g.nodes) && Array.isArray(g.edges);
}

function applyPersistedSettings(saved: TextCompareSettingsPersisted) {
  const validModes: CompareMode[] = ["line", "full", "regex", "folder"];
  if (validModes.includes(saved.mode as CompareMode)) {
    form.mode = saved.mode as CompareMode;
  }
  Object.assign(form.fullText, saved.fullText);
  Object.assign(form.line, saved.line);
  if (saved.line.ignoreOrder === undefined) {
    form.line.ignoreOrder = true;
  }
  Object.assign(form.regex, saved.regex);
  if (isRuleGraph(saved.ruleGraph)) {
    form.ruleGraph = saved.ruleGraph;
  } else {
    form.ruleGraph = createDefaultRuleGraph();
  }
  form.legacyRegex = saved.legacyRegex ?? "";
  form.useLegacyRegex = saved.useLegacyRegex ?? false;
}

function scheduleSaveSettings() {
  if (!settingsReady.value) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void invoke("text_compare_save_settings", { settings: toPersistedSettings() });
  }, 400);
}

async function loadSettings() {
  try {
    const saved = await invoke<TextCompareSettingsPersisted>("text_compare_get_settings");
    applyPersistedSettings(saved);
  } catch {
    // 使用默认选项
  } finally {
    settingsReady.value = true;
  }
}

onMounted(() => {
  void loadSettings();
  void listen<{
    scanned: number;
    total: number;
    currentPath: string;
    phase: string;
  }>("compare_progress", (event) => {
    folderProgress.value = event.payload;
  }).then((off) => unlisteners.push(off));
});

onBeforeUnmount(() => {
  unlisteners.forEach((off) => off());
  if (saveTimer) clearTimeout(saveTimer);
});

watch(
  () => [form.mode, form.fullText, form.line, form.regex, form.ruleGraph, form.legacyRegex, form.useLegacyRegex],
  () => scheduleSaveSettings(),
  { deep: true },
);

async function resolveSideText(text: string, filePath: string): Promise<string> {
  if (text.trim()) return text;
  if (!filePath.trim()) return "";
  return invoke<string>("read_text_file", { path: filePath.trim() });
}

function checkTextSize(target: string, candidate: string): boolean {
  compareWarning.value = null;
  const total = target.length + candidate.length;
  if (total > MAX_COMPARE_CHARS) {
    compareError.value = `文本过大（约 ${Math.round(total / 1024)} KB），请缩小内容或改用文件夹比对`;
    return false;
  }
  if (isLargeText(target) || isLargeText(candidate)) {
    compareWarning.value = "文本较大，比对与 diff 展示可能较慢";
  }
  return true;
}

async function onCompare() {
  compareError.value = null;
  compareWarning.value = null;
  result.value = null;
  lastFullTarget.value = "";
  lastFullCandidate.value = "";
  folderProgress.value = null;

  comparing.value = true;
  try {
    if (form.mode === "folder") {
      if (!form.targetFolder.trim() || !form.candidateFolder.trim()) {
        compareError.value = "请选择目标文件夹与待比对文件夹";
        return;
      }
      const raw = await invoke<FolderCompareResultRaw>("compare_folders", {
        target: form.targetFolder.trim(),
        candidate: form.candidateFolder.trim(),
      });
      result.value = mapFolderCompareResult(raw);
      return;
    }

    if (form.mode === "regex") {
      const candidate = await resolveSideText(form.candidateText, form.candidateFile);
      if (!candidate.trim()) {
        compareError.value = "待比对项为空";
        return;
      }
      if (!checkTextSize("x", candidate)) return;

      if (form.useLegacyRegex) {
        const pattern = form.legacyRegex.trim();
        if (!pattern) {
          compareError.value = "请填写高级手写正则，或关闭该选项使用规则图";
          return;
        }
        result.value = compareRegex(pattern, candidate, form.regex);
        return;
      }

      result.value = compareWithRuleGraph(form.ruleGraph, candidate);
      return;
    }

    const target = await resolveSideText(form.targetText, form.targetFile);
    const candidate = await resolveSideText(form.candidateText, form.candidateFile);

    if (!target.trim() && !candidate.trim()) {
      compareError.value = "请填写或导入目标项与待比对项";
      return;
    }
    if (!target.trim()) {
      compareError.value = "目标项为空";
      return;
    }
    if (!candidate.trim()) {
      compareError.value = "待比对项为空";
      return;
    }
    if (!checkTextSize(target, candidate)) return;

    if (form.mode === "full") {
      lastFullTarget.value = target;
      lastFullCandidate.value = candidate;
      result.value = compareFullText(target, candidate, form.fullText);
    } else {
      result.value = compareLines(target, candidate, form.line);
    }
  } catch (err) {
    compareError.value = err instanceof Error ? err.message : String(err);
  } finally {
    comparing.value = false;
    folderProgress.value = null;
  }
}

async function exportReport(format: ReportFormat) {
  if (!result.value || exporting.value) return;
  exporting.value = true;
  compareError.value = null;
  try {
    const ext = format === "csv" ? "csv" : "txt";
    const path = await invoke<string | null>("pick_save_file", {
      defaultName: `compare-report.${ext}`,
      filterLabel: format === "csv" ? "CSV" : "Text",
      filterExts: [ext],
    });
    if (!path) return;
    const content = buildCompareReport(form.mode, result.value, format);
    await invoke("write_text_file", { path, content });
  } catch (err) {
    compareError.value = err instanceof Error ? err.message : String(err);
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden p-4 sm:p-5">
    <div class="mb-3 flex shrink-0 items-center justify-between gap-3">
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-zinc-400 transition hover:bg-white/5 hover:text-accent"
        @click="router.push('/')"
      >
        <Icon icon="mdi:arrow-left" />
        返回首页
      </button>
      <div class="flex items-center gap-2 text-sm text-zinc-500">
        <Icon icon="mdi:file-compare" class="text-lg text-accent" />
        <span>文本比对</span>
      </div>
    </div>

    <div class="mb-3 shrink-0">
      <ModeTabs v-model="form.mode" />
      <p class="mt-2 text-xs text-zinc-500">{{ modeHint }}</p>
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden lg:flex-row">
      <section
        class="flex min-h-0 min-w-0 flex-[2] flex-col overflow-hidden rounded-xl border border-border bg-surface-elevated/50"
      >
        <div class="shrink-0 border-b border-border px-4 py-2.5 text-sm font-medium text-zinc-300">
          输入
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto p-4">
          <FolderInputPair
            v-if="isFolderMode"
            v-model:target-folder="form.targetFolder"
            v-model:candidate-folder="form.candidateFolder"
          />
          <template v-if="isRegexMode">
            <RuleGraphEditor
              v-model="form.ruleGraph"
              :preview-text="form.candidateText"
            />
            <details class="mt-3 rounded-lg border border-border bg-black/20 px-3 py-2">
              <summary class="cursor-pointer text-xs text-zinc-500">高级：手写正则</summary>
              <div class="mt-2 space-y-2">
                <label class="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
                  <input v-model="form.useLegacyRegex" type="checkbox" class="accent-accent" />
                  使用手写正则代替规则图
                </label>
                <input
                  v-model="form.legacyRegex"
                  type="text"
                  class="w-full rounded-lg border border-border bg-black/30 px-3 py-2 font-mono text-sm text-zinc-300"
                  placeholder="如 ^\d+\.\s+.+$"
                  :disabled="!form.useLegacyRegex"
                />
              </div>
            </details>
            <div class="mt-3 flex min-h-0 flex-col gap-2">
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-medium text-zinc-300">待比对项</span>
                <button
                  type="button"
                  class="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-white/5 disabled:opacity-50"
                  :disabled="pickingCandidate"
                  @click="importCandidateFile"
                >
                  <Icon icon="mdi:file-import-outline" />
                  导入文件
                </button>
              </div>
              <textarea
                v-model="form.candidateText"
                class="min-h-[8rem] w-full rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-zinc-300"
                placeholder="粘贴待检验的文本…"
              />
            </div>
          </template>
          <TextInputPair
            v-else
            v-model:target-text="form.targetText"
            v-model:candidate-text="form.candidateText"
            v-model:target-file="form.targetFile"
            v-model:candidate-file="form.candidateFile"
            target-label="目标项"
            candidate-label="待比对项"
          />
        </div>

        <div class="flex shrink-0 flex-col gap-2 border-t border-border bg-black/20 px-4 py-3">
          <div v-if="comparing && folderProgress" class="space-y-1">
            <div class="h-1.5 overflow-hidden rounded-full bg-black/40">
              <div
                class="h-full bg-accent transition-all duration-200"
                :style="{ width: `${progressPercent}%` }"
              />
            </div>
            <p class="truncate text-xs text-zinc-500">
              {{ folderProgress.phase === "scan" ? "扫描" : "比对" }}：
              {{ folderProgress.currentPath || "…" }}
              （{{ folderProgress.scanned }}/{{ folderProgress.total }}）
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black transition hover:brightness-110 disabled:opacity-60"
              :disabled="comparing"
              @click="onCompare"
            >
              {{ comparing ? "比对中…" : "开始比对" }}
            </button>
            <p v-if="compareWarning" class="text-xs text-amber-400/90">{{ compareWarning }}</p>
            <p v-if="compareError" class="text-sm text-rose-400">{{ compareError }}</p>
          </div>
        </div>
      </section>

      <aside class="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden lg:max-w-sm">
        <CompareOptions
          v-if="!isRegexMode"
          :mode="form.mode"
          :full-text="form.fullText"
          :line="form.line"
          :regex="form.regex"
        />

        <section
          class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-black/25"
        >
          <div
            class="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5"
          >
            <span class="text-sm font-medium text-zinc-300">比对结果</span>
            <div v-if="result" class="flex gap-1">
              <button
                type="button"
                class="rounded border border-border px-2 py-0.5 text-[10px] text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200 disabled:opacity-40"
                :disabled="exporting"
                @click="exportReport('txt')"
              >
                导出 TXT
              </button>
              <button
                type="button"
                class="rounded border border-border px-2 py-0.5 text-[10px] text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200 disabled:opacity-40"
                :disabled="exporting"
                @click="exportReport('csv')"
              >
                导出 CSV
              </button>
            </div>
          </div>

          <div
            v-if="!result"
            class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center"
          >
            <Icon icon="mdi:chart-box-outline" class="text-3xl text-zinc-600" />
            <p class="text-sm text-zinc-500">运行比对后在此显示统计与差异明细</p>
          </div>

          <template v-else>
            <div class="shrink-0 border-b border-border p-4">
              <CompareStats :result="result" :mode-label="modeLabel" />
            </div>
            <TextDiffView
              v-if="showFullDiff"
              :target="lastFullTarget"
              :candidate="lastFullCandidate"
              :options="form.fullText"
            />
            <FolderDiffTree v-if="isFolderResult && result.folderDiffs" :diffs="result.folderDiffs" />
            <CompareDetailList v-else-if="!showFullDiff" :result="result" />
          </template>
        </section>
      </aside>
    </div>
  </div>
</template>
