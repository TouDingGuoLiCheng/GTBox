<script setup lang="ts">
import { computed } from "vue";
import { useAppearanceStore } from "../../stores/appearance";
import AsciiArtEffect from "./effects/AsciiArtEffect.vue";
import LaserBandsEffect from "./effects/LaserBandsEffect.vue";
import MatrixRainEffect from "./effects/MatrixRainEffect.vue";
import RainRipplesEffect from "./effects/RainRipplesEffect.vue";
import StarParticlesEffect from "./effects/StarParticlesEffect.vue";

const appearance = useAppearanceStore();

const active = computed(() => appearance.creativeBackground.effect !== "none");

const effect = computed(() => appearance.creativeBackground.effect);

const bgTheme = computed(() =>
  appearance.colorScheme === "light" ? "light" : "dark",
);

const matrixPixelStyle = computed(
  () => appearance.colorScheme === "pixel",
);

const intensity = computed(() => appearance.creativeBackground.intensity);

const useDarkScrim = computed(
  () => bgTheme.value === "dark" && effect.value === "matrix-rain",
);
</script>

<template>
  <div
    v-if="active"
    class="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    aria-hidden="true"
  >
    <div
      v-if="useDarkScrim"
      class="creative-matrix-scrim absolute inset-0"
    />
    <MatrixRainEffect
      v-if="effect === 'matrix-rain'"
      :theme="bgTheme"
      :intensity="intensity"
      :pixel-style="matrixPixelStyle"
    />
    <StarParticlesEffect
      v-else-if="effect === 'particle-stars'"
      :theme="bgTheme"
      :intensity="intensity"
      :star-trails="appearance.creativeBackground.particleStars.starTrails"
      :show-flares="appearance.creativeBackground.particleStars.showFlares"
      :show-meteors="appearance.creativeBackground.particleStars.showMeteors"
    />
    <LaserBandsEffect
      v-else-if="effect === 'laser-bands'"
      :theme="bgTheme"
      :intensity="intensity"
    />
    <AsciiArtEffect
      v-else-if="effect === 'ascii-art'"
      :theme="bgTheme"
      :intensity="intensity"
      :source-subpath="appearance.creativeBackground.asciiArt.sourceSubpath"
      :threshold="appearance.creativeBackground.asciiArt.threshold"
      :invert="appearance.creativeBackground.asciiArt.invert"
      :frame-count="appearance.creativeBackground.asciiArt.frameCount"
      :refresh-nonce="appearance.creativeBackground.asciiArt.refreshNonce"
      :wand-tolerance="appearance.creativeBackground.asciiArt.wandTolerance"
      :cell-size="appearance.creativeBackground.asciiArt.cellSize"
    />
    <RainRipplesEffect
      v-else-if="effect === 'rain-ripples'"
      :theme="bgTheme"
      :intensity="intensity"
    />
  </div>
</template>
