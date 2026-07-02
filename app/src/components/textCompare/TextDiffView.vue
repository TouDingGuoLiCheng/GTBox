<script setup lang="ts">
import { computed } from "vue";
import type { FullTextOptions } from "../../types/textCompare";
import {
  buildLineDiff,
  compactDiffRows,
  countDiffRows,
  type TextDiffRow,
} from "../../utils/textDiff";

const props = defineProps<{
  target: string;
  candidate: string;
  options: FullTextOptions;
}>();

const allRows = computed(() => buildLineDiff(props.target, props.candidate, props.options));

const display = computed(() => compactDiffRows(allRows.value));

const changedCount = computed(() => countDiffRows(allRows.value));

function rowClass(kind: TextDiffRow["kind"]) {
  switch (kind) {
    case "equal":
      return "diff-equal";
    case "delete":
      return "diff-delete";
    case "insert":
      return "diff-insert";
    case "replace":
      return "diff-replace";
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-col border-t border-border">
    <div class="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
      <span class="text-xs font-medium text-zinc-400">全文 Diff</span>
      <span class="text-[10px] text-zinc-600">
        {{ changedCount ? `${changedCount} 处差异` : "无差异" }}
        <span v-if="display.truncated"> · 已折叠部分相同行</span>
      </span>
    </div>
    <div class="min-h-0 max-h-56 overflow-auto px-2 pb-2">
      <table class="w-full border-collapse text-xs">
        <thead>
          <tr class="text-[10px] text-zinc-600">
            <th class="w-8 py-1 text-left font-normal">#</th>
            <th class="w-[45%] py-1 text-left font-normal">目标</th>
            <th class="w-[45%] py-1 text-left font-normal">待比对</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, idx) in display.rows"
            :key="idx"
            class="diff-row"
            :class="rowClass(row.kind)"
          >
            <td class="align-top py-0.5 pr-1 tabular-nums text-zinc-600">
              {{ row.leftNo ?? row.rightNo ?? "" }}
            </td>
            <td class="align-top py-0.5 pr-2 font-mono break-all">
              <span v-if="row.left != null">{{ row.left || "(空行)" }}</span>
              <span v-else class="text-zinc-700">—</span>
            </td>
            <td class="align-top py-0.5 font-mono break-all">
              <span v-if="row.right != null">{{ row.right || "(空行)" }}</span>
              <span v-else class="text-zinc-700">—</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!display.rows.length" class="py-4 text-center text-xs text-zinc-500">无内容可比对</p>
    </div>
  </div>
</template>

<style scoped>
.diff-row td {
  border-radius: 0.25rem;
}
.diff-equal td {
  color: rgb(113 113 122);
}
.diff-delete td {
  background: rgb(244 63 94 / 0.08);
  color: rgb(251 113 133);
}
.diff-insert td {
  background: rgb(52 211 153 / 0.08);
  color: rgb(110 231 183);
}
.diff-replace td {
  background: rgb(56 189 248 / 0.08);
  color: rgb(125 211 252);
}
</style>
