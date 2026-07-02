<script setup lang="ts">
import { computed } from "vue";
import { Icon } from "@iconify/vue";
import { storeToRefs } from "pinia";
import { useEarNamingEarTrainingStore } from "../../../stores/earNamingEarTraining";
import WrongAnswerReview from "./WrongAnswerReview.vue";

const store = useEarNamingEarTrainingStore();
const {
  trainingPhase,
  currentPrompt,
  lastAnswer,
  roundStats,
  questionProgress,
  isPlayingCue,
  useDoReference,
  wrongAnswers,
  reviewRedoResults,
  revealedSolfege,
} = storeToRefs(store);

const canAnswer = computed(
  () =>
    (trainingPhase.value === "prompt" || trainingPhase.value === "review-prompt") &&
    !isPlayingCue.value,
);

const showFeedback = computed(
  () =>
    (trainingPhase.value === "feedback" || trainingPhase.value === "review-feedback") &&
    lastAnswer.value,
);

const showRoundComplete = computed(() => trainingPhase.value === "round-complete");

const isReviewing = computed(
  () =>
    trainingPhase.value === "review-prompt" || trainingPhase.value === "review-feedback",
);

const accuracyText = computed(() => `${Math.round(roundStats.value.accuracy * 100)}%`);

const wrongReviewItems = computed(() =>
  wrongAnswers.value.map((event) => ({
    questionIndex: event.questionIndex,
    title: `第 ${event.questionIndex} 题`,
    subtitle: `你选 ${event.pickedSolfege}，正确 ${event.targetSolfege} · ${event.targetNoteName}`,
    redoDone: store.isReviewRedoCorrect(event.questionIndex),
  })),
);

function onReplayWrong(questionIndex: number) {
  const event = wrongAnswers.value.find((e) => e.questionIndex === questionIndex);
  if (event) void store.replayWrongAnswer(event);
}

function onRedoWrong(questionIndex: number) {
  const event = wrongAnswers.value.find((e) => e.questionIndex === questionIndex);
  if (event) store.startWrongRedo(event);
}
</script>

<template>
  <section class="space-y-3 rounded-xl border border-border bg-black/20 p-4">
    <div class="flex flex-wrap items-center gap-2 text-sm">
      <span class="text-zinc-400">
        第 {{ questionProgress.current }} / {{ questionProgress.total }} 题
      </span>
      <span
        v-if="isPlayingCue"
        class="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent"
      >
        播放中…
      </span>
      <span v-else-if="trainingPhase === 'prompt'" class="text-xs text-zinc-500">
        听音后选择唱名
      </span>
    </div>

    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-zinc-300 transition hover:border-accent/40 hover:text-accent disabled:opacity-40"
        :disabled="!currentPrompt || isPlayingCue"
        @click="store.replayTarget()"
      >
        <Icon icon="mdi:replay" />
        重播本题
      </button>
      <button
        v-if="useDoReference"
        type="button"
        class="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-zinc-300 transition hover:border-accent/40 hover:text-accent disabled:opacity-40"
        :disabled="!currentPrompt || isPlayingCue"
        @click="store.replayDo()"
      >
        <Icon icon="mdi:music-note" />
        重播 Do
      </button>
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-zinc-300 transition hover:border-accent/40 hover:text-accent disabled:opacity-40"
        :disabled="!currentPrompt"
        @click="store.revealAnswer()"
      >
        <Icon icon="mdi:eye-outline" />
        查看答案
      </button>
    </div>

    <p
      v-if="revealedSolfege && currentPrompt"
      class="rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200"
    >
      答案：{{ revealedSolfege }} · {{ currentPrompt.targetNoteName }}
    </p>

    <div
      v-if="showFeedback && lastAnswer"
      class="rounded-lg border p-3"
      :class="lastAnswer.correct ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-rose-500/40 bg-rose-500/10'"
    >
      <p v-if="isReviewing" class="mb-2 text-xs text-amber-300/90">错题复习（不计入本轮统计）</p>
      <p class="text-sm font-medium" :class="lastAnswer.correct ? 'text-emerald-300' : 'text-rose-300'">
        {{ lastAnswer.correct ? "正确" : "错误" }}
        <span v-if="!lastAnswer.correct" class="font-normal text-zinc-400">
          · 你选了 {{ lastAnswer.pickedSolfege }}
        </span>
      </p>
      <p class="mt-1 text-sm text-zinc-200">
        {{ lastAnswer.targetSolfege }} · {{ lastAnswer.targetNoteName }}
      </p>
      <button
        type="button"
        class="mt-3 flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-black transition hover:brightness-110"
        @click="store.continueAfterFeedback()"
      >
        {{ isReviewing ? "返回错题列表" : "下一题" }}
        <kbd
          class="inline-flex min-w-[2.75rem] items-center justify-center rounded border border-black/20 bg-black/10 px-2 py-0.5 text-xs font-normal tracking-wide"
          aria-label="空格键"
        >空格</kbd>
        <Icon icon="mdi:arrow-right" />
      </button>
    </div>

    <div v-else-if="showRoundComplete" class="space-y-3 rounded-lg border border-border/60 bg-black/25 p-3">
      <p class="text-sm font-medium text-zinc-100">本轮完成</p>
      <p class="text-sm text-zinc-400">
        正确率 {{ accuracyText }}（{{ roundStats.correct }}/{{ roundStats.total }}）
        · 平均 {{ roundStats.avgResponseMs }} ms
      </p>
      <ul v-if="roundStats.weaknessHints.length" class="space-y-1 text-xs text-amber-300/90">
        <li v-for="hint in roundStats.weaknessHints" :key="hint">{{ hint }}</li>
      </ul>

      <WrongAnswerReview
        :items="wrongReviewItems"
        review-note="复习重做结果单独记录，不影响上方本轮统计。"
        @replay="onReplayWrong"
        @redo="onRedoWrong"
      />

      <p v-if="reviewRedoResults.length" class="text-xs text-zinc-500">
        已复习 {{ reviewRedoResults.filter((r) => r.correct).length }}/{{ reviewRedoResults.length }} 题正确
      </p>
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-black transition hover:brightness-110"
        @click="store.startRound()"
      >
        <Icon icon="mdi:refresh" />
        再练一轮
      </button>
    </div>

    <p v-else-if="trainingPhase === 'idle'" class="text-sm text-zinc-500">
      点击「开始训练」播放题目
    </p>
    <p v-else-if="trainingPhase === 'prompt' && !canAnswer" class="text-xs text-zinc-500">
      请听完再作答
    </p>
  </section>
</template>
