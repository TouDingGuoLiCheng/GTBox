<script setup lang="ts">
import { Icon } from "@iconify/vue";
import { storeToRefs } from "pinia";
import { onBeforeUnmount, onMounted } from "vue";
import { useRouter } from "vue-router";
import EarExamModule from "../components/earNaming/earExam/EarExamModule.vue";
import EarNamingModeMenu from "../components/earNaming/EarNamingModeMenu.vue";
import EarNamingSettingsHub from "../components/earNaming/EarNamingSettingsHub.vue";
import EarTrainingPanel from "../components/earNaming/earTraining/EarTrainingPanel.vue";
import ExplorePanel from "../components/earNaming/ExplorePanel.vue";
import FretboardMemoryPanel from "../components/earNaming/FretboardMemoryPanel.vue";
import { useEarNamingStore } from "../stores/earNaming";
import { useEarNamingEarExamStore } from "../stores/earNamingEarExam";
import { useEarNamingEarTrainingStore } from "../stores/earNamingEarTraining";
import type { EarNamingPhase } from "../types/earNaming";
import { getEarNamingAudioStatus, unlockEarNamingAudio } from "../utils/earNaming/sampler";

const btnGhostClass =
  "rounded-lg px-3 py-2 text-sm text-zinc-400 transition duration-200 hover:bg-white/8 hover:text-accent active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

const router = useRouter();
const store = useEarNamingStore();
const earTrainingStore = useEarNamingEarTrainingStore();
const earExamStore = useEarNamingEarExamStore();
const { phase, fretboardSubview } = storeToRefs(store);
const { trainingPhase } = storeToRefs(earTrainingStore);
const { examPhase, reviewPhase } = storeToRefs(earExamStore);

const phaseTitle: Record<EarNamingPhase, string> = {
  menu: "",
  explore: "自由探索",
  "ear-training": "听力训练",
  "ear-exam": "听力考试",
  "fretboard-memory": "记忆指板",
  settings: "设置",
};

function onSelectPhase(next: EarNamingPhase) {
  void unlockEarNamingAudio();
  if (next === "ear-exam") {
    earExamStore.reset();
  }
  store.enterPhase(next);
}

function onBackClick() {
  if (phase.value === "fretboard-memory" && fretboardSubview.value === "training") {
    store.backToFretboardMenu();
    return;
  }
  if (phase.value === "ear-exam") {
    if (examPhase.value === "briefing") {
      earExamStore.backToLevelSelect();
      return;
    }
    if (examPhase.value === "in-progress") {
      if (!earExamStore.requestAbandon()) return;
      earExamStore.reset();
      store.backToMenu();
      return;
    }
    if (examPhase.value === "report") {
      if (reviewPhase.value !== "idle") {
        earExamStore.cancelReviewRedo();
        return;
      }
      earExamStore.backToLevelSelect();
      return;
    }
    if (examPhase.value === "history") {
      earExamStore.backFromHistory();
      return;
    }
    earExamStore.reset();
    store.backToMenu();
    return;
  }
  if (phase.value !== "menu") {
    earTrainingStore.resetTraining();
    store.backToMenu();
  } else {
    router.push("/");
  }
}

function onKeydown(event: KeyboardEvent) {
  const tag = (event.target as HTMLElement | null)?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

  if (
    event.key === " " &&
    phase.value === "ear-training" &&
    (trainingPhase.value === "feedback" || trainingPhase.value === "review-feedback")
  ) {
    event.preventDefault();
    earTrainingStore.continueAfterFeedback();
    return;
  }

  if (event.key === "Escape") {
    onBackClick();
  }
}

onMounted(() => {
  const unlock = () => {
    void unlockEarNamingAudio();
    window.removeEventListener("pointerdown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", onKeydown);
  getEarNamingAudioStatus();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  earTrainingStore.resetTraining();
  earExamStore.reset();
  store.backToMenu();
});
</script>

<template>
  <div
    class="ear-naming-view flex h-full min-h-0 flex-1 flex-col overflow-hidden p-4 sm:p-5 select-none [&_input]:select-text [&_select]:select-text"
  >
    <div class="mb-3 flex shrink-0 items-center gap-3">
      <button type="button" :class="btnGhostClass + ' flex items-center gap-1.5'" @click="onBackClick()">
        <Icon icon="mdi:arrow-left" />
        {{ phase !== "menu" ? (phase === "fretboard-memory" && fretboardSubview === "training" ? "返回练法" : "返回模式") : "返回首页" }}
      </button>

      <div class="ml-auto flex items-center gap-2 text-sm text-zinc-500">
        <Icon icon="mdi:guitar-electric" class="text-lg text-accent" />
        <span>{{ phase === "menu" ? "听力命名训练" : phaseTitle[phase] }}</span>
      </div>
    </div>

    <div
      v-if="phase === 'menu'"
      class="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto py-4"
    >
      <EarNamingModeMenu @select="onSelectPhase" />
    </div>

    <ExplorePanel v-else-if="phase === 'explore'" class="min-h-0" />
    <EarTrainingPanel v-else-if="phase === 'ear-training'" class="min-h-0" />
    <EarExamModule v-else-if="phase === 'ear-exam'" class="min-h-0 flex-1" />
    <FretboardMemoryPanel v-else-if="phase === 'fretboard-memory'" class="min-h-0" />
    <EarNamingSettingsHub v-else-if="phase === 'settings'" class="min-h-0 flex-1" />
  </div>
</template>
