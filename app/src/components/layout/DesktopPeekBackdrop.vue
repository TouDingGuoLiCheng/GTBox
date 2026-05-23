<script setup lang="ts">
import { computed } from "vue";
import { canDesktopPeek, desktopPeekBackdropAlpha } from "../../utils/desktopPeek";
import { useAppearanceStore } from "../../stores/appearance";

const appearance = useAppearanceStore();

const active = computed(() =>
  canDesktopPeek(
    appearance.colorScheme,
    appearance.colorScheme === "custom" &&
      !!appearance.customSkin.backgroundImage,
    appearance.uiPreferences,
  ),
);

const scrimAlpha = computed(() =>
  desktopPeekBackdropAlpha(appearance.uiPreferences),
);
</script>

<template>
  <div
    v-if="active"
    class="pointer-events-none fixed inset-0 z-0"
    aria-hidden="true"
    :style="{ backgroundColor: `rgba(12, 12, 16, ${scrimAlpha})` }"
  />
</template>
