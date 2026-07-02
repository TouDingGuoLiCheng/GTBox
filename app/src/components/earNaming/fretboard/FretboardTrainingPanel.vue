<script setup lang="ts">
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import GuitarFretboard from "../GuitarFretboard.vue";
import TrainingFeedback from "../TrainingFeedback.vue";
import TrainingHeader from "../TrainingHeader.vue";
import { useEarNamingStore } from "../../../stores/earNaming";
import type { FretPoint } from "../../../utils/earNaming/fretboard";
import { getEarNamingAudioStatus, playEarNamingMidi } from "../../../utils/earNaming/sampler";

const store = useEarNamingStore();
const {
  trainingPhase,
  lastAnswer,
  currentPrompt,
  doMidi,
  enabledStrings,
  maxFret,
} = storeToRefs(store);

const audioStatus = ref(getEarNamingAudioStatus());
const isPlaying = ref(false);

const boardSelectedMidi = computed(() => {
  if (
    (trainingPhase.value === "feedback" || trainingPhase.value === "review-feedback") &&
    lastAnswer.value
  ) {
    return lastAnswer.value.picked.midi;
  }
  return null;
});

const boardPickedMidi = computed(() =>
  (trainingPhase.value === "feedback" || trainingPhase.value === "review-feedback") &&
  lastAnswer.value
    ? lastAnswer.value.picked.midi
    : null,
);

const boardTargetMidi = computed(() =>
  (trainingPhase.value === "feedback" || trainingPhase.value === "review-feedback") &&
  currentPrompt.value
    ? currentPrompt.value.targetMidi
    : null,
);

const showAnswerFeedback = computed(
  () => trainingPhase.value === "feedback" || trainingPhase.value === "review-feedback",
);

function refreshAudioStatus() {
  audioStatus.value = getEarNamingAudioStatus();
}

async function onPick(point: FretPoint) {
  if (trainingPhase.value === "prompt" || trainingPhase.value === "review-prompt") {
    await store.submitAnswer(point);
    return;
  }
  if (
    trainingPhase.value === "feedback" ||
    trainingPhase.value === "review-feedback" ||
    trainingPhase.value === "idle"
  ) {
    isPlaying.value = true;
    await playEarNamingMidi(point.midi);
    refreshAudioStatus();
    window.setTimeout(() => {
      isPlaying.value = false;
    }, 120);
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3">
    <TrainingHeader class="shrink-0" />

    <div class="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div class="min-h-0">
        <GuitarFretboard
          :max-fret="maxFret"
          :do-midi="doMidi"
          :enabled-strings="enabledStrings"
          :selected-midi="boardSelectedMidi"
          :show-enharmonic="false"
          variant="training"
          :picked-midi="boardPickedMidi"
          :target-midi="boardTargetMidi"
          :show-answer-feedback="showAnswerFeedback"
          @pick="onPick"
        />
      </div>
      <TrainingFeedback class="min-h-0 overflow-y-auto" />
    </div>

    <p v-if="audioStatus.sampleReady" class="shrink-0 text-xs text-zinc-500">
      音色：{{ audioStatus.sourceLabel }}
    </p>
    <p v-else-if="audioStatus.sampleFailed" class="shrink-0 text-xs text-amber-300">
      内置采样加载失败，已回退合成音。
    </p>
  </div>
</template>
