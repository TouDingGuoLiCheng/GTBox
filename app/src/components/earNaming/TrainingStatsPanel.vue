<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useEarNamingStore } from "../../stores/earNaming";
import { formatAccuracy } from "../../utils/earNaming/stats";

const store = useEarNamingStore();
const { roundStats, trainingPhase } = storeToRefs(store);

const showPanel = computed(
  () => roundStats.value.total > 0 || trainingPhase.value === "round-complete",
);

const stringRows = computed(() =>
  Object.entries(roundStats.value.byString)
    .map(([stringNo, stat]) => ({
      stringNo: Number(stringNo),
      ...stat,
      accuracy: stat.total > 0 ? stat.correct / stat.total : 0,
    }))
    .sort((a, b) => a.stringNo - b.stringNo),
);

const degreeRows = computed(() =>
  Object.entries(roundStats.value.byDegree)
    .map(([degree, stat]) => ({
      degree,
      ...stat,
      accuracy: stat.total > 0 ? stat.correct / stat.total : 0,
    }))
    .sort((a, b) => b.total - a.total),
);
</script>

<template>
  <section v-if="showPanel" class="stats-panel space-y-3 rounded-xl border border-border bg-black/20 p-3 text-xs">
    <p class="text-sm font-medium text-zinc-300">本轮统计</p>

    <div class="grid grid-cols-2 gap-2 text-zinc-400">
      <p>总正确率 <span class="text-zinc-200">{{ formatAccuracy(roundStats.accuracy) }}</span></p>
      <p>题数 <span class="text-zinc-200">{{ roundStats.correct }}/{{ roundStats.total }}</span></p>
    </div>

    <div v-if="stringRows.length" class="space-y-1">
      <p class="text-zinc-500">按弦正确率</p>
      <div v-for="row in stringRows" :key="`string-${row.stringNo}`" class="flex items-center gap-2">
        <span class="w-8 text-zinc-400">{{ row.stringNo }}弦</span>
        <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <div class="h-full bg-accent/80" :style="{ width: `${Math.round(row.accuracy * 100)}%` }" />
        </div>
        <span class="w-10 text-right text-zinc-300">{{ formatAccuracy(row.accuracy) }}</span>
      </div>
    </div>

    <div v-if="degreeRows.length" class="space-y-1">
      <p class="text-zinc-500">按级数正确率</p>
      <div v-for="row in degreeRows" :key="`degree-${row.degree}`" class="flex items-center gap-2">
        <span class="w-14 truncate text-zinc-400">{{ row.degree }}级</span>
        <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <div class="h-full bg-emerald-400/80" :style="{ width: `${Math.round(row.accuracy * 100)}%` }" />
        </div>
        <span class="w-10 text-right text-zinc-300">{{ formatAccuracy(row.accuracy) }}</span>
      </div>
    </div>

    <div v-if="roundStats.weaknessHints.length" class="space-y-1 border-t border-border pt-2">
      <p class="text-zinc-500">弱项提示</p>
      <p v-for="(hint, i) in roundStats.weaknessHints" :key="`hint-${i}`" class="text-amber-200/90">
        · {{ hint }}
      </p>
    </div>
  </section>
</template>
