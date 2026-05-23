<script setup lang="ts">
import { computed } from "vue";
import { useAppearanceStore } from "../../stores/appearance";
import { isVideoSkinPath } from "../../utils/skinMedia";

const props = withDefaults(
  defineProps<{
    useDraft?: boolean;
  }>(),
  { useDraft: false },
);

const appearance = useAppearanceStore();

const skin = computed(() =>
  props.useDraft ? appearance.skinDraft : appearance.customSkin,
);

const isVideo = computed(() =>
  isVideoSkinPath(skin.value.backgroundImage) ||
  isVideoSkinPath(appearance.getSkinImageUrl(skin.value.backgroundImage)),
);

function onToggleKeep() {
  appearance.setKeepVideoAudio(!skin.value.keepVideoAudio, props.useDraft);
}
</script>

<template>
  <div
    v-if="isVideo"
    class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-black/20 px-3 py-2.5"
  >
    <label class="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
      <input
        type="checkbox"
        class="h-4 w-4 accent-[var(--color-accent)]"
        :checked="skin.keepVideoAudio"
        @change="onToggleKeep"
      />
      保留视频背景音
    </label>
    <div
      v-if="skin.keepVideoAudio"
      class="flex min-w-0 flex-1 items-center gap-2 sm:min-w-[10rem]"
    >
      <span class="shrink-0 text-xs text-zinc-500">音量</span>
      <input
        type="range"
        class="skin-slider min-w-0 flex-1 accent-[var(--color-accent)]"
        min="0"
        max="100"
        step="1"
        :value="appearance.skinPresetBgm.volume"
        @input="
          appearance.patchSkinPresetBgm({
            volume: Number(($event.target as HTMLInputElement).value),
          })
        "
      />
      <span class="w-9 shrink-0 text-right text-xs tabular-nums text-zinc-400">
        {{ appearance.skinPresetBgm.volume }}%
      </span>
    </div>
  </div>
</template>
