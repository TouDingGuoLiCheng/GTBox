<script setup lang="ts">
import { Icon } from "@iconify/vue";
import { RouterLink, useRoute } from "vue-router";
import { computed, ref } from "vue";
import { APP_DISPLAY_NAME } from "../../config/brand";
import { useAppearanceStore } from "../../stores/appearance";
import { startWindowDrag, toggleAppFullscreen } from "../../composables/useAppWindow";
import HeaderSkinBgm from "./HeaderSkinBgm.vue";
import WindowControls from "./WindowControls.vue";

const appearance = useAppearanceStore();
const route = useRoute();
const isHome = computed(() => route.name === "home");
const isSettings = computed(() => route.name === "settings");
const settingsSpinning = ref(false);
const hideUiPulse = ref(false);

const contentUiHidden = computed(() => appearance.uiPreferences.contentUiHidden);

async function onTitleBarDblClick() {
  try {
    await toggleAppFullscreen();
  } catch (err) {
    console.error("toggleFullscreen failed:", err);
  }
}

function triggerHideUiPulse() {
  hideUiPulse.value = false;
  requestAnimationFrame(() => {
    hideUiPulse.value = true;
  });
}

function toggleContentUi() {
  triggerHideUiPulse();
  appearance.patchUiPreferences({
    contentUiHidden: !appearance.uiPreferences.contentUiHidden,
  });
}

function triggerSettingsSpin() {
  settingsSpinning.value = false;
  requestAnimationFrame(() => {
    settingsSpinning.value = true;
  });
}
</script>

<template>
  <header
    class="ui-bar relative z-[30] flex h-11 shrink-0 select-none items-stretch"
  >
    <div
      class="titlebar-drag flex min-w-0 flex-1 items-center gap-3 pl-4"
      data-tauri-drag-region
      @mousedown="startWindowDrag"
      @dblclick="onTitleBarDblClick"
    >
      <RouterLink
        to="/"
        data-no-drag
        class="titlebar-no-drag flex items-center no-underline"
        @mousedown.stop
        @click.stop
      >
        <span class="app-brand-title pointer-events-none">{{ APP_DISPLAY_NAME }}</span>
      </RouterLink>
      <span
        v-if="!isHome && route.meta.title"
        class="pointer-events-none truncate text-sm text-zinc-500"
      >
        / {{ route.meta.title }}
      </span>
    </div>

    <nav data-no-drag class="titlebar-no-drag relative z-20 flex shrink-0 items-stretch">
      <HeaderSkinBgm />
      <button
        v-if="isHome"
        type="button"
        class="chrome-icon-btn flex w-11 items-center justify-center text-zinc-400 transition hover:bg-white/5 hover:text-accent"
        :class="{ 'text-accent': contentUiHidden }"
        :aria-label="contentUiHidden ? '显示界面' : '隐藏界面'"
        @mousedown.stop
        @click.stop="toggleContentUi"
      >
        <Icon
          :icon="contentUiHidden ? 'mdi:eye-outline' : 'mdi:eye-off-outline'"
          class="pointer-events-none text-lg"
          :class="{ 'chrome-ui-hide': hideUiPulse }"
          @animationend="hideUiPulse = false"
        />
      </button>
      <RouterLink
        to="/settings"
        class="chrome-icon-btn flex w-11 items-center justify-center text-zinc-400 no-underline transition hover:bg-white/5 hover:text-accent"
        :class="{ 'text-accent': isSettings }"
        aria-label="设置"
        @mousedown.stop
        @click.stop="triggerSettingsSpin"
      >
        <Icon
          icon="mdi:cog-outline"
          class="pointer-events-none text-lg"
          :class="{ 'chrome-spin': settingsSpinning }"
          @animationend="settingsSpinning = false"
        />
      </RouterLink>
    </nav>

    <WindowControls />
  </header>
</template>

<style scoped>
.chrome-spin {
  animation: chrome-gear-spin 0.55s cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes chrome-gear-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.chrome-ui-hide {
  animation: chrome-ui-hide 0.45s cubic-bezier(0.34, 1.2, 0.64, 1);
}

@keyframes chrome-ui-hide {
  0% {
    transform: scale(1);
    opacity: 1;
  }
  40% {
    transform: scale(0.82);
    opacity: 0.45;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
