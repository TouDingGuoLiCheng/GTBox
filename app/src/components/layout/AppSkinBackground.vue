<script setup lang="ts">

import { computed, watch } from "vue";

import { GALAXY_SKIN, useAppearanceStore } from "../../stores/appearance";
import galaxyFallbackUrl from "../../assets/themes/galaxy-bg.png";
import { pushMediaDebug } from "../../utils/mediaDebug";

import SkinBackdropMedia from "./SkinBackdropMedia.vue";



const appearance = useAppearanceStore();



const skinConfig = computed(() => {

  if (appearance.colorScheme === "galaxy") return GALAXY_SKIN;

  return appearance.customSkin;

});

const effectiveSkinConfig = computed(() => {
  const cfg = skinConfig.value;
  if (!appearance.uiPreferences.disableSkinFxForDebug) return cfg;
  return {
    ...cfg,
    blur: 0,
    brightness: 100,
    maskOpacity: 0,
    scale: 1,
  };
});



const active = computed(

  () => {
    if (appearance.colorScheme === "galaxy") return true;
    if (appearance.colorScheme === "custom") return !!skinConfig.value.backgroundImage;
    return false;
  },

);



const bgUrl = computed(() =>
  appearance.colorScheme === "galaxy"
    ? galaxyFallbackUrl
    : appearance.getSkinImageUrl(skinConfig.value.backgroundImage),
);



const maskStyle = computed(() => ({

  opacity: effectiveSkinConfig.value.maskOpacity / 100,

}));



const watermarkCover = computed(() => {

  if (appearance.colorScheme !== "custom") return null;

  return appearance.activeSkinPreset()?.watermark ?? null;

});



/** 预设视频始终静音，用配套 MP3；用户自选视频可走原声 */

const videoMuted = computed(() => {

  if (appearance.colorScheme !== "custom") return true;

  if (appearance.skinPresetId) return true;

  if (!skinConfig.value.keepVideoAudio) return true;

  return false;

});



const videoVolume = computed(() => appearance.skinPresetBgm.volume / 100);

watch(
  () => [appearance.colorScheme, skinConfig.value.backgroundImage, bgUrl.value] as const,
  ([scheme, backgroundImage, resolved]) => {
    const payload = {
      scheme,
      backgroundImage,
      resolvedBgUrl: resolved,
      active: active.value,
      blur: effectiveSkinConfig.value.blur,
      brightness: effectiveSkinConfig.value.brightness,
      maskOpacity: effectiveSkinConfig.value.maskOpacity,
      scale: effectiveSkinConfig.value.scale,
      contentUiHidden: appearance.uiPreferences.contentUiHidden,
      disableSkinFxForDebug: appearance.uiPreferences.disableSkinFxForDebug,
    };
    pushMediaDebug("AppSkinBackground", "theme-background-updated", payload);
  },
  { immediate: true },
);

</script>



<template>

  <div
    v-if="active"
    class="pointer-events-none fixed left-0 top-0 z-0 h-screen w-screen overflow-hidden"
    aria-hidden="true"
  >

    <SkinBackdropMedia

      class="h-full w-full transition-[filter,transform] duration-300"

      :src="bgUrl"

      :blur="effectiveSkinConfig.blur"

      :brightness="effectiveSkinConfig.brightness"

      :scale="effectiveSkinConfig.scale"

      :watermark-cover="watermarkCover"

      :video-muted="videoMuted"

      :video-volume="videoVolume"
      debug-tag="home-background"

      fit="cover"

    />

    <div

      v-if="effectiveSkinConfig.maskOpacity > 0"

      class="absolute inset-0 bg-black transition-opacity duration-300"

      :style="maskStyle"

    />

  </div>

</template>

