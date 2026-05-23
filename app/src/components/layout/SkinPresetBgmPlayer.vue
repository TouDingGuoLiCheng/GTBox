<script setup lang="ts">
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useAppearanceStore } from "../../stores/appearance";

const appearance = useAppearanceStore();

const audioRef = ref<HTMLAudioElement | null>(null);
const bgmUrl = ref<string | null>(null);

const activeBgm = computed(() => appearance.activeSkinBgm());

const shouldPlay = computed(() => {
  if (appearance.colorScheme !== "custom") return false;
  if (!appearance.skinPresetBgm.enabled) return false;
  if (
    !appearance.skinPresetId &&
    appearance.customSkin.keepVideoAudio &&
    appearance.isCustomSkinVideoBackground(appearance.customSkin.backgroundImage)
  ) {
    return false;
  }
  return !!activeBgm.value?.workspaceSubpath && !!bgmUrl.value;
});

function bindPlayingState(el: HTMLAudioElement | null) {
  if (!el) {
    appearance.setSkinBgmPlaying(false);
    return;
  }
  const sync = () => {
    appearance.setSkinBgmPlaying(shouldPlay.value && !el.paused && !el.ended);
  };
  el.addEventListener("playing", sync);
  el.addEventListener("pause", sync);
  el.addEventListener("ended", sync);
  sync();
  return () => {
    el.removeEventListener("playing", sync);
    el.removeEventListener("pause", sync);
    el.removeEventListener("ended", sync);
  };
}

let unbindPlaying: (() => void) | undefined;

async function loadBgmUrl() {
  const subpath = activeBgm.value?.workspaceSubpath;
  if (!subpath) {
    bgmUrl.value = null;
    return;
  }
  try {
    const abs = await invoke<string>("workspaces_subpath", { subpath });
    bgmUrl.value = convertFileSrc(abs);
  } catch {
    bgmUrl.value = null;
  }
}

async function syncPlayback() {
  const el = audioRef.value;
  if (!el) return;

  el.volume = appearance.skinPresetBgm.volume / 100;
  el.loop = true;

  if (!shouldPlay.value) {
    el.pause();
    el.removeAttribute("src");
    appearance.setSkinBgmPlaying(false);
    return;
  }

  const url = bgmUrl.value;
  if (!url) return;
  if (el.src !== url) {
    el.src = url;
    el.load();
  }
  try {
    await el.play();
  } catch {
    appearance.setSkinBgmPlaying(false);
  }
}

function onVisibility() {
  const el = audioRef.value;
  if (!el) return;
  if (document.hidden) {
    el.pause();
  } else if (shouldPlay.value) {
    void syncPlayback();
  }
}

onMounted(async () => {
  await loadBgmUrl();
  unbindPlaying = bindPlayingState(audioRef.value);
  await syncPlayback();
  document.addEventListener("visibilitychange", onVisibility);
});

onUnmounted(() => {
  audioRef.value?.pause();
  unbindPlaying?.();
  appearance.setSkinBgmPlaying(false);
  document.removeEventListener("visibilitychange", onVisibility);
});

watch(audioRef, (el, prev) => {
  unbindPlaying?.();
  if (prev) appearance.setSkinBgmPlaying(false);
  unbindPlaying = bindPlayingState(el);
});

watch(
  () =>
    [
      appearance.skinPresetId,
      appearance.customSkin.keepVideoAudio,
      appearance.customSkin.bgm.workspaceSubpath,
      appearance.customSkin.bgm.title,
      appearance.customSkin.bgm.artist,
      appearance.skinBgmSyncNonce,
    ] as const,
  async () => {
    await loadBgmUrl();
    await syncPlayback();
  },
);

watch(
  () => appearance.skinBgmSyncNonce,
  () => {
    void syncPlayback();
  },
);

watch(
  () =>
    [appearance.skinPresetBgm.enabled, appearance.skinPresetBgm.volume, appearance.colorScheme] as const,
  () => {
    void syncPlayback();
  },
);
</script>

<template>
  <audio ref="audioRef" class="sr-only" preload="auto" />
</template>
