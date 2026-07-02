<script setup lang="ts">
import { computed } from "vue";
import { Icon } from "@iconify/vue";
import { storeToRefs } from "pinia";
import {
  EAR_EXAM_PASS_COUNT,
  EAR_EXAM_TOTAL_QUESTIONS,
} from "../../../types/earNaming";
import { useEarNamingEarExamStore } from "../../../stores/earNamingEarExam";
import SolfegeAnswerPad from "../earTraining/SolfegeAnswerPad.vue";
import WrongAnswerReview, { type WrongReviewItem } from "../earTraining/WrongAnswerReview.vue";

const store = useEarNamingEarExamStore();
const {
  examPlan,
  examScore,
  examStats,
  examDurationMs,
  difficultyLabel,
  wrongAnswers,
  reviewPhase,
  reviewPrompt,
  reviewRedoResults,
  isPlayingCue,
} = storeToRefs(store);

const enabledSolfege = computed(() => examPlan.value?.enabledSolfege ?? []);

const accuracyText = computed(() => `${Math.round(examScore.value.accuracy * 100)}%`);

const durationText = computed(() => {
  const ms = examDurationMs.value;
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
});

const solfegeStats = computed(() =>
  Object.entries(examStats.value.bySolfege)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, stat]) => ({ name, ...stat })),
);

function formatPickedAnswer(event: (typeof wrongAnswers.value)[number]): string {
  if (event.timedOut) return "超时未答";
  if (!event.pickedSolfege) return "未答";
  return event.pickedSolfege;
}

const wrongReviewItems = computed<WrongReviewItem[]>(() =>
  wrongAnswers.value.map((event) => ({
    questionIndex: event.questionIndex,
    title: `第 ${event.questionIndex} 题`,
    subtitle: `你选 ${formatPickedAnswer(event)}，正确 ${event.targetSolfege} · ${event.targetNoteName}`,
    redoDone: store.isReviewRedoCorrect(event.questionIndex),
    redoDisabled: reviewPhase.value !== "idle",
  })),
);

const canReviewAnswer = computed(
  () => reviewPhase.value === "redo-prompt" && !isPlayingCue.value,
);

const lastReviewCorrect = computed(() => {
  if (reviewPhase.value !== "redo-feedback" || !reviewPrompt.value) return null;
  const index = reviewPrompt.value.questionIndex;
  const result = reviewRedoResults.value.find((item) => item.questionIndex === index);
  return result?.correct ?? null;
});

function onReplayWrong(questionIndex: number) {
  const event = wrongAnswers.value.find((item) => item.questionIndex === questionIndex);
  if (event) void store.replayWrongAnswer(event);
}

function onRedoWrong(questionIndex: number) {
  const event = wrongAnswers.value.find((item) => item.questionIndex === questionIndex);
  if (event) void store.startWrongRedo(event);
}
</script>

<template>
  <div class="mx-auto w-full max-w-lg space-y-4">
    <div class="text-center">
      <Icon
        :icon="examScore.passed ? 'mdi:check-circle' : 'mdi:close-circle'"
        class="mx-auto text-5xl"
        :class="examScore.passed ? 'text-emerald-400' : 'text-amber-400'"
      />
      <h2 class="mt-3 text-lg font-medium text-zinc-200">成绩报告</h2>
      <p class="mt-1 text-sm text-zinc-500">{{ difficultyLabel }}</p>
    </div>

    <div class="grid grid-cols-2 gap-3 text-sm">
      <div class="rounded-xl border border-border bg-black/20 p-3">
        <p class="text-xs text-zinc-500">得分</p>
        <p class="mt-1 text-2xl font-semibold tabular-nums text-zinc-100">
          {{ examScore.correct }}/{{ examScore.total }}
        </p>
        <p class="mt-0.5 text-xs" :class="examScore.passed ? 'text-emerald-300' : 'text-amber-300'">
          {{ examScore.passed ? "通过" : "未通过" }}
          · ≥ {{ EAR_EXAM_PASS_COUNT }}/{{ EAR_EXAM_TOTAL_QUESTIONS }}
        </p>
      </div>
      <div class="rounded-xl border border-border bg-black/20 p-3">
        <p class="text-xs text-zinc-500">正确率</p>
        <p class="mt-1 text-2xl font-semibold tabular-nums text-zinc-100">{{ accuracyText }}</p>
        <p class="mt-0.5 text-xs text-zinc-400">平均 {{ examScore.avgResponseMs }} ms</p>
      </div>
      <div class="col-span-2 rounded-xl border border-border bg-black/20 p-3">
        <p class="text-xs text-zinc-500">用时</p>
        <p class="mt-1 text-lg tabular-nums text-zinc-200">{{ durationText }}</p>
      </div>
    </div>

    <section v-if="solfegeStats.length" class="rounded-xl border border-border bg-black/20 p-3">
      <p class="mb-2 text-sm font-medium text-zinc-200">按唱名</p>
      <ul class="flex flex-wrap gap-2">
        <li
          v-for="item in solfegeStats"
          :key="item.name"
          class="rounded-lg border border-border/60 bg-black/25 px-2.5 py-1 text-xs text-zinc-300"
        >
          {{ item.name }} {{ item.correct }}/{{ item.total }}
        </li>
      </ul>
    </section>

    <section class="rounded-xl border border-border bg-black/20 p-4">
      <WrongAnswerReview
        :items="wrongReviewItems"
        review-note="重听与重做不计入本次成绩。"
        @replay="onReplayWrong"
        @redo="onRedoWrong"
      />
      <p v-if="!wrongReviewItems.length" class="text-center text-sm text-zinc-500">全部正确</p>
    </section>

    <section
      v-if="reviewPhase === 'redo-prompt' || reviewPhase === 'redo-feedback'"
      class="rounded-xl border border-accent/30 bg-accent/5 p-4"
    >
      <p class="mb-3 text-center text-sm text-zinc-400">
        错题重做 · 第 {{ reviewPrompt?.questionIndex }} 题
      </p>

      <div
        v-if="reviewPhase === 'redo-feedback' && lastReviewCorrect !== null"
        class="mb-3 rounded-lg border p-3"
        :class="lastReviewCorrect ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-rose-500/40 bg-rose-500/10'"
      >
        <p class="text-sm" :class="lastReviewCorrect ? 'text-emerald-300' : 'text-rose-300'">
          {{ lastReviewCorrect ? "正确" : "错误" }}
          <span v-if="!lastReviewCorrect && reviewPrompt" class="text-zinc-400">
            · 应为 {{ reviewPrompt.targetSolfege }} · {{ reviewPrompt.targetNoteName }}
          </span>
        </p>
        <button
          type="button"
          class="mt-3 flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-zinc-300 transition hover:border-accent/40 hover:text-accent"
          @click="store.finishReviewRedo()"
        >
          返回错题列表
        </button>
      </div>

      <template v-else>
        <SolfegeAnswerPad
          :enabled-solfege="enabledSolfege"
          :disabled="!canReviewAnswer"
          @pick="store.submitReviewAnswer($event)"
        />
        <p class="mt-2 text-center text-xs text-zinc-500">
          {{ isPlayingCue ? "正在播放…" : "不计入卷面分数" }}
        </p>
      </template>
    </section>

    <div class="flex flex-wrap justify-center gap-3 pt-1">
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm text-zinc-400 transition hover:border-accent/40 hover:text-accent"
        title="历史记录"
        @click="store.openHistory()"
      >
        <Icon icon="mdi:history" />
        历史记录
      </button>
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm text-zinc-400 transition hover:border-accent/40 hover:text-accent"
        title="返回选级"
        @click="store.backToLevelSelect()"
      >
        <Icon icon="mdi:arrow-left" />
        返回选级
      </button>
    </div>
  </div>
</template>
