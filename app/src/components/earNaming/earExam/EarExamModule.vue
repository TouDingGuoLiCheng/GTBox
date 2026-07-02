<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useEarNamingEarExamStore } from "../../../stores/earNamingEarExam";
import EarExamLevelMenu from "./EarExamLevelMenu.vue";
import EarExamPanel from "./EarExamPanel.vue";
import EarExamReport from "./EarExamReport.vue";
import EarExamHistory from "./EarExamHistory.vue";

const store = useEarNamingEarExamStore();
const { examPhase } = storeToRefs(store);
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto py-4">
    <EarExamLevelMenu
      v-if="examPhase === 'level-select' || examPhase === 'briefing'"
    />
    <EarExamPanel v-else-if="examPhase === 'in-progress'" />
    <EarExamReport v-else-if="examPhase === 'report'" />
    <EarExamHistory v-else-if="examPhase === 'history'" />
  </div>
</template>
