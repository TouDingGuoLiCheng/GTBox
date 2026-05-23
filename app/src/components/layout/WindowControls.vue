<script setup lang="ts">
import { Icon } from "@iconify/vue";
import { isTauri } from "@tauri-apps/api/core";
import { onMounted, onUnmounted, ref } from "vue";
import {
  appWindow,
  isAppFullscreen,
  setAppFullscreen,
  toggleAppFullscreen,
} from "../../composables/useAppWindow";

const inTauri = isTauri();
const fullscreen = ref(false);
const minimizePulse = ref(false);
const maximizePulse = ref(false);
const closePulse = ref(false);

let unlistenResize: (() => void) | undefined;

function flash(target: typeof minimizePulse) {
  target.value = false;
  requestAnimationFrame(() => {
    target.value = true;
  });
}

async function syncFullscreenState() {
  fullscreen.value = await isAppFullscreen();
}

onMounted(async () => {
  const win = appWindow();
  if (!win) return;
  await syncFullscreenState();
  unlistenResize = await win.onResized(async () => {
    await syncFullscreenState();
  });
});

onUnmounted(() => {
  unlistenResize?.();
});

async function minimize() {
  const win = appWindow();
  if (!win) return;
  flash(minimizePulse);
  try {
    await win.minimize();
  } catch (err) {
    console.error("minimize failed:", err);
  }
}

async function toggleFullscreen() {
  flash(maximizePulse);
  try {
    await toggleAppFullscreen();
    await syncFullscreenState();
  } catch (err) {
    console.error("toggleFullscreen failed:", err);
  }
}

async function close() {
  const win = appWindow();
  if (!win) return;
  flash(closePulse);
  try {
    if (await isAppFullscreen()) {
      await setAppFullscreen(false);
    }
    await win.close();
  } catch (err) {
    console.error("close failed:", err);
  }
}
</script>

<template>
  <div
    v-if="inTauri"
    data-no-drag
    class="titlebar-no-drag relative z-20 flex h-full shrink-0 items-stretch"
  >
    <button
      type="button"
      class="chrome-icon-btn flex w-11 items-center justify-center text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100"
      aria-label="最小化"
      @mousedown.stop
      @click.stop="minimize"
    >
      <Icon
        icon="mdi:window-minimize"
        class="pointer-events-none text-sm"
        :class="{ 'chrome-minimize': minimizePulse }"
        @animationend="minimizePulse = false"
      />
    </button>
    <button
      type="button"
      class="chrome-icon-btn flex w-11 items-center justify-center text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100"
      :aria-label="fullscreen ? '退出全屏' : '全屏'"
      @mousedown.stop
      @click.stop="toggleFullscreen"
    >
      <Icon
        :icon="fullscreen ? 'mdi:fullscreen-exit' : 'mdi:fullscreen'"
        class="pointer-events-none text-sm"
        :class="{ 'chrome-maximize': maximizePulse }"
        @animationend="maximizePulse = false"
      />
    </button>
    <button
      type="button"
      class="chrome-icon-btn flex w-11 items-center justify-center text-zinc-400 transition hover:bg-red-500/90 hover:text-white"
      aria-label="关闭"
      @mousedown.stop
      @click.stop="close"
    >
      <Icon
        icon="mdi:close"
        class="pointer-events-none text-base"
        :class="{ 'chrome-close': closePulse }"
        @animationend="closePulse = false"
      />
    </button>
  </div>
</template>

<style scoped>
.chrome-minimize {
  animation: chrome-minimize 0.28s ease-out;
}

.chrome-maximize {
  animation: chrome-maximize 0.32s cubic-bezier(0.34, 1.4, 0.64, 1);
}

.chrome-close {
  animation: chrome-close 0.28s ease-out;
}

@keyframes chrome-minimize {
  0% {
    transform: translateY(0);
    opacity: 1;
  }
  45% {
    transform: translateY(3px);
    opacity: 0.5;
  }
  100% {
    transform: translateY(0);
    opacity: 1;
  }
}

@keyframes chrome-maximize {
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.2);
  }
  100% {
    transform: scale(1);
  }
}

@keyframes chrome-close {
  0% {
    transform: rotate(0deg) scale(1);
  }
  50% {
    transform: rotate(90deg) scale(1.1);
  }
  100% {
    transform: rotate(0deg) scale(1);
  }
}
</style>
