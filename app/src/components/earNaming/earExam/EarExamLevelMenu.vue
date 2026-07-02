<script setup lang="ts">
import { ref } from "vue";
import { Icon } from "@iconify/vue";
import { storeToRefs } from "pinia";
import {
  EAR_EXAM_DO_STRATEGY_LABELS,
  EAR_EXAM_PASS_COUNT,
  EAR_EXAM_TIME_LIMIT_SEC,
  EAR_EXAM_TOTAL_QUESTIONS,
  EAR_TRAINING_DIFFICULTY_LABELS,
  type EarTrainingDifficulty,
} from "../../../types/earNaming";
import { useEarNamingEarExamStore } from "../../../stores/earNamingEarExam";

const store = useEarNamingEarExamStore();
const { examPhase, selectedDifficulty } = storeToRefs(store);

const hoveredId = ref<string | null>(null);

const cellClass =
  "group ui-card relative flex aspect-[4/3] min-h-[7.5rem] cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-border p-4 outline-none transition-all duration-200 hover:-translate-y-1 hover:border-accent/45 hover:bg-accent/[0.06] hover:shadow-lg hover:shadow-accent/10 focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.98] active:translate-y-0";

const levels: Array<{
  id: EarTrainingDifficulty;
  icon: string;
  sub: string;
}> = [
  { id: "beginner", icon: "mdi:seedling", sub: "自然音 · 无限时" },
  { id: "intermediate", icon: "mdi:trending-up", sub: "含变化音 · 单题 20 秒" },
  { id: "advanced", icon: "mdi:lightning-bolt", sub: "全音域 · 单题 15 秒" },
];

function timeLimitLabel(difficulty: EarTrainingDifficulty): string {
  const sec = EAR_EXAM_TIME_LIMIT_SEC[difficulty];
  return sec === null ? "无单题限时" : `单题 ${sec} 秒（播完后计时）`;
}
</script>

<template>
  <div v-if="examPhase === 'level-select'" class="mx-auto w-full max-w-3xl space-y-4">
    <p class="text-center text-sm text-zinc-500">选择考试难度</p>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
      <button
        v-for="item in levels"
        :key="item.id"
        type="button"
        :class="cellClass"
        @mouseenter="hoveredId = item.id"
        @mouseleave="hoveredId = null"
        @click="store.selectLevel(item.id)"
      >
        <div
          class="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20 transition duration-200 group-hover:scale-110"
          :class="hoveredId === item.id ? 'scale-110' : ''"
        >
          <Icon :icon="item.icon" class="text-2xl" />
        </div>
        <span class="text-center text-sm font-medium text-zinc-200 transition group-hover:text-accent">
          {{ EAR_TRAINING_DIFFICULTY_LABELS[item.id] }}
        </span>
        <span class="text-center text-xs text-zinc-500">{{ item.sub }}</span>
      </button>
    </div>

    <div class="flex justify-center pt-2">
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm text-zinc-400 transition hover:border-accent/40 hover:text-accent"
        title="历史记录"
        @click="store.openHistory()"
      >
        <Icon icon="mdi:history" />
        历史记录
        <span v-if="store.historyRecords.length" class="text-xs text-zinc-500">
          （{{ store.historyRecords.length }}）
        </span>
      </button>
    </div>
  </div>

  <div
    v-else-if="examPhase === 'briefing' && selectedDifficulty"
    class="mx-auto w-full max-w-lg space-y-5"
  >
    <div class="text-center">
      <h2 class="text-lg font-medium text-zinc-200">
        {{ EAR_TRAINING_DIFFICULTY_LABELS[selectedDifficulty] }} · 考试说明
      </h2>
      <p class="mt-1 text-sm text-zinc-500">纯听测评，考完出分</p>
    </div>

    <ul class="space-y-2.5 rounded-xl border border-border bg-black/20 p-4 text-sm text-zinc-300">
      <li class="flex gap-2">
        <Icon icon="mdi:format-list-numbered" class="mt-0.5 shrink-0 text-accent" />
        <span>共 {{ EAR_EXAM_TOTAL_QUESTIONS }} 题，随机出题</span>
      </li>
      <li class="flex gap-2">
        <Icon icon="mdi:check-circle-outline" class="mt-0.5 shrink-0 text-accent" />
        <span>正确 ≥ {{ EAR_EXAM_PASS_COUNT }}/{{ EAR_EXAM_TOTAL_QUESTIONS }}（90%）即通过</span>
      </li>
      <li class="flex gap-2">
        <Icon icon="mdi:timer-outline" class="mt-0.5 shrink-0 text-accent" />
        <span>{{ timeLimitLabel(selectedDifficulty) }}</span>
      </li>
      <li class="flex gap-2">
        <Icon icon="mdi:music-note" class="mt-0.5 shrink-0 text-accent" />
        <span>参照 Do 由系统指定：{{ EAR_EXAM_DO_STRATEGY_LABELS[selectedDifficulty] }}</span>
      </li>
      <li class="flex gap-2">
        <Icon icon="mdi:volume-high" class="mt-0.5 shrink-0 text-accent" />
        <span>每题先播 Do，再播目标音</span>
      </li>
      <li class="flex gap-2">
        <Icon icon="mdi:eye-off-outline" class="mt-0.5 shrink-0 text-accent" />
        <span>考中不显示对错，全部做完后公布成绩</span>
      </li>
    </ul>

    <div class="flex flex-wrap items-center justify-center gap-3">
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm text-zinc-400 transition hover:border-accent/40 hover:text-accent"
        title="重选难度"
        @click="store.backToLevelSelect()"
      >
        <Icon icon="mdi:swap-horizontal" />
        重选难度
      </button>
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-lg bg-accent px-5 py-2 text-sm font-medium text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="!store.canStartExam"
        title="开始考试"
        @click="store.startExam()"
      >
        <Icon icon="mdi:play" />
        开始考试
      </button>
    </div>
    <p v-if="!store.canStartExam" class="text-center text-xs text-amber-300/90">
      当前难度无法生成有效题目，请稍后重试。
    </p>
  </div>
</template>
