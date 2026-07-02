<script setup lang="ts">
import { computed } from "vue";
import { Icon } from "@iconify/vue";
import { storeToRefs } from "pinia";
import {
  EAR_EXAM_PASS_COUNT,
  EAR_EXAM_TOTAL_QUESTIONS,
  EAR_TRAINING_DIFFICULTY_LABELS,
  type EarExamRecord,
} from "../../../types/earNaming";
import { useEarNamingEarExamStore } from "../../../stores/earNamingEarExam";

const store = useEarNamingEarExamStore();
const { historyRecords } = storeToRefs(store);

const sortedRecords = computed(() =>
  [...historyRecords.value].sort((a, b) => b.timestamp - a.timestamp),
);

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}

function accuracyText(record: EarExamRecord): string {
  return `${Math.round(record.accuracy * 100)}%`;
}

function solfegeSummary(record: EarExamRecord): string {
  return Object.entries(record.bySolfege)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 4)
    .map(([name, stat]) => `${name} ${stat.correct}/${stat.total}`)
    .join(" · ");
}
</script>

<template>
  <div class="mx-auto w-full max-w-lg space-y-4">
    <div class="text-center">
      <Icon icon="mdi:history" class="mx-auto text-4xl text-accent" />
      <h2 class="mt-2 text-lg font-medium text-zinc-200">历史记录</h2>
      <p class="mt-1 text-sm text-zinc-500">最近 {{ sortedRecords.length }} 次考试</p>
    </div>

    <ul v-if="sortedRecords.length" class="space-y-2">
      <li
        v-for="record in sortedRecords"
        :key="record.id"
        class="rounded-xl border border-border bg-black/20 p-3"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-sm text-zinc-200">
              {{ EAR_TRAINING_DIFFICULTY_LABELS[record.difficulty] }}
              <span class="text-zinc-500">· {{ formatTimestamp(record.timestamp) }}</span>
            </p>
            <p class="mt-1 text-lg font-semibold tabular-nums text-zinc-100">
              {{ record.correct }}/{{ record.total }}
              <span class="text-sm font-normal text-zinc-400">（{{ accuracyText(record) }}）</span>
            </p>
            <p class="mt-0.5 text-xs text-zinc-500">
              用时 {{ formatDuration(record.durationMs) }}
              · 平均 {{ record.avgResponseMs }} ms
            </p>
            <p v-if="solfegeSummary(record)" class="mt-1 truncate text-xs text-zinc-500">
              {{ solfegeSummary(record) }}
            </p>
          </div>
          <span
            class="shrink-0 rounded-md px-2 py-0.5 text-xs"
            :class="
              record.passed
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'bg-amber-500/15 text-amber-300'
            "
          >
            {{ record.passed ? "通过" : "未通过" }}
          </span>
        </div>
        <p class="mt-1.5 text-[11px] text-zinc-600">
          通过线 ≥ {{ EAR_EXAM_PASS_COUNT }}/{{ EAR_EXAM_TOTAL_QUESTIONS }}
        </p>
      </li>
    </ul>

    <p v-else class="rounded-xl border border-border bg-black/20 py-10 text-center text-sm text-zinc-500">
      暂无考试记录
    </p>

    <div class="flex justify-center pt-1">
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm text-zinc-400 transition hover:border-accent/40 hover:text-accent"
        title="返回选级"
        @click="store.backFromHistory()"
      >
        <Icon icon="mdi:arrow-left" />
        返回选级
      </button>
    </div>
  </div>
</template>
