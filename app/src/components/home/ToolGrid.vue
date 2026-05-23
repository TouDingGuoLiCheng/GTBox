<script setup lang="ts">
import { computed } from "vue";
import { useAppearanceStore } from "../../stores/appearance";
import { useToolsStore } from "../../stores/tools";
import ToolCard from "./ToolCard.vue";

const store = useToolsStore();
const appearance = useAppearanceStore();

const tools = computed(() => store.filteredTools);

const gridClass = computed(() => {
  const base = "grid grid-cols-1 gap-4";
  switch (appearance.uiPreferences.toolGridCols) {
    case "2":
      return `${base} sm:grid-cols-2`;
    case "3":
      return `${base} sm:grid-cols-2 lg:grid-cols-3`;
    default:
      return `${base} sm:grid-cols-2 xl:grid-cols-3`;
  }
});
</script>

<template>
  <TransitionGroup
    v-if="appearance.uiPreferences.cardAnimation"
    name="grid-fade"
    tag="div"
    :class="gridClass"
  >
    <ToolCard
      v-for="(tool, index) in tools"
      :key="tool.id"
      :tool="tool"
      :index="index"
    />
  </TransitionGroup>
  <div v-else :class="gridClass">
    <ToolCard
      v-for="(tool, index) in tools"
      :key="tool.id"
      :tool="tool"
      :index="index"
    />
  </div>
</template>

<style scoped>
.grid-fade-move,
.grid-fade-enter-active,
.grid-fade-leave-active {
  transition: all 0.35s ease;
}

.grid-fade-enter-from,
.grid-fade-leave-to {
  opacity: 0;
  transform: scale(0.96);
}

.grid-fade-leave-active {
  position: absolute;
}
</style>
