<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Icon } from "@iconify/vue";
import { invoke } from "@tauri-apps/api/core";
import type { RuleGraph } from "../../types/ruleGraph";
import {
  buildHighlightedParts,
  testSampleBlock,
  testSampleLines,
  type MatchSpan,
} from "../../utils/regexBuilder/regexSampleTest";
import { pushDebugLine } from "../../utils/mediaDebug";

const props = defineProps<{
  graph: RuleGraph;
}>();

type TestMode = "block" | "line";

const DEBOUNCE_MS = 300;

const mode = ref<TestMode>("block");
const sampleText = ref("");
const debouncedSample = ref("");
const pickingFile = ref(false);
const importError = ref<string | null>(null);

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

watch(sampleText, (value) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debouncedSample.value = value;
    debounceTimer = null;
  }, DEBOUNCE_MS);
});

watch(
  () => props.graph,
  () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debouncedSample.value = sampleText.value;
      debounceTimer = null;
    }, DEBOUNCE_MS);
  },
  { deep: true },
);

const blockResult = computed(() =>
  mode.value === "block" ? testSampleBlock(props.graph, debouncedSample.value) : null,
);

const lineResult = computed(() =>
  mode.value === "line" ? testSampleLines(props.graph, debouncedSample.value) : null,
);

const activeError = computed(() => {
  if (!debouncedSample.value && !sampleText.value) return null;
  return mode.value === "block" ? blockResult.value?.error : lineResult.value?.error;
});

const highlightParts = computed(() => {
  if (mode.value !== "block" || !debouncedSample.value) return [];
  return buildHighlightedParts(debouncedSample.value, blockResult.value?.matches ?? []);
});

const flatMatches = computed((): Array<MatchSpan & { lineNumber?: number; index: number }> => {
  if (mode.value === "block") {
    return (blockResult.value?.matches ?? []).map((m, index) => ({ ...m, index: index + 1 }));
  }
  const out: Array<MatchSpan & { lineNumber?: number; index: number }> = [];
  let idx = 0;
  for (const row of lineResult.value?.rows ?? []) {
    for (const m of row.matches) {
      idx += 1;
      out.push({ ...m, lineNumber: row.lineNumber, index: idx });
    }
  }
  return out;
});

const showEmptyHint = computed(
  () => !sampleText.value.trim() && !debouncedSample.value.trim(),
);

function setMode(next: TestMode) {
  if (mode.value === next) return;
  mode.value = next;
  pushDebugLine("正则生成", "test-mode", next === "block" ? "单段" : "按行");
}

async function importSampleFile() {
  if (pickingFile.value) return;
  pickingFile.value = true;
  importError.value = null;
  try {
    const path = await invoke<string | null>("pick_text_file");
    if (!path) return;
    sampleText.value = await invoke<string>("read_text_file", { path });
    const name = path.replace(/^.*[/\\]/, "");
    pushDebugLine("正则生成", "sample-import", name, { path });
  } catch (err) {
    importError.value = err instanceof Error ? err.message : String(err);
  } finally {
    pickingFile.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-3 p-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-1 rounded-lg border border-border bg-black/20 p-0.5">
        <button
          type="button"
          class="rounded-md px-3 py-1 text-xs transition"
          :class="
            mode === 'block'
              ? 'bg-accent/20 text-accent'
              : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
          "
          @click="setMode('block')"
        >
          单段
        </button>
        <button
          type="button"
          class="rounded-md px-3 py-1 text-xs transition"
          :class="
            mode === 'line'
              ? 'bg-accent/20 text-accent'
              : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
          "
          @click="setMode('line')"
        >
          按行
        </button>
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-white/5 disabled:opacity-50"
          :disabled="pickingFile"
          title="从文件载入样本"
          @click="importSampleFile"
        >
          <Icon icon="mdi:file-import-outline" />
        </button>
        <p v-if="mode === 'line' && lineResult && debouncedSample" class="text-xs text-zinc-600">
          {{ lineResult.passCount }}/{{ lineResult.total }}
        </p>
        <p
          v-else-if="mode === 'block' && blockResult && debouncedSample"
          class="text-xs text-zinc-600"
        >
          {{ blockResult.matches.length }}
          <Icon
            :icon="blockResult.pass ? 'mdi:check' : 'mdi:close'"
            class="inline text-sm"
            :class="blockResult.pass ? 'text-emerald-400' : 'text-rose-400'"
          />
        </p>
      </div>
    </div>

    <textarea
      v-model="sampleText"
      class="min-h-[8rem] w-full resize-y rounded-lg border border-border bg-black/30 px-3 py-2 font-mono text-sm text-zinc-300 outline-none focus:border-accent/40"
      placeholder="样本文本"
      spellcheck="false"
    />

    <p v-if="showEmptyHint" class="text-xs text-zinc-600">
      输入或导入文本，改积木后约 300ms 内更新试跑结果
    </p>

    <p v-if="importError" class="text-xs text-rose-400">{{ importError }}</p>

    <p v-if="activeError" class="text-xs text-amber-400/90">{{ activeError }}</p>

    <section v-if="mode === 'block' && debouncedSample && highlightParts.length" class="ui-matte-panel rounded-xl">
      <pre
        class="regex-highlight overflow-x-auto whitespace-pre-wrap break-all px-3 py-3 font-mono text-sm leading-relaxed"
      ><template v-for="(part, i) in highlightParts" :key="i"><mark
          v-if="part.highlight"
          class="regex-highlight__mark"
        >{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></pre>
    </section>

    <section v-if="mode === 'line' && debouncedSample && lineResult?.rows.length" class="space-y-1">
      <div
        v-for="row in lineResult.rows"
        :key="row.lineNumber"
        class="flex items-start gap-2 rounded-lg border border-border/60 bg-black/20 px-2.5 py-1.5 text-xs"
      >
        <Icon
          :icon="row.reason === '空行跳过' ? 'mdi:minus-circle-outline' : row.pass ? 'mdi:check-circle' : 'mdi:close-circle'"
          class="mt-0.5 shrink-0"
          :class="
            row.reason === '空行跳过'
              ? 'text-zinc-600'
              : row.pass
                ? 'text-emerald-400'
                : 'text-rose-400'
          "
        />
        <div class="min-w-0 flex-1">
          <span class="text-zinc-600">L{{ row.lineNumber }} </span>
          <span class="break-all font-mono text-zinc-300">
            <template
              v-for="(part, i) in buildHighlightedParts(row.text, row.matches)"
              :key="i"
            >
              <mark v-if="part.highlight" class="regex-highlight__mark">{{ part.text }}</mark>
              <template v-else>{{ part.text }}</template>
            </template>
          </span>
          <span v-if="row.reason" class="mt-0.5 block text-rose-300/80">{{ row.reason }}</span>
        </div>
      </div>
    </section>

    <section v-if="flatMatches.length > 0" class="ui-matte-panel rounded-xl">
      <div class="divide-y divide-border/60">
        <div
          v-for="match in flatMatches"
          :key="`${match.index}-${match.start}`"
          class="px-3 py-2 text-xs"
        >
          <div class="flex flex-wrap items-center gap-2 text-zinc-500">
            <span>#{{ match.index }}</span>
            <span v-if="match.lineNumber">行 {{ match.lineNumber }}</span>
            <span>位置 {{ match.start }}–{{ match.end }}</span>
          </div>
          <p class="mt-1 break-all font-mono text-sky-300/90">{{ match.text }}</p>
          <p v-if="match.groups.some(Boolean)" class="mt-1 font-mono text-[10px] text-amber-200/70">
            <span
              v-for="(g, gi) in match.groups.filter(Boolean)"
              :key="gi"
              class="mr-2"
            >
              ${{ gi + 1 }}={{ g }}
            </span>
          </p>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.regex-highlight {
  background: #2b2b2b;
  color: #a9b7c6;
}
.regex-highlight__mark {
  border-radius: 2px;
  background: rgb(255 198 109 / 0.28);
  color: #ffc66d;
  padding: 0 1px;
}
</style>
