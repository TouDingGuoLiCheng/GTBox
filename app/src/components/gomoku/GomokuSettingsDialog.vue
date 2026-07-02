<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import { Icon } from "@iconify/vue";
import { storeToRefs } from "pinia";
import { useAppearanceStore } from "../../stores/appearance";
import { useGomokuStore } from "../../stores/gomoku";
import type { AiDifficulty } from "../../types/gomoku";

const open = defineModel<boolean>({ default: false });

const appearance = useAppearanceStore();
const store = useGomokuStore();
const { settings } = storeToRefs(store);

const isLightPanel = computed(
  () =>
    appearance.colorScheme === "light" ||
    (appearance.colorScheme === "custom" && appearance.customSkin?.fontColor === "dark"),
);

const draft = reactive({ ...settings.value });

watch(settings, (next) => Object.assign(draft, next), { deep: true });
watch(open, (visible) => {
  if (visible) Object.assign(draft, settings.value);
});

function apply() {
  store.updateSettings({
    perMoveSec: Math.max(1, Number(draft.perMoveSec) || 60),
    totalSec: Math.max(1, Number(draft.totalSec) || 600),
    name1: draft.name1.trim() || "玩家一",
    name2: draft.name2.trim() || "玩家二",
    soundEnabled: draft.soundEnabled,
    bgmEnabled: draft.bgmEnabled,
    aiDifficulty: draft.aiDifficulty as AiDifficulty,
    aiDelayMs: Math.max(100, Number(draft.aiDelayMs) || 500),
    cvcIntervalMs: Math.max(100, Number(draft.cvcIntervalMs) || 400),
  });
}

function close() {
  apply();
  open.value = false;
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      @click.self="close"
    >
      <div
        class="gomoku-settings-panel max-h-[85vh] w-full max-w-lg overflow-y-auto p-5 shadow-2xl"
        :class="isLightPanel ? 'gomoku-settings-panel--light' : 'gomoku-settings-panel--dark'"
        role="dialog"
        aria-labelledby="gomoku-settings-title"
      >
        <div class="mb-4 flex items-center justify-between gap-3">
          <h3
            id="gomoku-settings-title"
            class="flex items-center gap-2 text-base font-medium"
          >
            <Icon icon="mdi:cog-outline" class="text-xl text-accent" />
            对局设置
          </h3>
          <button
            type="button"
            class="gomoku-settings-close rounded-lg p-1.5 transition duration-200 hover:scale-105 active:scale-95"
            aria-label="关闭"
            @click="close"
          >
            <Icon icon="mdi:close" class="text-xl" />
          </button>
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          <label class="gomoku-settings-label block text-xs">
            步时（秒）
            <input
              v-model.number="draft.perMoveSec"
              type="number"
              min="1"
              class="gomoku-settings-input mt-1 w-full rounded-lg border px-3 py-2 outline-none transition duration-150 focus:ring-1"
              @change="apply"
            />
          </label>
          <label class="gomoku-settings-label block text-xs">
            局时（秒）
            <input
              v-model.number="draft.totalSec"
              type="number"
              min="1"
              class="gomoku-settings-input mt-1 w-full rounded-lg border px-3 py-2 outline-none transition duration-150 focus:ring-1"
              @change="apply"
            />
          </label>
          <label class="gomoku-settings-label block text-xs">
            玩家一（黑）
            <input
              v-model="draft.name1"
              type="text"
              class="gomoku-settings-input mt-1 w-full rounded-lg border px-3 py-2 outline-none transition duration-150 focus:ring-1"
              @change="apply"
            />
          </label>
          <label class="gomoku-settings-label block text-xs">
            玩家二（白）
            <input
              v-model="draft.name2"
              type="text"
              class="gomoku-settings-input mt-1 w-full rounded-lg border px-3 py-2 outline-none transition duration-150 focus:ring-1"
              @change="apply"
            />
          </label>
          <label class="gomoku-settings-label block text-xs">
            AI 难度
            <select
              v-model="draft.aiDifficulty"
              class="gomoku-settings-input mt-1 w-full rounded-lg border px-3 py-2 outline-none transition duration-150 focus:ring-1"
              @change="apply"
            >
              <option value="standard">标准</option>
              <option value="easy">简单</option>
            </select>
          </label>
          <label class="gomoku-settings-label block text-xs">
            AI 思考延迟（ms）
            <input
              v-model.number="draft.aiDelayMs"
              type="number"
              min="100"
              class="gomoku-settings-input mt-1 w-full rounded-lg border px-3 py-2 outline-none transition duration-150 focus:ring-1"
              @change="apply"
            />
          </label>
          <label class="gomoku-settings-label block text-xs sm:col-span-2">
            机机间隔（ms）
            <input
              v-model.number="draft.cvcIntervalMs"
              type="number"
              min="100"
              class="gomoku-settings-input mt-1 w-full rounded-lg border px-3 py-2 outline-none transition duration-150 focus:ring-1"
              @change="apply"
            />
          </label>
          <div class="gomoku-settings-checks flex flex-col gap-2 text-xs sm:col-span-2">
            <label class="flex items-center gap-2">
              <input v-model="draft.soundEnabled" type="checkbox" class="accent-accent" @change="apply" />
              音效
            </label>
            <label class="flex items-center gap-2">
              <input v-model="draft.bgmEnabled" type="checkbox" class="accent-accent" @change="apply" />
              背景音乐（对局时播放）
            </label>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.gomoku-settings-panel {
  border-radius: 1rem;
  border-width: 1px;
  border-style: solid;
}

.gomoku-settings-panel--light {
  background: rgb(255 255 255 / 0.98);
  border-color: rgb(0 0 0 / 0.1);
  color: #27272a;
}

.gomoku-settings-panel--light .gomoku-settings-label {
  color: #52525b;
}

.gomoku-settings-panel--light .gomoku-settings-checks {
  color: #3f3f46;
}

.gomoku-settings-panel--light .gomoku-settings-close {
  color: #71717a;
}

.gomoku-settings-panel--light .gomoku-settings-close:hover {
  background: rgb(0 0 0 / 0.05);
  color: #27272a;
}

.gomoku-settings-panel--light .gomoku-settings-input {
  border-color: rgb(0 0 0 / 0.12);
  background: rgb(244 244 245);
  color: #18181b;
}

.gomoku-settings-panel--light .gomoku-settings-input:hover {
  border-color: rgb(0 0 0 / 0.2);
}

.gomoku-settings-panel--light .gomoku-settings-input:focus {
  border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
  --tw-ring-color: color-mix(in srgb, var(--color-accent) 25%, transparent);
}

.gomoku-settings-panel--dark {
  background: rgb(26 26 34 / 0.98);
  border-color: rgb(255 255 255 / 0.1);
  color: #e4e4e7;
}

.gomoku-settings-panel--dark .gomoku-settings-label {
  color: #a1a1aa;
}

.gomoku-settings-panel--dark .gomoku-settings-checks {
  color: #d4d4d8;
}

.gomoku-settings-panel--dark .gomoku-settings-close {
  color: #a1a1aa;
}

.gomoku-settings-panel--dark .gomoku-settings-close:hover {
  background: rgb(255 255 255 / 0.08);
  color: #f4f4f5;
}

.gomoku-settings-panel--dark .gomoku-settings-input {
  border-color: rgb(255 255 255 / 0.1);
  background: rgb(0 0 0 / 0.25);
  color: #f4f4f5;
}

.gomoku-settings-panel--dark .gomoku-settings-input:hover {
  border-color: color-mix(in srgb, var(--color-accent) 30%, transparent);
}

.gomoku-settings-panel--dark .gomoku-settings-input:focus {
  border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
  --tw-ring-color: color-mix(in srgb, var(--color-accent) 30%, transparent);
}

.gomoku-settings-panel--light .gomoku-settings-input option {
  background: #fff;
  color: #18181b;
}

.gomoku-settings-panel--dark .gomoku-settings-input option {
  background: #1a1a22;
  color: #f4f4f5;
}
</style>
