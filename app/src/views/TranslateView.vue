<script setup lang="ts">
import { Icon } from "@iconify/vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type {
  HistoryRecord,
  TranslateResult,
  TranslateSettings,
  TranslatorsFile,
} from "../types/translate";

const router = useRouter();

const sourceText = ref("");
const translatedText = ref("");
const translating = ref(false);
const lastError = ref<string | null>(null);
const lastMeta = ref<{ provider?: string; fromCache?: boolean; durationMs?: number } | null>(null);

const settings = reactive<TranslateSettings>({
  targetLang: "auto",
  primaryProvider: "baidu",
  fallbackEnabled: true,
  timeoutSec: 20,
  cacheTtlSec: 30,
  historyMaxCount: 200,
});

const providers = ref<TranslatorsFile["providers"]>([]);
const history = ref<HistoryRecord[]>([]);
const savingSettings = ref(false);

const targetLangOptions = [
  { value: "auto", label: "自动（中文→英，其他→简中）" },
  { value: "zh-Hans", label: "简体中文" },
  { value: "zh-Hant", label: "繁体中文" },
  { value: "en", label: "英语" },
  { value: "ja", label: "日语" },
  { value: "ko", label: "韩语" },
] as const;

const unlisteners: UnlistenFn[] = [];

/** 输入停止后多久触发翻译：过短易连发请求，过长体感迟滞 */
const AUTO_TRANSLATE_DEBOUNCE_MS = 550;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let translateSeq = 0;
/** 从历史回填时避免再次触发自动翻译 */
let suppressAutoTranslate = false;

function formatTime(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function truncate(text: string, max = 80) {
  const chars = [...text];
  if (chars.length <= max) return text;
  return `${chars.slice(0, max).join("")}…`;
}

async function loadSettings() {
  const loaded = await invoke<TranslateSettings>("translate_get_settings");
  Object.assign(settings, loaded);
}

async function loadProviders() {
  const file = await invoke<TranslatorsFile>("translate_list_providers");
  providers.value = (file.providers ?? []).filter((p) => p.enabled);
}

async function loadHistory() {
  history.value = await invoke<HistoryRecord[]>("translate_list_history");
}

async function saveSettings() {
  savingSettings.value = true;
  try {
    await invoke("translate_save_settings", { settings: { ...settings } });
  } finally {
    savingSettings.value = false;
  }
}

function scheduleAutoTranslate() {
  if (suppressAutoTranslate) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runTranslate();
  }, AUTO_TRANSLATE_DEBOUNCE_MS);
}

function clearOutputs() {
  translatedText.value = "";
  lastError.value = null;
  lastMeta.value = null;
}

async function runTranslate() {
  const text = sourceText.value.trim();
  if (!text) {
    clearOutputs();
    translating.value = false;
    return;
  }

  const seq = ++translateSeq;
  translating.value = true;
  lastError.value = null;

  try {
    const result = await invoke<TranslateResult>("translate_text", { text });
    if (seq !== translateSeq) return;

    if (result.ok && result.translatedText) {
      translatedText.value = result.translatedText;
      lastMeta.value = {
        provider: result.provider,
        fromCache: result.fromCache,
        durationMs: result.durationMs,
      };
    } else {
      lastError.value = result.error ?? "翻译失败";
    }
    await loadHistory();
  } catch (err) {
    if (seq !== translateSeq) return;
    lastError.value = err instanceof Error ? err.message : String(err);
  } finally {
    if (seq === translateSeq) translating.value = false;
  }
}

async function copyText(text: string) {
  const t = text.trim();
  if (!t) return;
  try {
    await navigator.clipboard.writeText(t);
  } catch {
    /* ignore */
  }
}

function applyHistory(item: HistoryRecord) {
  suppressAutoTranslate = true;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  translateSeq++;
  sourceText.value = item.sourceText;
  translatedText.value = item.translatedText ?? "";
  lastError.value = item.ok ? null : (item.error ?? "翻译失败");
  lastMeta.value = {
    provider: item.provider,
    fromCache: item.fromCache,
    durationMs: item.durationMs,
  };
  translating.value = false;
  suppressAutoTranslate = false;
}

function retranslateItem(item: HistoryRecord) {
  sourceText.value = item.sourceText;
  scheduleAutoTranslate();
}

function clearAll() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  translateSeq++;
  sourceText.value = "";
  clearOutputs();
  translating.value = false;
}

watch(sourceText, (val) => {
  if (suppressAutoTranslate) return;
  if (!val.trim()) {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    translateSeq++;
    clearOutputs();
    translating.value = false;
    return;
  }
  scheduleAutoTranslate();
});

watch(
  () => [settings.targetLang, settings.primaryProvider, settings.fallbackEnabled] as const,
  () => {
    if (sourceText.value.trim()) scheduleAutoTranslate();
  },
);

async function deleteRecord(id: string) {
  await invoke("translate_delete_history", { id });
  await loadHistory();
}

async function clearHistory() {
  await invoke("translate_clear_history");
  history.value = [];
}

onMounted(async () => {
  await Promise.all([loadSettings(), loadProviders(), loadHistory()]);
  unlisteners.push(
    await listen<HistoryRecord[]>("translate:history-updated", (e) => {
      history.value = e.payload;
    }),
  );
  unlisteners.push(
    await listen<TranslateSettings>("translate:settings-updated", (e) => {
      Object.assign(settings, e.payload);
    }),
  );
});

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer);
  translateSeq++;
  unlisteners.forEach((off) => off());
});
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
        <Icon icon="mdi:translate" class="text-lg text-accent" />
        <span>翻译</span>
      </div>
    </div>

    <div
      class="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]"
    >
      <!-- 上行：原文 | 参数 -->
      <div
        class="order-1 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface-elevated/50 lg:col-start-1 lg:row-start-1"
      >
        <div class="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
          <span class="text-sm font-medium text-zinc-300">原文</span>
          <button
            type="button"
            class="text-xs text-zinc-500 hover:text-accent"
            :disabled="!sourceText.trim()"
            @click="copyText(sourceText)"
          >
            复制
          </button>
        </div>
        <textarea
          v-model="sourceText"
          class="min-h-0 flex-1 resize-none bg-transparent px-4 py-3 text-sm leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-600"
          placeholder="输入或粘贴文本，停止输入约 0.5 秒后自动翻译…"
          spellcheck="false"
        />
      </div>

      <section
        class="order-3 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface-elevated/50 lg:order-none lg:col-start-2 lg:row-start-1"
      >
        <div class="border-b border-border px-4 py-2.5 text-sm font-medium text-zinc-300">
          参数
        </div>
        <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-sm">
            <label class="block">
              <span class="mb-1 block text-xs text-zinc-500">目标语言</span>
              <select
                v-model="settings.targetLang"
                class="w-full rounded-lg border border-border bg-black/20 px-3 py-2 text-zinc-200 outline-none focus:border-accent/50"
                @change="saveSettings"
              >
                <option v-for="opt in targetLangOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </label>
            <label class="block">
              <span class="mb-1 block text-xs text-zinc-500">翻译引擎</span>
              <select
                v-model="settings.primaryProvider"
                class="w-full rounded-lg border border-border bg-black/20 px-3 py-2 text-zinc-200 outline-none focus:border-accent/50"
                @change="saveSettings"
              >
                <option v-for="p in providers" :key="p.id" :value="p.id">
                  {{ p.name }}
                </option>
              </select>
            </label>
            <label class="flex cursor-pointer items-center gap-2 text-zinc-300">
              <input
                v-model="settings.fallbackEnabled"
                type="checkbox"
                class="rounded border-border"
                @change="saveSettings"
              />
              <span>主引擎失败时尝试备用</span>
            </label>
            <label class="block">
              <span class="mb-1 block text-xs text-zinc-500">超时（秒） {{ settings.timeoutSec }}</span>
              <input
                v-model.number="settings.timeoutSec"
                type="range"
                min="3"
                max="60"
                class="w-full"
                @change="saveSettings"
              />
            </label>
            <label class="block">
              <span class="mb-1 block text-xs text-zinc-500">缓存有效期（秒） {{ settings.cacheTtlSec }}</span>
              <input
                v-model.number="settings.cacheTtlSec"
                type="range"
                min="5"
                max="300"
                class="w-full"
                @change="saveSettings"
              />
            </label>
            <label class="block">
              <span class="mb-1 block text-xs text-zinc-500">历史保留条数 {{ settings.historyMaxCount }}</span>
              <input
                v-model.number="settings.historyMaxCount"
                type="range"
                min="20"
                max="500"
                step="10"
                class="w-full"
                @change="saveSettings"
              />
            </label>
          <p v-if="savingSettings" class="text-xs text-zinc-600">正在保存…</p>
        </div>
      </section>

      <!-- 下行：译文 | 翻译记录 -->
      <div
        class="order-2 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface-elevated/50 lg:order-none lg:col-start-1 lg:row-start-2"
      >
        <div class="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
          <span class="text-sm font-medium text-zinc-300">译文</span>
          <div class="flex items-center gap-3">
            <button
              type="button"
              class="text-xs text-zinc-500 hover:text-accent"
              :disabled="!translatedText.trim()"
              @click="copyText(translatedText)"
            >
              复制
            </button>
            <button
              type="button"
              class="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-40"
              :disabled="!sourceText && !translatedText"
              @click="clearAll"
            >
              清空
            </button>
          </div>
        </div>
        <div class="relative min-h-0 flex-1">
          <textarea
            :value="translatedText"
            readonly
            class="h-full w-full resize-none bg-transparent px-4 py-3 text-sm leading-relaxed text-zinc-100 outline-none"
            placeholder="译文将显示在这里…"
          />
          <div
            v-if="translating"
            class="absolute inset-0 flex items-center justify-center bg-black/30 text-sm text-zinc-300"
          >
            <Icon icon="mdi:loading" class="mr-2 animate-spin text-lg" />
            翻译中…
          </div>
        </div>
        <div
          v-if="lastError"
          class="shrink-0 border-t border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-300"
        >
          {{ lastError }}
        </div>
        <div
          v-else-if="lastMeta?.provider"
          class="shrink-0 border-t border-border px-4 py-2 text-xs text-zinc-500"
        >
          {{ lastMeta.provider }}
          <span v-if="lastMeta.fromCache"> · 缓存</span>
          <span v-if="lastMeta.durationMs != null"> · {{ lastMeta.durationMs }}ms</span>
        </div>
      </div>

      <section
        class="order-4 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface-elevated/50 lg:order-none lg:col-start-2 lg:row-start-2"
      >
        <div class="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
          <span class="text-sm font-medium text-zinc-300">翻译记录</span>
            <button
              type="button"
              class="text-xs text-zinc-500 hover:text-red-400 disabled:opacity-40"
              :disabled="!history.length"
              @click="clearHistory"
            >
              清空
            </button>
          </div>
          <ul class="min-h-0 flex-1 overflow-y-auto p-2">
            <li
              v-if="!history.length"
              class="px-2 py-6 text-center text-xs text-zinc-600"
            >
              暂无记录
            </li>
            <li
              v-for="item in history"
              :key="item.id"
              class="mb-1 rounded-lg border border-transparent px-2 py-2 transition hover:border-border hover:bg-white/5"
            >
              <div class="mb-1 flex items-center justify-between gap-2">
                <span class="text-[10px] text-zinc-600">{{ formatTime(item.createdAt) }}</span>
                <span
                  class="text-[10px]"
                  :class="item.ok ? 'text-emerald-500/80' : 'text-red-400/80'"
                >
                  {{ item.ok ? (item.provider ?? "成功") : "失败" }}
                </span>
              </div>
              <p class="cursor-pointer text-xs text-zinc-300" @click="applyHistory(item)">
                {{ truncate(item.sourceText) }}
              </p>
              <p
                v-if="item.translatedText"
                class="mt-0.5 cursor-pointer text-xs text-zinc-500"
                @click="applyHistory(item)"
              >
                {{ truncate(item.translatedText) }}
              </p>
              <div class="mt-1.5 flex gap-2">
                <button
                  type="button"
                  class="text-[10px] text-zinc-500 hover:text-accent"
                  @click="retranslateItem(item)"
                >
                  重译
                </button>
                <button
                  type="button"
                  class="text-[10px] text-zinc-500 hover:text-accent"
                  @click="copyText(item.translatedText ?? item.sourceText)"
                >
                  复制
                </button>
                <button
                  type="button"
                  class="text-[10px] text-zinc-500 hover:text-red-400"
                  @click="deleteRecord(item.id)"
                >
                  删除
                </button>
              </div>
            </li>
        </ul>
      </section>
    </div>
  </div>
</template>
