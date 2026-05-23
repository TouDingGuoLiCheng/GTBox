<script setup lang="ts">
import { useToolsStore } from "../../stores/tools";
import type { ToolCategory } from "../../types/tool";

const store = useToolsStore();

function onSelect(category: ToolCategory) {
  store.setCategory(category);
}
</script>

<template>
  <aside class="ui-sidebar relative z-[1] w-36 shrink-0 border-r border-border py-4 pl-4 pr-2">
    <p class="mb-3 px-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
      分类
    </p>
    <ul class="space-y-1">
      <li v-for="cat in store.categories" :key="cat">
        <button
          type="button"
          class="w-full rounded-lg px-3 py-2 text-left text-sm transition"
          :class="
            store.activeCategory === cat
              ? 'ui-sidebar-btn--active bg-accent/15 text-accent font-medium ring-1 ring-accent/25'
              : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
          "
          @click="onSelect(cat)"
        >
          {{ cat }}
        </button>
      </li>
    </ul>
  </aside>
</template>
