<script setup lang="ts">
import { Icon } from "@iconify/vue";

export interface WrongReviewItem {
  questionIndex: number;
  title: string;
  subtitle: string;
  redoDone?: boolean;
  redoDisabled?: boolean;
}

defineProps<{
  items: WrongReviewItem[];
  reviewNote?: string;
}>();

const emit = defineEmits<{
  replay: [questionIndex: number];
  redo: [questionIndex: number];
}>();
</script>

<template>
  <div v-if="items.length" class="space-y-2 border-t border-border/60 pt-3">
    <p class="text-sm font-medium text-zinc-200">错题回顾（{{ items.length }} 题）</p>
    <p v-if="reviewNote" class="text-xs text-zinc-500">{{ reviewNote }}</p>

    <ul class="space-y-2">
      <li
        v-for="item in items"
        :key="`wrong-${item.questionIndex}`"
        class="rounded-lg border border-border/60 bg-black/20 p-2.5"
      >
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <p class="text-sm text-zinc-200">{{ item.title }}</p>
            <p class="mt-0.5 text-xs text-zinc-400">{{ item.subtitle }}</p>
            <p v-if="item.redoDone" class="mt-1 text-xs text-emerald-300">复习重做：已正确</p>
          </div>
          <div class="flex shrink-0 gap-1.5">
            <button
              type="button"
              class="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-zinc-300 transition hover:border-accent/40 hover:text-accent"
              @click="emit('replay', item.questionIndex)"
            >
              <Icon icon="mdi:volume-high" />
              重听
            </button>
            <button
              type="button"
              class="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-zinc-300 transition hover:border-accent/40 hover:text-accent disabled:opacity-40"
              :disabled="item.redoDisabled"
              @click="emit('redo', item.questionIndex)"
            >
              <Icon icon="mdi:refresh" />
              重做
            </button>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
