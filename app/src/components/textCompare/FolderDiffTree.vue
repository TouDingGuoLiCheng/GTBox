<script setup lang="ts">
import { Icon } from "@iconify/vue";
import { computed, ref } from "vue";
import type { FolderDiffEntry, FolderDiffKind } from "../../types/textCompare";

const props = defineProps<{
  diffs: FolderDiffEntry[];
}>();

const expanded = ref<Set<string>>(new Set(["/"]));

const kindMeta: Record<
  FolderDiffKind,
  { label: string; icon: string; class: string }
> = {
  only_left: {
    label: "仅目标",
    icon: "mdi:folder-remove-outline",
    class: "text-rose-400 border-rose-500/20 bg-rose-500/5",
  },
  only_right: {
    label: "仅待比对",
    icon: "mdi:folder-plus-outline",
    class: "text-amber-400 border-amber-500/20 bg-amber-500/5",
  },
  content_diff: {
    label: "内容不同",
    icon: "mdi:file-alert-outline",
    class: "text-sky-400 border-sky-500/20 bg-sky-500/5",
  },
};

interface TreeRow {
  key: string;
  depth: number;
  name: string;
  kind?: FolderDiffKind;
  hasChildren: boolean;
  childCount: number;
}

const rows = computed(() => {
  const sorted = [...props.diffs].sort((a, b) => a.relPath.localeCompare(b.relPath, "zh"));
  const result: TreeRow[] = [];

  for (const item of sorted) {
    const isDir = item.relPath.endsWith("/");
    const clean = isDir ? item.relPath.slice(0, -1) : item.relPath;
    const parts = clean.split("/").filter(Boolean);
    const depth = Math.max(0, parts.length - 1);
    const name = parts[parts.length - 1] ?? clean;

    result.push({
      key: item.relPath,
      depth,
      name: isDir ? `${name}/` : name,
      kind: item.kind,
      hasChildren: false,
      childCount: 0,
    });
  }
  return result;
});

const visibleRows = computed(() =>
  rows.value.filter((row) => {
    if (row.depth === 0) return true;
    const parts = row.key.replace(/\/$/, "").split("/").filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const ancestor = `${parts.slice(0, i).join("/")}/`;
      if (props.diffs.some((d) => d.relPath === ancestor) && !expanded.value.has(ancestor)) {
        return false;
      }
    }
    return true;
  }),
);

function toggleDir(row: TreeRow) {
  if (!row.key.endsWith("/")) return;
  const next = new Set(expanded.value);
  if (next.has(row.key)) next.delete(row.key);
  else next.add(row.key);
  expanded.value = next;
}
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-2">
    <p v-if="!diffs.length" class="py-6 text-center text-xs text-zinc-500">无路径差异</p>
    <ul v-else class="space-y-0.5">
      <li
        v-for="row in visibleRows"
        :key="row.key"
        class="flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
        :class="row.kind ? kindMeta[row.kind].class : 'border-border/50 bg-black/10'"
        :style="{ marginLeft: `${row.depth * 14}px` }"
      >
        <button
          v-if="row.key.endsWith('/')"
          type="button"
          class="shrink-0 text-zinc-500 hover:text-zinc-200"
          @click="toggleDir(row)"
        >
          <Icon
            :icon="expanded.has(row.key) ? 'mdi:chevron-down' : 'mdi:chevron-right'"
            class="text-sm"
          />
        </button>
        <span v-else class="w-3.5 shrink-0" />
        <Icon
          :icon="row.kind ? kindMeta[row.kind].icon : 'mdi:file-outline'"
          class="shrink-0 text-sm"
          :class="row.kind ? '' : 'text-zinc-500'"
        />
        <span class="min-w-0 flex-1 truncate text-zinc-300" :title="row.key">{{ row.name }}</span>
        <span v-if="row.kind" class="shrink-0 text-[10px] opacity-80">
          {{ kindMeta[row.kind].label }}
        </span>
      </li>
    </ul>
  </div>
</template>
