<script setup lang="ts">
import { Icon } from "@iconify/vue";
import type { CompareResult } from "../../types/textCompare";

defineProps<{
  result: CompareResult | null;
  modeLabel: string;
}>();
</script>

<template>
  <div v-if="result" class="space-y-3">
    <div class="flex items-center gap-2">
      <span
        class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-medium"
        :class="result.match ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'"
      >
        <Icon :icon="result.match ? 'mdi:check-circle-outline' : 'mdi:close-circle-outline'" />
        {{ result.match ? "一致" : "不一致" }}
      </span>
      <span class="text-sm text-zinc-400">{{ modeLabel }}</span>
    </div>

    <div class="grid grid-cols-2 gap-2 text-center">
      <div class="rounded-lg border border-border bg-black/20 px-2 py-2">
        <div class="text-lg font-semibold tabular-nums text-accent">{{ result.matchRate }}%</div>
        <div class="text-[10px] text-zinc-500">匹配度</div>
      </div>
      <div class="rounded-lg border border-border bg-black/20 px-2 py-2">
        <div class="text-lg font-semibold tabular-nums text-zinc-200">
          {{ result.missingCount + result.extraCount }}
        </div>
        <div class="text-[10px] text-zinc-500">差异项</div>
      </div>
    </div>

    <p class="text-xs leading-relaxed text-zinc-400">{{ result.summary }}</p>

    <dl
      v-if="result.folderStats"
      class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-zinc-500"
    >
      <div class="flex justify-between gap-2">
        <dt>总文件数</dt>
        <dd class="tabular-nums text-zinc-300">{{ result.folderStats.totalFiles }}</dd>
      </div>
      <div class="flex justify-between gap-2">
        <dt>一致文件</dt>
        <dd class="tabular-nums text-emerald-400/90">{{ result.folderStats.sameFileCount }}</dd>
      </div>
      <div class="flex justify-between gap-2">
        <dt>内容不同</dt>
        <dd class="tabular-nums text-zinc-300">{{ result.folderStats.diffFileCount }}</dd>
      </div>
      <div class="flex justify-between gap-2">
        <dt>仅目标 / 仅待比对</dt>
        <dd class="tabular-nums text-zinc-300">
          {{ result.folderStats.onlyLeftCount }} / {{ result.folderStats.onlyRightCount }}
        </dd>
      </div>
    </dl>

    <dl
      v-else-if="result.targetLineCount != null"
      class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-zinc-500"
    >
      <div class="flex justify-between gap-2">
        <dt>目标行数</dt>
        <dd class="tabular-nums text-zinc-300">{{ result.targetLineCount }}</dd>
      </div>
      <div class="flex justify-between gap-2">
        <dt>待比对行数</dt>
        <dd class="tabular-nums text-zinc-300">{{ result.candidateLineCount }}</dd>
      </div>
      <div v-if="result.matchedCount != null" class="flex justify-between gap-2 col-span-2">
        <dt>已匹配目标行</dt>
        <dd class="tabular-nums text-zinc-300">{{ result.matchedCount }}</dd>
      </div>
    </dl>
  </div>
</template>
