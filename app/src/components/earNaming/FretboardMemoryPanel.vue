<script setup lang="ts">
import { storeToRefs } from "pinia";
import type { TrainingMode } from "../../types/earNaming";
import { useEarNamingStore } from "../../stores/earNaming";
import FretboardModeMenu from "./fretboard/FretboardModeMenu.vue";
import FretboardTrainingPanel from "./fretboard/FretboardTrainingPanel.vue";

const store = useEarNamingStore();
const { fretboardSubview } = storeToRefs(store);

function onStartMode(mode: TrainingMode) {
  store.startFretboardMode(mode);
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div
      v-if="fretboardSubview === 'mode-menu'"
      class="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto py-4"
    >
      <FretboardModeMenu @start="onStartMode" />
    </div>
    <FretboardTrainingPanel v-else class="min-h-0 flex-1" />
  </div>
</template>
