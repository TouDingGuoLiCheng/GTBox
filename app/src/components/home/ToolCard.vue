<script setup lang="ts">
import { Icon } from "@iconify/vue";
import { computed } from "vue";
import { useRouter } from "vue-router";
import type { ToolItem } from "../../types/tool";
import { useAppearanceStore } from "../../stores/appearance";
import { useToolsStore } from "../../stores/tools";

const props = defineProps<{
  tool: ToolItem;
  index: number;
}>();

const router = useRouter();
const store = useToolsStore();
const appearance = useAppearanceStore();

const isSelected = computed(() => store.selectedToolId === props.tool.id);

const cardHoverClass = computed(() =>
  appearance.uiPreferences.cardAnimation
    ? "hover:-translate-y-1 hover:border-white/15 hover:shadow-lg hover:shadow-black/40"
    : "hover:border-white/15",
);

function openTool() {
  store.selectTool(props.tool.id);
  if (props.tool.customRoute) {
    router.push(props.tool.customRoute);
    return;
  }
  router.push({ name: "tool-detail", params: { id: props.tool.id } });
}
</script>

<template>
  <article
    v-if="appearance.uiPreferences.cardAnimation"
    v-motion
    :initial="{ opacity: 0, y: 28 }"
    :enter="{
      opacity: 1,
      y: 0,
      transition: { delay: index * 70, duration: 0.45, ease: 'easeOut' },
    }"
    class="ui-card group relative cursor-pointer p-5 transition duration-300"
    :class="[
      isSelected
        ? 'scale-[1.02] border-accent/50 shadow-[0_0_32px_-8px] shadow-accent/30'
        : cardHoverClass,
    ]"
    @click="openTool"
    @mouseenter="store.selectTool(tool.id)"
    @mouseleave="store.selectTool(null)"
  >
    <span
      v-if="isSelected"
      class="absolute left-0 top-4 h-10 w-1 rounded-r-full bg-accent transition-all duration-300"
    />

    <div
      v-motion
      :initial="{ scale: 1 }"
      :hovered="{ scale: 1.05 }"
      :transition="{ type: 'spring', stiffness: 400, damping: 18 }"
      class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20"
    >
      <Icon :icon="tool.icon ?? 'mdi:tools'" class="text-2xl" />
    </div>

    <h3 class="mb-1.5 text-base font-semibold text-zinc-100">{{ tool.name }}</h3>
    <p class="mb-3 line-clamp-2 text-sm leading-relaxed text-zinc-500">
      {{ tool.description }}
    </p>

    <div v-if="tool.tags?.length" class="flex flex-wrap gap-1.5">
      <span
        v-for="tag in tool.tags"
        :key="tag"
        class="ui-tag text-zinc-400"
      >
        {{ tag }}
      </span>
    </div>
  </article>

  <article
    v-else
    class="ui-card group relative cursor-pointer p-5 transition duration-300"
    :class="[
      isSelected
        ? 'border-accent/50 shadow-[0_0_32px_-8px] shadow-accent/30'
        : cardHoverClass,
    ]"
    @click="openTool"
    @mouseenter="store.selectTool(tool.id)"
    @mouseleave="store.selectTool(null)"
  >
    <span
      v-if="isSelected"
      class="absolute left-0 top-4 h-10 w-1 rounded-r-full bg-accent transition-all duration-300"
    />

    <div
      class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20"
    >
      <Icon :icon="tool.icon ?? 'mdi:tools'" class="text-2xl" />
    </div>

    <h3 class="mb-1.5 text-base font-semibold text-zinc-100">{{ tool.name }}</h3>
    <p class="mb-3 line-clamp-2 text-sm leading-relaxed text-zinc-500">
      {{ tool.description }}
    </p>

    <div v-if="tool.tags?.length" class="flex flex-wrap gap-1.5">
      <span
        v-for="tag in tool.tags"
        :key="tag"
        class="ui-tag text-zinc-400"
      >
        {{ tag }}
      </span>
    </div>
  </article>
</template>
