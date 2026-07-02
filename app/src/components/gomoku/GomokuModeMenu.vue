<script setup lang="ts">
import { ref } from "vue";
import type { GameMode } from "../../types/gomoku";
import GomokuSettingsDialog from "./GomokuSettingsDialog.vue";
import GomokuStoneIcon from "./GomokuStoneIcon.vue";

const emit = defineEmits<{
  start: [mode: GameMode];
  lan: [];
}>();

const settingsOpen = ref(false);
const hoveredId = ref<string | null>(null);

const modes: Array<{ id: "pvc" | "pvp" | "cvc"; label: string; sub: string }> = [
  { id: "pvc", label: "人机对弈", sub: "挑战电脑" },
  { id: "pvp", label: "双人对弈", sub: "同屏轮流" },
  { id: "cvc", label: "机机观战", sub: "自动对局" },
];

const cellClass =
  "group ui-card relative flex aspect-[4/3] min-h-[7.5rem] cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-border p-4 outline-none transition-all duration-200 hover:-translate-y-1 hover:border-accent/45 hover:bg-accent/[0.06] hover:shadow-lg hover:shadow-accent/10 focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.98] active:translate-y-0";
</script>

<template>
  <div class="mx-auto grid w-full max-w-3xl grid-cols-3 gap-3 sm:gap-4">
    <button
      type="button"
      :class="cellClass"
      @mouseenter="hoveredId = 'settings'"
      @mouseleave="hoveredId = null"
      @click="settingsOpen = true"
    >
      <div
        class="transition duration-200 group-hover:scale-110"
        :class="hoveredId === 'settings' ? 'scale-110' : ''"
      >
        <GomokuStoneIcon mode="settings" :size="56" />
      </div>
      <span class="text-sm font-medium text-zinc-200 transition group-hover:text-accent">
        设置
      </span>
      <span class="text-xs text-zinc-500">模式 / 计时 / 音效</span>
      <span
        class="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 scale-x-0 bg-accent/60 transition duration-200 group-hover:scale-x-100"
      />
    </button>

    <button
      v-for="item in modes"
      :key="item.id"
      type="button"
      :class="cellClass"
      @mouseenter="hoveredId = item.id"
      @mouseleave="hoveredId = null"
      @click="emit('start', item.id)"
    >
      <div
        class="transition duration-200 group-hover:scale-110"
        :class="hoveredId === item.id ? 'scale-110' : ''"
      >
        <GomokuStoneIcon :mode="item.id" :size="56" />
      </div>
      <span class="text-sm font-medium text-zinc-200 transition group-hover:text-accent">
        {{ item.label }}
      </span>
      <span class="text-xs text-zinc-500">{{ item.sub }}</span>
      <span
        class="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 scale-x-0 bg-accent/60 transition duration-200 group-hover:scale-x-100"
      />
    </button>

    <button
      type="button"
      :class="cellClass"
      @mouseenter="hoveredId = 'lan'"
      @mouseleave="hoveredId = null"
      @click="emit('lan')"
    >
      <div
        class="transition duration-200 group-hover:scale-110"
        :class="hoveredId === 'lan' ? 'scale-110' : ''"
      >
        <GomokuStoneIcon mode="lan" :size="56" />
      </div>
      <span class="text-sm font-medium text-zinc-200 transition group-hover:text-accent">
        局域网联机
      </span>
      <span class="text-xs text-zinc-500">同 WiFi 对战</span>
      <span
        class="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 scale-x-0 bg-accent/60 transition duration-200 group-hover:scale-x-100"
      />
    </button>

    <div
      class="hidden aspect-[4/3] min-h-[7.5rem] rounded-2xl border border-dashed border-border/30 sm:block"
      aria-hidden="true"
    />
  </div>

  <GomokuSettingsDialog v-model="settingsOpen" />
</template>
