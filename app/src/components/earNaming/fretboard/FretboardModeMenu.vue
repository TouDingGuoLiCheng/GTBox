<script setup lang="ts">
import { ref } from "vue";
import { Icon } from "@iconify/vue";
import { TRAINING_MODE_LABELS, type TrainingMode } from "../../../types/earNaming";

const emit = defineEmits<{
  start: [mode: TrainingMode];
}>();

const hoveredId = ref<string | null>(null);
const showMore = ref(false);

const cellClass =
  "group ui-card relative flex aspect-[4/3] min-h-[7.5rem] cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-border p-4 outline-none transition-all duration-200 hover:-translate-y-1 hover:border-accent/45 hover:bg-accent/[0.06] hover:shadow-lg hover:shadow-accent/10 focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.98] active:translate-y-0";

const primaryModes: Array<{ id: TrainingMode; icon: string; sub: string }> = [
  { id: "degree-locate", icon: "mdi:numeric", sub: "听 Do 后找级数位置" },
  { id: "solfege-locate", icon: "mdi:music-note", sub: "听唱名后在指板定位" },
];

const moreModes: Array<{ id: TrainingMode; icon: string; sub: string }> = [
  { id: "interval-locate", icon: "mdi:arrow-expand-vertical", sub: "全音 / 半音上下行" },
  { id: "naming-dictation", icon: "mdi:format-list-numbered", sub: "片段逐音命名" },
];
</script>

<template>
  <div class="mx-auto w-full max-w-3xl space-y-4">
    <p class="text-center text-sm text-zinc-500">选择练法 · 推荐从级数定位与唱名找位开始</p>

    <div class="grid grid-cols-2 gap-3 sm:gap-4">
      <button
        v-for="item in primaryModes"
        :key="item.id"
        type="button"
        :class="cellClass"
        @mouseenter="hoveredId = item.id"
        @mouseleave="hoveredId = null"
        @click="emit('start', item.id)"
      >
        <div
          class="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20 transition duration-200 group-hover:scale-110"
          :class="hoveredId === item.id ? 'scale-110' : ''"
        >
          <Icon :icon="item.icon" class="text-2xl" />
        </div>
        <span class="text-center text-sm font-medium text-zinc-200 transition group-hover:text-accent">
          {{ TRAINING_MODE_LABELS[item.id] }}
        </span>
        <span class="text-center text-xs text-zinc-500">{{ item.sub }}</span>
      </button>
    </div>

    <div class="space-y-3">
      <button
        type="button"
        class="mx-auto flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-zinc-400 transition hover:bg-white/5 hover:text-accent"
        @click="showMore = !showMore"
      >
        <Icon :icon="showMore ? 'mdi:chevron-up' : 'mdi:chevron-down'" />
        {{ showMore ? "收起更多练法" : "更多练法" }}
      </button>

      <div v-if="showMore" class="grid grid-cols-2 gap-3 sm:gap-4">
        <button
          v-for="item in moreModes"
          :key="item.id"
          type="button"
          :class="cellClass"
          @mouseenter="hoveredId = item.id"
          @mouseleave="hoveredId = null"
          @click="emit('start', item.id)"
        >
          <div
            class="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-800/80 text-zinc-300 ring-1 ring-border transition duration-200 group-hover:scale-110 group-hover:text-accent"
            :class="hoveredId === item.id ? 'scale-110' : ''"
          >
            <Icon :icon="item.icon" class="text-2xl" />
          </div>
          <span class="text-center text-sm font-medium text-zinc-200 transition group-hover:text-accent">
            {{ TRAINING_MODE_LABELS[item.id] }}
          </span>
          <span class="text-center text-xs text-zinc-500">{{ item.sub }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
