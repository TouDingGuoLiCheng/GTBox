<script setup lang="ts">
import { ref } from "vue";
import { Icon } from "@iconify/vue";
import type { EarNamingPhase } from "../../types/earNaming";

const emit = defineEmits<{
  select: [phase: EarNamingPhase];
}>();

const hoveredId = ref<string | null>(null);

const cellClass =
  "group ui-card relative flex aspect-[4/3] min-h-[7.5rem] cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-border p-4 outline-none transition-all duration-200 hover:-translate-y-1 hover:border-accent/45 hover:bg-accent/[0.06] hover:shadow-lg hover:shadow-accent/10 focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.98] active:translate-y-0";

const cards: Array<{
  id: EarNamingPhase;
  icon: string;
  label: string;
  sub: string;
}> = [
  { id: "explore", icon: "mdi:guitar-electric", label: "自由探索", sub: "点击指板发声 · 看标签" },
  { id: "ear-training", icon: "mdi:ear-hearing", label: "听力训练", sub: "听音选唱名" },
  { id: "ear-exam", icon: "mdi:clipboard-check-outline", label: "听力考试", sub: "测评 · 考完出分" },
  { id: "fretboard-memory", icon: "mdi:grid", label: "记忆指板", sub: "唱名 / 级数找位置" },
  { id: "settings", icon: "mdi:cog-outline", label: "设置", sub: "各模块独立配置" },
];
</script>

<template>
  <div class="mx-auto grid w-full max-w-3xl grid-cols-2 gap-3 sm:gap-4">
    <button
      v-for="item in cards"
      :key="item.id"
      type="button"
      :class="cellClass"
      @mouseenter="hoveredId = item.id"
      @mouseleave="hoveredId = null"
      @click="emit('select', item.id)"
    >
      <div
        class="flex h-14 w-14 items-center justify-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20 transition duration-200 group-hover:scale-110"
        :class="hoveredId === item.id ? 'scale-110' : ''"
      >
        <Icon :icon="item.icon" class="text-3xl" />
      </div>
      <span class="text-sm font-medium text-zinc-200 transition group-hover:text-accent">
        {{ item.label }}
      </span>
      <span class="text-center text-xs text-zinc-500">{{ item.sub }}</span>
      <span
        class="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 scale-x-0 bg-accent/60 transition duration-200 group-hover:scale-x-100"
      />
    </button>
  </div>
</template>
