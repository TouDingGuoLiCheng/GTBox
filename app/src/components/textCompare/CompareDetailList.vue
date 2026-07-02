<script setup lang="ts">
import { Icon } from "@iconify/vue";
import { computed } from "vue";
import type { CompareDetailItem, CompareResult } from "../../types/textCompare";

const props = defineProps<{
  result: CompareResult | null;
}>();

const hasDetails = computed(
  () => !!props.result && (props.result.missing.length > 0 || props.result.extra.length > 0),
);

function formatItem(item: CompareDetailItem) {
  const label = item.text.trim() ? item.text : "(空行)";
  if (item.count != null && item.count > 1) {
    return `${label}（×${item.count}）`;
  }
  return label;
}
</script>

<template>
  <div v-if="result" class="min-h-0 flex-1 overflow-y-auto p-3">
    <div
      v-if="!hasDetails"
      class="flex h-full flex-col items-center justify-center gap-2 py-8 text-center text-sm text-zinc-500"
    >
      <Icon icon="mdi:check-all" class="text-2xl text-emerald-500/60" />
      <span>无差异明细</span>
    </div>

    <div v-else class="space-y-4">
      <section v-if="result.missing.length">
        <h4 class="mb-2 flex items-center gap-1.5 text-xs font-medium text-rose-400">
          <Icon icon="mdi:minus-circle-outline" />
          缺失 / 不匹配（{{ result.missing.length }}）
        </h4>
        <ul class="space-y-1">
          <li
            v-for="(item, idx) in result.missing"
            :key="`m-${idx}`"
            class="rounded-lg border border-rose-500/20 bg-rose-500/5 px-2.5 py-1.5 text-xs text-zinc-300"
          >
            {{ item.lineNumber != null ? `第 ${item.lineNumber} 行：` : "" }}{{ formatItem(item) }}
          </li>
        </ul>
      </section>

      <section v-if="result.extra.length">
        <h4 class="mb-2 flex items-center gap-1.5 text-xs font-medium text-amber-400">
          <Icon icon="mdi:plus-circle-outline" />
          多出（{{ result.extra.length }}）
        </h4>
        <ul class="space-y-1">
          <li
            v-for="(item, idx) in result.extra"
            :key="`e-${idx}`"
            class="rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 text-xs text-zinc-300"
          >
            {{ item.lineNumber != null ? `第 ${item.lineNumber} 行：` : "" }}{{ formatItem(item) }}
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
