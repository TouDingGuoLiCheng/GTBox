<script setup lang="ts">
import { Icon } from "@iconify/vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();

const form = reactive({
  root: "",
  prefix: "",
  width: 3,
  start: "" as number | "",
  counterFile: "",
  noCounterFile: false,
  depth: "recursive" as "recursive" | "top",
  order: "path" as "path" | "none",
  dryRun: false,
});

const logs = ref<string[]>([]);
const runId = ref<string | null>(null);
const running = ref(false);
const exitCode = ref<number | null>(null);
const runError = ref<string | null>(null);
const pickingDialog = ref(false);
const unlisteners: UnlistenFn[] = [];

const depthOptions = [
  { value: "recursive", label: "含子文件夹" },
  { value: "top", label: "仅当前层" },
] as const;

const orderOptions = [
  { value: "path", label: "按路径排序" },
  { value: "none", label: "遍历顺序" },
] as const;

async function pickRoot() {
  if (pickingDialog.value) return;
  pickingDialog.value = true;
  try {
    const path = await invoke<string | null>("pick_folder");
    if (path) form.root = path;
  } catch (err) {
    runError.value = err instanceof Error ? err.message : String(err);
  } finally {
    pickingDialog.value = false;
  }
}

function buildParams(): Record<string, unknown> {
  const params: Record<string, unknown> = {
    root: form.root,
    prefix: form.prefix,
    width: form.width,
    depth: form.depth,
    order: form.order,
    noCounterFile: form.noCounterFile,
    dryRun: form.dryRun,
  };
  if (form.start !== "" && form.start !== null && form.start !== undefined) {
    params.start = Number(form.start);
  }
  if (form.counterFile.trim()) {
    params.counterFile = form.counterFile.trim();
  }
  return params;
}

async function runTool() {
  if (!form.root.trim()) {
    runError.value = "请先选择要改名的根目录";
    return;
  }
  running.value = true;
  exitCode.value = null;
  runError.value = null;
  logs.value = [];
  try {
    const id = await invoke<string>("run_tool", {
      pluginId: "batch_rename",
      params: buildParams(),
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
  logs.value = [...logs.value, line].slice(-600);
}

onMounted(() => {
  void listen<{ runId: string; stream: string; line: string }>("tool:log", (event) => {
    if (!runId.value || event.payload.runId !== runId.value) return;
    appendLog(`[${event.payload.stream}] ${event.payload.line}`);
  }).then((off) => unlisteners.push(off));

  void listen<{ runId: string; code: number }>("tool:exit", (event) => {
    if (!runId.value || event.payload.runId !== runId.value) return;
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
        <Icon icon="mdi:rename-box" class="text-lg text-accent" />
        <span>批量文件改名</span>
      </div>
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden lg:flex-row">
      <!-- 参数平铺区 -->
      <section
        class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface-elevated/50"
      >
        <div class="shrink-0 border-b border-border px-4 py-2.5 text-sm font-medium text-zinc-300">
          参数
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto p-4">
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <!-- 根目录：整行 -->
            <label class="field-cell sm:col-span-2 lg:col-span-3 xl:col-span-4">
              <span class="field-label">要改名的根目录</span>
              <div class="flex gap-2">
                <input
                  v-model="form.root"
                  type="text"
                  class="field-input min-w-0 flex-1"
                  placeholder="选择或粘贴文件夹路径"
                />
                <button type="button" class="field-btn" :disabled="pickingDialog" @click="pickRoot">
                  {{ pickingDialog ? "选择中…" : "浏览" }}
                </button>
              </div>
            </label>

            <label class="field-cell">
              <span class="field-label">文件名前缀</span>
              <input v-model="form.prefix" type="text" class="field-input" placeholder="如：图片" />
            </label>

            <label class="field-cell">
              <span class="field-label">序号位数</span>
              <input v-model.number="form.width" type="number" min="1" max="12" class="field-input" />
            </label>

            <label class="field-cell">
              <span class="field-label">起始序号</span>
              <input
                v-model="form.start"
                type="number"
                min="1"
                class="field-input"
                placeholder="留空接续计数"
              />
            </label>

            <label class="field-cell">
              <span class="field-label">扫描范围</span>
              <select v-model="form.depth" class="field-input">
                <option v-for="o in depthOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </label>

            <label class="field-cell">
              <span class="field-label">编号顺序</span>
              <select v-model="form.order" class="field-input">
                <option v-for="o in orderOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </label>

            <label class="field-cell sm:col-span-2">
              <span class="field-label">计数文件（留空用默认 temp/rename_counter.txt）</span>
              <input
                v-model="form.counterFile"
                type="text"
                class="field-input"
                placeholder="可选"
                :disabled="form.noCounterFile"
              />
            </label>

            <!-- 开关平铺一行 -->
            <div class="flex flex-wrap items-end gap-4 sm:col-span-2 lg:col-span-3 xl:col-span-4">
              <label class="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
                <input v-model="form.noCounterFile" type="checkbox" class="accent-accent" />
                不使用计数文件
              </label>
              <label class="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
                <input v-model="form.dryRun" type="checkbox" class="accent-accent" />
                仅预览（不改名）
              </label>
            </div>
          </div>

          <p class="mt-3 text-xs text-zinc-500">
            规则：{前缀}{序号}{原扩展名}。建议先勾选「仅预览」查看日志，确认后再正式运行。
          </p>
        </div>

        <div
          class="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-black/20 px-4 py-3"
        >
          <button
            type="button"
            class="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black transition hover:brightness-110 disabled:opacity-60"
            :disabled="running"
            @click="runTool"
          >
            {{ running ? "运行中…" : "运行" }}
          </button>
          <button
            type="button"
            class="rounded-lg border border-border px-4 py-2 text-sm text-zinc-200 transition hover:bg-white/5 disabled:opacity-50"
            :disabled="!running"
            @click="cancelRun"
          >
            取消
          </button>
          <span v-if="exitCode !== null" class="text-sm text-zinc-400">退出码 {{ exitCode }}</span>
          <p v-if="runError" class="w-full text-sm text-rose-400">{{ runError }}</p>
        </div>
      </section>

      <!-- 日志侧栏 -->
      <aside
        class="flex h-48 min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-black/25 lg:h-auto lg:w-80 xl:w-96"
      >
        <div class="shrink-0 border-b border-border px-3 py-2 text-xs text-zinc-500">实时日志</div>
        <pre class="min-h-0 flex-1 overflow-auto p-3 text-xs leading-5 text-zinc-300">{{
          logs.length ? logs.join("\n") : "运行后在此显示输出…"
        }}</pre>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.field-cell {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.field-label {
  font-size: 0.75rem;
  color: rgb(161 161 170);
}
.field-input {
  width: 100%;
  border-radius: 0.5rem;
  border: 1px solid var(--color-border);
  background: rgb(0 0 0 / 0.3);
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  color: rgb(212 212 216);
}
.field-input:disabled {
  opacity: 0.45;
}
.field-btn {
  flex-shrink: 0;
  border-radius: 0.5rem;
  border: 1px solid var(--color-border);
  padding: 0.5rem 0.85rem;
  font-size: 0.875rem;
  color: rgb(228 228 231);
  transition: background 0.15s;
}
.field-btn:hover {
  background: rgb(255 255 255 / 0.08);
}
</style>
