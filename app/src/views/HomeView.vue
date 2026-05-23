<script setup lang="ts">
import { computed, onMounted } from "vue";
import CategorySidebar from "../components/home/CategorySidebar.vue";
import ToolGrid from "../components/home/ToolGrid.vue";
import { GALAXY_SKIN, useAppearanceStore } from "../stores/appearance";
import { useToolsStore } from "../stores/tools";

const store = useToolsStore();
const appearance = useAppearanceStore();

const contentUiHidden = computed(() => appearance.uiPreferences.contentUiHidden);

const titleBlockActive = computed(() => {
  if (appearance.colorScheme === "galaxy") {
    return GALAXY_SKIN.titleMaterial !== "plain" && GALAXY_SKIN.titleOpacity > 0;
  }
  return (
    appearance.colorScheme === "custom" &&
    appearance.customSkin.titleMaterial !== "plain" &&
    appearance.customSkin.titleOpacity > 0
  );
});

onMounted(() => {
  if (!store.tools.length) {
    void store.loadTools();
  }
});
</script>

<template>
  <div class="flex min-h-0 flex-1 overflow-hidden">
    <Transition name="home-content-ui">
      <div
        v-if="!contentUiHidden"
        class="flex min-h-0 min-w-0 flex-1 overflow-hidden"
      >
        <CategorySidebar />
        <section class="relative z-[1] flex min-w-0 flex-1 flex-col overflow-hidden p-5">
          <div
            v-motion
            :initial="{ opacity: 0 }"
            :enter="{ opacity: 1, transition: { duration: 0.4 } }"
            class="ui-title-block mb-4"
            :class="{ 'ui-title-block--active': titleBlockActive }"
          >
            <h2 class="ui-title text-xl font-semibold text-zinc-100">
              {{ store.activeCategory }}
            </h2>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto pr-1">
            <p
              v-if="store.loading"
              class="rounded-lg border border-border bg-black/20 px-4 py-3 text-sm text-zinc-400"
            >
              正在加载插件列表...
            </p>
            <p
              v-else-if="store.error"
              class="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300"
            >
              插件读取失败：{{ store.error }}
            </p>
            <ToolGrid v-if="store.filteredTools.length" />
            <p
              v-else
              class="rounded-lg border border-border bg-black/20 px-4 py-3 text-sm text-zinc-400"
            >
              当前分类下暂无工具
            </p>
          </div>
        </section>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.home-content-ui-enter-active,
.home-content-ui-leave-active {
  transition:
    opacity 0.38s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.38s cubic-bezier(0.4, 0, 0.2, 1);
}

.home-content-ui-enter-from,
.home-content-ui-leave-to {
  opacity: 0;
  transform: translateY(14px) scale(0.985);
}

.home-content-ui-enter-to,
.home-content-ui-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
}
</style>
