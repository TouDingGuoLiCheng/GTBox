<script setup lang="ts">
import { computed } from "vue";
import { Icon } from "@iconify/vue";
import { storeToRefs } from "pinia";
import { INTERVAL_LABELS } from "../../types/earNaming";
import { useEarNamingStore } from "../../stores/earNaming";
import TrainingStatsPanel from "./TrainingStatsPanel.vue";
import WrongAnswerReview from "./earTraining/WrongAnswerReview.vue";
import { midiToNoteName, toDegreeName, toSolfegeName } from "../../utils/earNaming/fretboard";
import { formatAccuracy, formatResponseMs } from "../../utils/earNaming/stats";

const store = useEarNamingStore();
const {
  trainingPhase,
  currentPrompt,
  lastAnswer,
  correctPoints,
  roundStats,
  questionProgress,
  isPlayingCue,
  isDictationMode,
  dictationIndex,
  dictationNotes,
  dictationLog,
  dictationWrongHint,
  wrongAnswers,
  reviewRedoResults,
} = storeToRefs(store);

const isReviewing = computed(
  () =>
    trainingPhase.value === "review-prompt" || trainingPhase.value === "review-feedback",
);

const wrongReviewItems = computed(() =>
  wrongAnswers.value.map((event) => ({
    questionIndex: event.questionIndex,
    title: `第 ${event.questionIndex} 题 · ${event.promptSummary}`,
    subtitle: event.correct
      ? ""
      : `你的选择：${event.picked.stringNo}弦${event.picked.fret}品`,
    redoDone: store.isReviewRedoCorrect(event.questionIndex),
    redoDisabled: event.mode === "naming-dictation",
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

const promptTitle = computed(() => {
  const prompt = currentPrompt.value;
  if (!prompt) return "点击「开始训练」出题";
  if (prompt.mode === "naming-dictation") {
    const total = dictationNotes.value.length;
    if (trainingPhase.value === "feedback") {
      return `片段完成：共 ${total} 音，请查看命名日志`;
    }
    return `已播放 ${total} 音片段，请逐音命名（第 ${dictationIndex.value + 1}/${total} 音）`;
  }
  if (prompt.mode === "degree-locate") {
    return `已播放 Do 参照，请在指板上找到 ${prompt.targetDegree} 级音`;
  }
  if (prompt.mode === "solfege-locate") {
    return `请在指板上找到唱名 ${prompt.targetSolfege}`;
  }
  const kind = prompt.intervalKind ? INTERVAL_LABELS[prompt.intervalKind] : "";
  const ref = prompt.referencePoint;
  const refLabel = ref ? `${ref.stringNo}弦 ${ref.fret}品` : "参照音";
  return `已播放 ${refLabel}，请找到${kind}的目标音`;
});

const targetLabel = computed(() => {
  if (!currentPrompt.value) return "";
  const midi = currentPrompt.value.targetMidi;
  const doMidi = currentPrompt.value.doMidi;
  return `${midiToNoteName(midi)} · ${toSolfegeName(midi, doMidi)} · ${toDegreeName(midi, doMidi)}级`;
});

const correctPositionsText = computed(() =>
  correctPoints.value.map((p) => `${p.stringNo}弦${p.fret}品`).join("、"),
);
</script>

<template>
  <aside
    class="training-feedback flex min-h-[180px] flex-col gap-3 rounded-xl border border-border bg-black/20 p-3 text-sm"
  >
    <div>
      <p class="text-xs text-zinc-500">
        第 {{ questionProgress.current }} / {{ questionProgress.total }} 题
        <span v-if="isPlayingCue" class="ml-2 text-accent">播放提示音…</span>
      </p>
      <p class="mt-1 text-zinc-200">{{ promptTitle }}</p>
    </div>

    <div v-if="isDictationMode && trainingPhase === 'prompt'" class="space-y-2">
      <button
        type="button"
        class="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-white/5"
        @click="store.playDictationCurrentNote()"
      >
        <Icon icon="mdi:volume-high" />
        重听当前音
      </button>
      <p
        v-if="dictationWrongHint"
        class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-1.5 text-xs text-rose-200"
      >
        {{ dictationWrongHint }}
      </p>
      <ul v-if="dictationLog.length" class="space-y-1 text-xs text-zinc-400">
        <li v-for="note in dictationLog" :key="`named-${note.noteIndex}`">
          第{{ note.noteIndex }}音：{{ note.solfege }} · {{ note.picked.stringNo }}弦{{ note.picked.fret }}品
        </li>
      </ul>
      <p class="text-xs text-zinc-500">未正确命名当前音前，不能进入下一音</p>
    </div>

    <div
      v-if="(trainingPhase === 'feedback' || trainingPhase === 'review-feedback') && lastAnswer && !isDictationMode"
      class="rounded-lg border p-3"
      :class="lastAnswer.correct ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-rose-500/40 bg-rose-500/10'"
    >
      <p v-if="isReviewing" class="mb-2 text-xs text-amber-300/90">错题复习（不计入本轮统计）</p>
      <p class="font-medium" :class="lastAnswer.correct ? 'text-emerald-300' : 'text-rose-300'">
        {{ lastAnswer.correct ? "正确" : "错误" }}
      </p>
      <p class="mt-1 text-zinc-300">
        你的选择：{{ lastAnswer.picked.stringNo }}弦 {{ lastAnswer.picked.fret }}品（{{
          lastAnswer.picked.noteName
        }}）
      </p>
      <p class="mt-1 text-zinc-400">耗时：{{ formatResponseMs(lastAnswer.responseMs) }}</p>
      <p v-if="!lastAnswer.correct" class="mt-2 text-zinc-300">正确答案：{{ targetLabel }}</p>
      <p v-if="correctPoints.length" class="mt-1 text-xs text-emerald-300/90">
        可用位置：{{ correctPositionsText }}
      </p>
      <button
        type="button"
        class="mt-3 w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-black transition hover:brightness-110"
        @click="store.continueAfterFeedback()"
      >
        {{ isReviewing ? "返回错题列表" : "下一题" }}
      </button>
    </div>

    <div
      v-else-if="trainingPhase === 'feedback' && lastAnswer?.dictationDetails"
      class="space-y-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3"
    >
      <p class="font-medium text-emerald-300">片段命名完成</p>
      <ul class="space-y-1 text-xs text-zinc-300">
        <li v-for="note in lastAnswer.dictationDetails" :key="`log-${note.noteIndex}`">
          第{{ note.noteIndex }}音：{{ note.solfege }} · {{ note.degreeLabel }}级 ·
          {{ note.picked.stringNo }}弦{{ note.picked.fret }}品
          <span v-if="note.attempts > 1" class="text-zinc-500">（{{ note.attempts }} 次）</span>
        </li>
      </ul>
      <p class="text-xs text-zinc-400">总耗时 {{ formatResponseMs(lastAnswer.responseMs) }}</p>
      <button
        type="button"
        class="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-black transition hover:brightness-110"
        @click="store.continueAfterFeedback()"
      >
        下一题
      </button>
    </div>

    <div v-else-if="trainingPhase === 'prompt' && !isDictationMode && !isReviewing" class="text-xs text-zinc-500">
      点击指板作答（点击会发声）
    </div>
    <div v-else-if="trainingPhase === 'review-prompt'" class="text-xs text-amber-300/90">
      错题复习：点击指板重新作答
    </div>

    <div v-else-if="trainingPhase === 'round-complete'" class="space-y-2">
      <p class="font-medium text-accent">本轮完成</p>
      <p class="text-zinc-300">
        正确率 {{ formatAccuracy(roundStats.accuracy) }}（{{ roundStats.correct }}/{{ roundStats.total }}）
      </p>
      <p class="text-zinc-400">平均耗时 {{ formatResponseMs(roundStats.avgResponseMs) }}</p>

      <WrongAnswerReview
        :items="wrongReviewItems"
        review-note="复习重做结果单独记录，不影响上方本轮统计。扒音题仅支持重听。"
        @replay="onReplayWrong"
        @redo="onRedoWrong"
      />

      <p v-if="reviewRedoResults.length" class="text-xs text-zinc-500">
        已复习 {{ reviewRedoResults.filter((r) => r.correct).length }}/{{ reviewRedoResults.length }} 题正确
      </p>

      <button
        type="button"
        class="w-full rounded-lg border border-accent/50 px-3 py-2 text-sm text-accent transition hover:bg-accent/10"
        @click="store.startRound()"
      >
        再来一轮
      </button>
    </div>

    <TrainingStatsPanel class="mt-auto" />
  </aside>
</template>
