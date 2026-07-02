<script setup lang="ts">
import { Icon } from "@iconify/vue";
import type { CompareMode } from "../../types/textCompare";

const model = defineModel<CompareMode>({ required: true });

const modes = [
  { value: "line" as const, label: "按行比对", icon: "mdi:format-list-bulleted" },
  { value: "full" as const, label: "全文比对", icon: "mdi:file-document-outline" },
  { value: "regex" as const, label: "规则比对", icon: "mdi:graph-outline" },
  { value: "folder" as const, label: "文件夹比对", icon: "mdi:folder-multiple-outline" },
];
</script>

<template>
  <div class="flex flex-wrap gap-1 rounded-xl border border-border bg-black/20 p-1">
    <button
      v-for="item in modes"
      :key="item.value"
      type="button"
      class="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition"
      :class="
        model === item.value
          ? 'bg-accent/15 text-accent shadow-sm'
          : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
      "
      @click="model = item.value"
    >
      <Icon :icon="item.icon" class="text-base" />
      {{ item.label }}
    </button>
  </div>
</template>
