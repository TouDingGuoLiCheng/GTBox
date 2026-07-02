<script setup lang="ts">
import { Icon } from "@iconify/vue";
import { computed, ref } from "vue";
import type { RuleGraph } from "../../types/ruleGraph";
import PyCharmCode from "./PyCharmCode.vue";
import { compileToPython } from "../../utils/ruleGraph/compileToPython";
import { pseudoPatternGraph } from "../../utils/ruleGraph/pseudoPatternGraph";
import { summarizeGraph } from "../../utils/ruleGraph/summarizeGraph";
import { validateGraphForBuilder } from "../../utils/ruleGraph/validateGraphForBuilder";
import { pushDebugLine } from "../../utils/mediaDebug";

const props = defineProps<{
  graph: RuleGraph;
}>();

type CodeTab = "pattern" | "python" | "snippet";

const copied = ref<"pattern" | "python" | "snippet" | null>(null);
const codeTab = ref<CodeTab>("pattern");

const summary = computed(() => summarizeGraph(props.graph));
const pseudoPattern = computed(() => pseudoPatternGraph(props.graph));
const validationIssues = computed(() => validateGraphForBuilder(props.graph));
const validationErrors = computed(() =>
  validationIssues.value.filter((i) => i.severity === "error"),
);
const validationWarnings = computed(() =>
  validationIssues.value.filter((i) => i.severity === "warning"),
);
const pythonResult = computed(() => compileToPython(props.graph));

const isDocumentExport = computed(() => pythonResult.value.exportKind === "document");
const hasSnippet = computed(() => !!pythonResult.value.snippet);
const codeTabs = computed((): Array<{ id: CodeTab; label: string }> => {
  if (isDocumentExport.value && hasSnippet.value) {
    return [
      { id: "pattern", label: "子正则" },
      { id: "snippet", label: "辅助脚本" },
    ];
  }
  const tabs: Array<{ id: CodeTab; label: string }> = [{ id: "pattern", label: "正则" }];
  if (pythonResult.value.code) tabs.push({ id: "python", label: "Python" });
  if (hasSnippet.value) tabs.push({ id: "snippet", label: "辅助脚本" });
  return tabs;
});

const flagLabels: Record<string, string> = {
  IGNORECASE: "i",
  MULTILINE: "m",
  DOTALL: "s",
};

let copyTimer: ReturnType<typeof setTimeout> | null = null;

async function copyText(kind: "pattern" | "python" | "snippet", text: string) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = kind;
    pushDebugLine("正则生成", "copy", kind);
  } catch {
    copied.value = null;
  }
  if (copyTimer) clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    copied.value = null;
  }, 1500);
}

function setCodeTab(tab: CodeTab) {
  codeTab.value = tab;
  pushDebugLine("正则生成", "output-tab", tab);
}

function copyActive() {
  const r = pythonResult.value;
  if (codeTab.value === "pattern" && r.pattern) void copyText("pattern", r.pattern);
  else if (codeTab.value === "python" && r.code) void copyText("python", r.code);
  else if (codeTab.value === "snippet" && r.snippet) void copyText("snippet", r.snippet);
}
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section class="ui-matte-panel rounded-xl">
        <div class="ui-matte-panel-header px-3 py-2 text-xs text-zinc-500">规则说明</div>
        <p class="px-3 pb-3 text-sm leading-relaxed text-zinc-300">{{ summary }}</p>
        <p
          v-for="issue in validationErrors"
          :key="issue.code + (issue.nodeId ?? '')"
          class="border-t border-border px-3 py-2 text-xs text-rose-400"
        >
          {{ issue.message }}
        </p>
        <p
          v-for="issue in validationWarnings"
          :key="'w-' + issue.code + (issue.nodeId ?? '')"
          class="border-t border-border px-3 py-2 text-xs text-amber-400/90"
        >
          {{ issue.message }}
        </p>
      </section>

      <section class="ui-matte-panel rounded-xl">
        <div class="ui-matte-panel-header px-3 py-2 text-xs text-zinc-500">可读模式</div>
        <p class="break-all px-3 pb-3 font-mono text-sm leading-relaxed text-sky-300/90">
          {{ pseudoPattern }}
        </p>
      </section>
    </div>

    <section class="ui-matte-panel overflow-hidden rounded-xl">
      <div class="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div class="flex gap-1">
          <button
            v-for="tab in codeTabs"
            :key="tab.id"
            type="button"
            class="rounded-md px-2 py-1 text-xs transition"
            :class="
              codeTab === tab.id
                ? 'bg-white/10 text-zinc-200'
                : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-400'
            "
            @click="setCodeTab(tab.id)"
          >
            {{ tab.label }}
          </button>
        </div>
        <button
          type="button"
          class="icon-btn"
          :class="{ 'icon-btn--ok': copied === codeTab }"
          title="复制"
          :disabled="
            (codeTab === 'pattern' && !pythonResult.pattern) ||
            (codeTab === 'python' && !pythonResult.code) ||
            (codeTab === 'snippet' && !pythonResult.snippet)
          "
          @click="copyActive"
        >
          <Icon :icon="copied === codeTab ? 'mdi:check' : 'mdi:content-copy'" class="h-4 w-4" />
        </button>
      </div>

      <div class="space-y-2 px-3 py-3">
        <p v-if="pythonResult.error" class="text-xs text-rose-400">{{ pythonResult.error }}</p>
        <p v-else-if="pythonResult.warning" class="text-xs text-amber-400/90">
          {{ pythonResult.warning }}
        </p>

        <template v-if="codeTab === 'pattern'">
          <pre
            v-if="pythonResult.pattern"
            class="regex-source overflow-x-auto rounded-lg px-4 py-3 font-mono text-sm leading-relaxed"
          >{{ pythonResult.pattern }}</pre>

          <div v-if="pythonResult.pattern && !pythonResult.error" class="flex flex-wrap gap-1.5">
            <span
              v-for="flag in pythonResult.flags"
              :key="flag"
              class="rounded border border-border/80 bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500"
            >
              {{ flagLabels[flag] ?? flag }}
            </span>
            <Icon
              v-if="pythonResult.complete"
              icon="mdi:check-decagram"
              class="text-base text-emerald-500/80"
              title="完整可表达"
            />
            <Icon
              v-else
              icon="mdi:alert-decagram-outline"
              class="text-base text-amber-500/80"
              title="近似表达"
            />
          </div>
        </template>

        <PyCharmCode v-else-if="codeTab === 'python' && pythonResult.code" :code="pythonResult.code" />
        <PyCharmCode v-else-if="codeTab === 'snippet' && pythonResult.snippet" :code="pythonResult.snippet" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.regex-source {
  background: #2b2b2b;
  color: #6a8759;
  word-break: break-all;
  white-space: pre-wrap;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 0.375rem;
  border: 1px solid var(--color-border);
  background: rgb(0 0 0 / 0.25);
  color: rgb(161 161 170);
  transition: background 0.15s, color 0.15s;
}
.icon-btn:hover:not(:disabled) {
  background: rgb(255 255 255 / 0.06);
  color: rgb(212 212 216);
}
.icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.icon-btn--ok {
  border-color: rgb(52 211 153 / 0.4);
  color: rgb(52 211 153);
}
</style>
