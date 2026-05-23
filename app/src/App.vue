<script setup lang="ts">
import { computed } from "vue";
import AppHeader from "./components/layout/AppHeader.vue";
import AppSkinBackground from "./components/layout/AppSkinBackground.vue";
import SkinPresetBgmPlayer from "./components/layout/SkinPresetBgmPlayer.vue";
import CreativeBackground from "./components/layout/CreativeBackground.vue";
import DesktopPeekBackdrop from "./components/layout/DesktopPeekBackdrop.vue";
import MediaDebugOverlay from "./components/layout/MediaDebugOverlay.vue";
import CustomSkinDialog from "./components/settings/CustomSkinDialog.vue";
import { canDesktopPeek } from "./utils/desktopPeek";
import { useAppearanceStore } from "./stores/appearance";

const appearance = useAppearanceStore();

const desktopPeekActive = computed(() =>
  canDesktopPeek(
    appearance.colorScheme,
    appearance.colorScheme === "custom" &&
      !!appearance.customSkin.backgroundImage,
    appearance.uiPreferences,
  ),
);

const transparentShell = computed(() => {
  const scheme = appearance.colorScheme;
  const creative = appearance.creativeBackground;
  if (desktopPeekActive.value) return true;
  if (scheme === "pixel") return true;
  if (scheme === "galaxy") return true;
  if (scheme === "custom" && appearance.customSkin.backgroundImage) return true;
  if (creative.effect !== "none") return true;
  return false;
});

const hideCreativeBySkinMedia = computed(
  () =>
    appearance.colorScheme === "custom" &&
    !!appearance.customSkin.backgroundImage,
);
</script>

<template>
  <div
    class="relative flex h-full flex-col transition-colors duration-300"
    :class="transparentShell ? 'bg-transparent' : 'bg-surface'"
  >
    <AppSkinBackground />
    <DesktopPeekBackdrop />
    <SkinPresetBgmPlayer />
    <CreativeBackground
      v-if="
        !hideCreativeBySkinMedia &&
        (!desktopPeekActive || !appearance.uiPreferences.desktopPeekHideCreative)
      "
    />
    <AppHeader />
    <main class="relative z-[1] flex min-h-0 flex-1 flex-col overflow-hidden">
      <RouterView v-slot="{ Component, route }">
        <Transition v-if="appearance.uiPreferences.pageAnimation" name="page" mode="out-in">
          <div :key="route.path" class="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
            <component :is="Component" />
          </div>
        </Transition>
        <div
          v-else
          :key="route.path"
          class="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
        >
          <component :is="Component" />
        </div>
      </RouterView>
    </main>
    <MediaDebugOverlay />
    <CustomSkinDialog />
  </div>
</template>

<style>
.page-enter-active,
.page-leave-active {
  transition:
    opacity 0.28s ease,
    transform 0.28s ease;
}

.page-enter-from {
  opacity: 0;
  transform: translateX(12px);
}

.page-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}
</style>
