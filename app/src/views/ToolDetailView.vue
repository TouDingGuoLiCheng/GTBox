<script setup lang="ts">
import { Icon } from "@iconify/vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useToolsStore } from "../stores/tools";
import type { ToolParam } from "../types/tool";

const route = useRoute();
const router = useRouter();
const store = useToolsStore();

const tool = computed(() => store.getToolById(route.params.id as string));
const formValues = reactive<Record<string, unknown>>({});
const logs = ref<string[]>([]);
const runId = ref<string | null>(null);
const running = ref(false);
const exitCode = ref<number | null>(null);
const runError = ref<string | null>(null);
const pickingDialog = ref(false);
const unlisteners: UnlistenFn[] = [];

function initForm(params?: ToolParam[]) {
  Object.keys(formValues).forEach((key) => delete formValues[key]);
  params?.forEach((param) => {
    if (param.default !== undefined) {
      formValues[param.name] = param.default;
      return;
    }
    if (param.type === "boolean") {
      formValues[param.name] = false;
      return;
    }
    formValues[param.name] = "";
  });
}

watch(
  () => tool.value?.params,
  (params) => {
    initForm(params);
    logs.value = [];
    runId.value = null;
    running.value = false;
    exitCode.value = null;
    runError.value = null;
  },
  { immediate: true },
);

async function pickFolderFor(paramName: string) {
  if (pickingDialog.value) return;
  pickingDialog.value = true;
  try {
    const path = await invoke<string | null>("pick_folder");
    if (path) {
      formValues[paramName] = path;
    }
  } catch (err) {
    runError.value = err instanceof Error ? err.message : String(err);
  } finally {
    pickingDialog.value = false;
  }
}

function validateBeforeRun(): string | null {
  const params = tool.value?.params;
  if (!params) {
    return null;
  }
  for (const p of params) {
    if (p.type === "folder") {
      const v = formValues[p.name];
      if (v === undefined || v === null || String(v).trim() === "") {
        return `请先填写或选择：${p.label}`;
      }
    }
  }
  return null;
}

async function runCurrentTool() {
  if (!tool.value) {
    return;
  }
  const invalid = validateBeforeRun();
  if (invalid) {
    runError.value = invalid;
    return;
  }
  running.value = true;
  exitCode.value = null;
  runError.value = null;
  logs.value = [];

  try {
    const id = await invoke<string>("run_tool", {
      pluginId: tool.value.id,
      params: formValues,
    });
    runId.value = id;
  } catch (err) {
    running.value = false;
    runError.value = err instanceof Error ? err.message : String(err);
  }
}

async function cancelCurrentRun() {
  if (!runId.value) {
    return;
  }
  try {
    await invoke<boolean>("cancel_run", { runId: runId.value });
  } catch (err) {
    runError.value = err instanceof Error ? err.message : String(err);
  }
}

function appendLog(line: string) {
  logs.value = [...logs.value, line].slice(-600);
}

onMounted(() => {
  if (!store.tools.length) {
    void store.loadTools();
  }

  void listen<{ runId: string; stream: string; line: string }>("tool:log", (event) => {
    if (!runId.value || event.payload.runId !== runId.value) {
      return;
    }
    appendLog(`[${event.payload.stream}] ${event.payload.line}`);
  }).then((off) => unlisteners.push(off));

  void listen<{ runId: string; code: number }>("tool:exit", (event) => {
    if (!runId.value || event.payload.runId !== runId.value) {
      return;
    }
    running.value = false;
    exitCode.value = event.payload.code;
    appendLog(`进程结束，退出码：${event.payload.code}`);
  }).then((off) => unlisteners.push(off));
});

onBeforeUnmount(() => {
  unlisteners.forEach((off) => off());
});
</script>

<template>
  <div class="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden p-4 sm:p-6">
    <button
      type="button"
      class="mb-4 shrink-0 flex w-fit items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-zinc-400 transition hover:bg-white/5 hover:text-accent"
      @click="router.push('/')"
    >
      <Icon icon="mdi:arrow-left" />
      返回首页
    </button>

    <div v-if="tool" class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        v-motion
        :initial="{ opacity: 0, y: 16 }"
        :enter="{ opacity: 1, y: 0, transition: { duration: 0.4 } }"
        class="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface-elevated/60 backdrop-blur-sm"
      >
        <!-- 可滚动：标题 + 参数 -->
        <div class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-6 sm:p-8 sm:pb-4">
          <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <Icon :icon="tool.icon ?? 'mdi:tools'" class="text-3xl" />
          </div>
          <h2 class="mb-2 text-2xl font-semibold">{{ tool.name }}</h2>
          <p class="mb-6 text-sm text-zinc-500">{{ tool.description }}</p>
          <div v-if="tool.params?.length" class="space-y-4">
            <div
              v-for="param in tool.params"
              :key="param.name"
              class="rounded-lg border border-border bg-black/20 p-4"
            >
              <label class="mb-2 block text-sm text-zinc-300">{{ param.label }}</label>
              <div v-if="param.type === 'folder'" class="flex gap-2">
                <input
                  v-model="formValues[param.name]"
                  type="text"
                  class="min-w-0 flex-1 rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-zinc-300"
                  placeholder="路径或点击「浏览…」"
                />
                <button
                  type="button"
                  class="shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-zinc-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="pickingDialog"
                  @click="pickFolderFor(param.name)"
                >
                  {{ pickingDialog ? "选择中…" : "浏览…" }}
                </button>
              </div>
              <input
                v-else-if="param.type === 'number'"
                v-model="formValues[param.name]"
                type="number"
                class="w-full rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-zinc-300"
              />
              <input
                v-else-if="param.type !== 'boolean' && param.type !== 'select'"
                v-model="formValues[param.name]"
                type="text"
                class="w-full rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-zinc-300"
              />
              <select
                v-else-if="param.type === 'select'"
                v-model="formValues[param.name]"
                class="w-full rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-zinc-300"
              >
                <option v-for="option in param.options ?? []" :key="option" :value="option">
                  {{ option }}
                </option>
              </select>
              <label v-else class="flex items-center gap-2 text-sm text-zinc-300">
                <input v-model="formValues[param.name]" type="checkbox" />
                启用
              </label>
              <p v-if="param.flag" class="mt-2 text-xs text-zinc-500">CLI 参数：{{ param.flag }}</p>
            </div>
          </div>
          <p
            v-else
            class="rounded-lg border border-dashed border-border bg-black/20 px-4 py-6 text-center text-sm text-zinc-500"
          >
            当前工具未定义参数，将按默认配置直接执行
          </p>
        </div>

        <!-- 固定在卡片底部：运行闭环 + 日志 -->
        <div
          class="shrink-0 space-y-3 border-t border-border bg-surface-elevated/95 px-6 py-4 sm:px-8"
        >
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="running"
              @click="runCurrentTool"
            >
              {{ running ? "运行中…" : "运行工具" }}
            </button>
            <button
              type="button"
              class="rounded-lg border border-border px-4 py-2 text-sm text-zinc-200 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!running"
              @click="cancelCurrentRun"
            >
              取消运行
            </button>
            <span v-if="exitCode !== null" class="text-sm text-zinc-400">退出码：{{ exitCode }}</span>
          </div>

          <p v-if="runError" class="text-sm text-rose-400">{{ runError }}</p>

          <div class="rounded-lg border border-border bg-black/30">
            <div class="border-b border-border px-3 py-1.5 text-xs text-zinc-500">
              实时日志（最多 600 行）
            </div>
            <pre class="max-h-36 min-h-[4rem] overflow-auto px-3 py-2 text-xs leading-5 text-zinc-300 sm:max-h-48">{{
              logs.join("\n")
            }}</pre>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="shrink-0 py-8 text-center text-zinc-500">未找到该工具</div>
  </div>
</template>
