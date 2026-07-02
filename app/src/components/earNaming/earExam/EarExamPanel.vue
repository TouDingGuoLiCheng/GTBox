<script setup lang="ts">
import { computed } from "vue";
import { Icon } from "@iconify/vue";
import { storeToRefs } from "pinia";
import { useEarNamingEarExamStore } from "../../../stores/earNamingEarExam";
import { usesChromaticAnswers } from "../../../utils/earNaming/earTrainingDifficulty";
import SolfegeAnswerPad from "../earTraining/SolfegeAnswerPad.vue";

const store = useEarNamingEarExamStore();
const {
  examPlan,
  inProgressSubPhase,
  isPlayingCue,
  showDoUpdatedHint,
  timerRemainingSec,
  timeLimitSec,
  questionProgress,
} = storeToRefs(store);

const enabledSolfege = computed(() => examPlan.value?.enabledSolfege ?? []);

const canAnswer = computed(
  () => inProgressSubPhase.value === "answering" && !isPlayingCue.value,
);

const timerToneClass = computed(() => {
  if (timerRemainingSec.value === null) return "text-zinc-400";
  if (timerRemainingSec.value <= 5) return "text-red-400";
  if (timerRemainingSec.value <= 8) return "text-amber-300";
  return "text-zinc-300";
});
</script>

<template>
  <div class="mx-auto flex w-full max-w-lg flex-col gap-4">
    <div class="flex items-center gap-3 rounded-xl border border-border bg-black/20 px-4 py-3">
      <span class="text-sm text-zinc-300">
        第 {{ questionProgress.current }}/{{ questionProgress.total }} 题
      </span>
      <span
        v-if="timeLimitSec !== null && timerRemainingSec !== null"
        class="ml-auto flex items-center gap-1.5 text-sm tabular-nums"
        :class="timerToneClass"
      >
        <Icon icon="mdi:timer-outline" />
        {{ timerRemainingSec }}s
      </span>
    </div>

    <Transition name="fade">
      <p
        v-if="showDoUpdatedHint"
        class="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-center text-sm text-accent"
      >
        参照音已更新
      </p>
    </Transition>

    <section class="rounded-xl border border-border bg-black/20 p-4">
      <h3 class="mb-3 text-center text-sm text-zinc-400">选择你听到的唱名</h3>
      <SolfegeAnswerPad
        :enabled-solfege="enabledSolfege"
        :disabled="!canAnswer"
        @pick="store.submitAnswer($event)"
      />
      <p v-if="usesChromaticAnswers(examPlan?.difficulty ?? 'beginner')" class="mt-3 text-center text-xs text-zinc-500">
        含变化音唱名
      </p>
    </section>

    <p class="text-center text-xs text-zinc-500">
      {{ isPlayingCue ? "正在播放…" : canAnswer ? "作答中" : "请听音" }}
    </p>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
