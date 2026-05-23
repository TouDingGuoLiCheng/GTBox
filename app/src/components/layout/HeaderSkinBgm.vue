<script setup lang="ts">
import { computed } from "vue";
import { useAppearanceStore } from "../../stores/appearance";
import VinylDiscIcon from "./VinylDiscIcon.vue";

const appearance = useAppearanceStore();

const track = computed(() => appearance.activeSkinBgm()?.display ?? null);

const visible = computed(() => {
  if (!appearance.skinBgmPlaying) return false;
  return appearance.colorScheme === "custom" && !!track.value && !!appearance.activeSkinBgm();
});

const label = computed(() => {
  if (!track.value) return "";
  return `${track.value.title}-${track.value.artist}`;
});
</script>

<template>
  <div
    v-if="visible"
    class="header-skin-bgm pointer-events-none flex h-11 max-w-[min(42vw,16rem)] items-center gap-1.5 px-2"
    aria-hidden="true"
  >
    <VinylDiscIcon class="header-skin-bgm__disc shrink-0" />
    <span class="header-skin-bgm__label min-w-0 truncate text-xs text-zinc-400">
      {{ label }}
    </span>
  </div>
</template>
