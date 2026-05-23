<script setup lang="ts">
import { computed } from "vue";
import { useAppearanceStore } from "../../stores/appearance";

const props = withDefaults(
  defineProps<{
    /** 皮肤编辑对话框内使用草稿 */
    useDraft?: boolean;
  }>(),
  { useDraft: false },
);

const appearance = useAppearanceStore();

const canPick = computed(() => appearance.canPickCustomSkinBgm(props.useDraft));

const bgm = computed(() =>
  props.useDraft ? appearance.skinDraft.bgm : appearance.customSkin.bgm,
);

const hasFile = computed(() => !!bgm.value.workspaceSubpath);

const trackLabel = computed(() => {
  if (!hasFile.value) return "";
  const t = bgm.value.title?.trim();
  const a = bgm.value.artist?.trim();
  if (t && a) return `${t} · ${a}`;
  return bgm.value.fileName ?? t ?? "本地音乐";
});
</script>

<template>
  <div class="space-y-3 rounded-xl border border-border bg-black/20 px-4 py-3">
    <div class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="!canPick"
        @click="appearance.pickCustomSkinBgm(props.useDraft)"
      >
        选择本地音乐
      </button>
      <button
        v-if="hasFile"
        type="button"
        class="rounded-lg border border-border px-3 py-2 text-sm text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
        @click="appearance.clearCustomSkinBgm(props.useDraft)"
      >
        清除
      </button>
    </div>
    <p v-if="hasFile" class="truncate text-xs text-zinc-500" :title="bgm.fileName ?? ''">
      {{ trackLabel }}
    </p>
    <p v-else-if="!canPick" class="text-xs text-amber-400/90">
      已开启「保留视频背景音」，请先关闭后再选择本地音乐
    </p>
    <p v-else class="text-xs text-zinc-500">支持 MP3、WAV、OGG、FLAC、M4A 等常见格式</p>

    <div v-if="hasFile" class="grid gap-3 sm:grid-cols-2">
      <label class="block text-sm text-zinc-400">
        歌名
        <input
          type="text"
          class="mt-1 w-full rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-accent/50"
          :value="bgm.title"
          placeholder="显示在顶栏"
          @input="
            appearance.patchCustomSkinBgmMeta(
              { title: ($event.target as HTMLInputElement).value },
              props.useDraft,
            )
          "
        />
      </label>
      <label class="block text-sm text-zinc-400">
        歌手
        <input
          type="text"
          class="mt-1 w-full rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-accent/50"
          :value="bgm.artist"
          placeholder="可选"
          @input="
            appearance.patchCustomSkinBgmMeta(
              { artist: ($event.target as HTMLInputElement).value },
              props.useDraft,
            )
          "
        />
      </label>
    </div>

    <div class="flex items-center justify-between gap-4 border-t border-border/60 pt-3">
      <span class="text-sm text-zinc-300">播放背景音乐</span>
      <button
        type="button"
        role="switch"
        class="relative h-7 w-12 shrink-0 rounded-full transition"
        :aria-checked="appearance.skinPresetBgm.enabled"
        :class="appearance.skinPresetBgm.enabled ? 'bg-accent' : 'bg-zinc-700'"
        :disabled="!hasFile"
        @click="
          appearance.patchSkinPresetBgm({
            enabled: !appearance.skinPresetBgm.enabled,
          })
        "
      >
        <span
          class="absolute top-0.5 block h-6 w-6 rounded-full bg-white shadow transition-transform"
          :class="
            appearance.skinPresetBgm.enabled ? 'translate-x-5' : 'translate-x-0.5'
          "
        />
      </button>
    </div>
    <div v-if="hasFile && appearance.skinPresetBgm.enabled" class="flex items-center gap-3">
      <label class="w-10 shrink-0 text-sm text-zinc-400">音量</label>
      <input
        type="range"
        class="min-w-0 flex-1 accent-[var(--color-accent)]"
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
      <span class="w-10 text-right text-xs tabular-nums text-zinc-400">
        {{ appearance.skinPresetBgm.volume }}%
      </span>
    </div>
  </div>
</template>
