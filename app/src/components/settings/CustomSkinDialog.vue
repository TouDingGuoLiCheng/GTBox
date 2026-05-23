<script setup lang="ts">
import { Icon } from "@iconify/vue";
import { computed, useTemplateRef, watch } from "vue";
import SkinBackdropMedia from "../layout/SkinBackdropMedia.vue";
import {
  useAppearanceStore,
  type SkinFontColor,
  type TitleMaterial,
  type UiMaterial,
} from "../../stores/appearance";
import { SKIN_BACKGROUND_ACCEPT } from "../../utils/skinMedia";
import SkinBgmPanel from "./SkinBgmPanel.vue";
import SkinVideoAudioRow from "./SkinVideoAudioRow.vue";
import { isVideoSkinPath } from "../../utils/skinMedia";
import { pushMediaDebug } from "../../utils/mediaDebug";

const appearance = useAppearanceStore();
const fileInputRef = useTemplateRef<HTMLInputElement>("fileInput");

const draft = computed(() => appearance.skinDraft);
const previewUrl = computed(() =>
  appearance.getSkinImageUrl(draft.value.backgroundImage),
);

const previewWatermark = computed(() => {
  if (!appearance.skinPresetId) return null;
  return appearance.activeSkinPreset()?.watermark ?? null;
});

const bgSliders = [
  { key: "blur" as const, label: "模糊", min: 0, max: 24, step: 1, format: (v: number) => `${v}px` },
  { key: "maskOpacity" as const, label: "遮罩", min: 0, max: 100, step: 1, format: (v: number) => `${v}%` },
  { key: "brightness" as const, label: "亮度", min: 50, max: 150, step: 1, format: (v: number) => `${v}%` },
  { key: "scale" as const, label: "缩放", min: 1, max: 1.5, step: 0.01, format: (v: number) => `${v.toFixed(2)}x` },
];

const fontColorOptions: { id: SkinFontColor; label: string }[] = [
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" },
];

const cardMaterialOptions: { id: UiMaterial; label: string }[] = [
  { id: "glass", label: "毛玻璃" },
  { id: "acrylic", label: "亚克力" },
  { id: "frosted", label: "磨砂" },
  { id: "solid", label: "实心" },
];

const titleMaterialOptions: { id: TitleMaterial; label: string }[] = [
  { id: "glass", label: "毛玻璃" },
  { id: "acrylic", label: "亚克力" },
  { id: "frosted", label: "磨砂" },
  { id: "solid", label: "实心" },
  { id: "plain", label: "纯文字" },
];

const cardTuneSliders = [
  { key: "cardOpacity" as const, label: "透明度", min: 20, max: 95, step: 1, format: (v: number) => `${v}%` },
  { key: "cardBlur" as const, label: "模糊", min: 0, max: 32, step: 1, format: (v: number) => `${v}px` },
  { key: "cardBorderOpacity" as const, label: "描边", min: 0, max: 40, step: 1, format: (v: number) => `${v}%` },
];

const titleTuneSliders = [
  { key: "titleOpacity" as const, label: "底衬", min: 0, max: 90, step: 1, format: (v: number) => `${v}%` },
  { key: "titleBlur" as const, label: "模糊", min: 0, max: 24, step: 1, format: (v: number) => `${v}px` },
];

const previewMaskStyle = computed(() => ({
  backgroundColor: `rgba(0, 0, 0, ${draft.value.maskOpacity / 100})`,
}));

const previewTextClass = computed(() =>
  draft.value.fontColor === "light" ? "text-white" : "text-zinc-900",
);

const previewRgb = computed(() =>
  draft.value.fontColor === "light" ? "12, 12, 16" : "244, 244, 245",
);

const materialSceneMaskStyle = computed(() => ({
  backgroundColor: previewUrl.value
    ? `rgba(0, 0, 0, ${draft.value.maskOpacity / 100})`
    : "transparent",
}));

const previewCardStyle = computed(() => ({
  backgroundColor: `rgba(${previewRgb.value}, ${draft.value.cardOpacity / 100})`,
  backdropFilter: draft.value.cardBlur > 0 ? `blur(${draft.value.cardBlur}px)` : "none",
  WebkitBackdropFilter: draft.value.cardBlur > 0 ? `blur(${draft.value.cardBlur}px)` : "none",
  borderWidth: "1px",
  borderStyle: "solid",
  borderColor: `rgba(255,255,255,${draft.value.cardBorderOpacity / 100})`,
}));

const previewTitleStyle = computed(() => {
  if (draft.value.titleMaterial === "plain" || draft.value.titleOpacity <= 0) {
    return { textShadow: draft.value.titleTextShadow ? "0 1px 8px rgb(0 0 0 / 0.5)" : "none" };
  }
  return {
    backgroundColor: `rgba(${previewRgb.value}, ${draft.value.titleOpacity / 100})`,
    backdropFilter: draft.value.titleBlur > 0 ? `blur(${draft.value.titleBlur}px)` : "none",
    WebkitBackdropFilter: draft.value.titleBlur > 0 ? `blur(${draft.value.titleBlur}px)` : "none",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: `rgba(255,255,255,${Math.min(draft.value.cardBorderOpacity + 4, 30) / 100})`,
    textShadow: draft.value.titleTextShadow ? "0 1px 6px rgb(0 0 0 / 0.45)" : "none",
  };
});

const titleSlidersDisabled = computed(() => draft.value.titleMaterial === "plain");

const showCustomAudio = computed(() => !appearance.skinPresetId);

const draftIsVideo = computed(
  () =>
    isVideoSkinPath(draft.value.backgroundImage) ||
    isVideoSkinPath(previewUrl.value),
);

const showLocalBgm = computed(
  () => showCustomAudio.value && !draft.value.keepVideoAudio,
);

watch(
  () => [draft.value.backgroundImage, previewUrl.value] as const,
  ([backgroundImage, resolved]) => {
    const payload = {
      backgroundImage,
      previewUrl: resolved,
    };
    pushMediaDebug("CustomSkinDialog", "preview-source-updated", payload);
  },
  { immediate: true },
);

function onSlider(key: string, raw: string) {
  appearance.patchSkinDraft({ [key]: Number(raw) } as Partial<typeof draft.value>);
}

async function onPickImage() {
  try {
    await appearance.pickBackgroundImage();
  } catch {
    fileInputRef.value?.click();
  }
}

function onFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) appearance.setBackgroundFromFile(file);
  (event.target as HTMLInputElement).value = "";
}
</script>

<template>
  <Teleport to="body">
    <Transition name="skin-dialog">
      <div
        v-if="appearance.skinDialogOpen"
        class="fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto bg-black/55 p-3 backdrop-blur-sm sm:p-6"
        @click.self="appearance.closeSkinDialog()"
      >
        <div
          class="flex max-h-[min(720px,90dvh)] w-full max-w-[min(820px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-[#121214] shadow-2xl"
          role="dialog"
          aria-labelledby="custom-skin-title"
        >
          <header class="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
            <h2 id="custom-skin-title" class="text-base font-semibold text-zinc-100">
              自定义皮肤
            </h2>
            <button
              type="button"
              class="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/8 hover:text-zinc-200"
              aria-label="关闭"
              @click="appearance.closeSkinDialog()"
            >
              <Icon icon="mdi:close" class="text-xl" />
            </button>
          </header>

          <input
            ref="fileInput"
            type="file"
            :accept="SKIN_BACKGROUND_ACCEPT"
            class="hidden"
            @change="onFileChange"
          />

          <div class="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
            <!-- 左：背景 -->
            <div
              class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto border-border px-5 py-4 md:max-w-[52%] md:border-r md:px-6 md:py-5"
            >
              <div
                class="relative mb-4 aspect-video max-h-[min(220px,32dvh)] w-full shrink-0 overflow-hidden rounded-xl border border-white/10 bg-zinc-900"
              >
                <SkinBackdropMedia
                  v-if="previewUrl"
                  class="absolute inset-0"
                  :src="previewUrl"
                  :blur="draft.blur"
                  :brightness="draft.brightness"
                  :scale="draft.scale"
                  :watermark-cover="previewWatermark"
                  :video-muted="!draft.keepVideoAudio || !!appearance.skinPresetId"
                  :video-volume="appearance.skinPresetBgm.volume / 100"
                  debug-tag="skin-dialog-preview"
                  fit="contain"
                />
                <div v-else class="absolute inset-0 bg-gradient-to-br from-zinc-800 to-zinc-900" />
                <div class="absolute inset-0" :style="previewMaskStyle" />

                <button
                  type="button"
                  class="absolute inset-0 flex flex-col items-center justify-center gap-2 transition hover:bg-black/20"
                  @click="onPickImage()"
                >
                  <span
                    class="flex h-12 w-12 items-center justify-center rounded-full border border-white/30 bg-black/40 text-2xl text-white"
                  >
                    <Icon icon="mdi:plus" />
                  </span>
                  <span class="text-sm text-white/90">选择图片 / 视频</span>
                </button>

                <button
                  v-if="draft.backgroundImage"
                  type="button"
                  class="absolute right-3 top-3 rounded-lg bg-black/50 px-2.5 py-1 text-xs text-zinc-300 hover:bg-black/70"
                  @click.stop="appearance.clearBackgroundImage()"
                >
                  清除
                </button>

                <div
                  class="pointer-events-none absolute inset-x-0 bottom-0 p-4"
                  :class="previewTextClass"
                >
                  <p class="text-xs opacity-70">字体预览</p>
                  <p class="mt-1 text-base font-bold">GLC ToolBox</p>
                </div>
              </div>

              <div class="space-y-3.5">
                <div
                  v-for="field in bgSliders"
                  :key="field.key"
                  class="flex items-center gap-3"
                >
                  <label class="w-11 shrink-0 text-sm text-zinc-400">{{ field.label }}</label>
                  <input
                    type="range"
                    class="skin-slider min-w-0 flex-1"
                    :min="field.min"
                    :max="field.max"
                    :step="field.step"
                    :value="draft[field.key]"
                    @input="onSlider(field.key, ($event.target as HTMLInputElement).value)"
                  />
                  <span class="w-12 shrink-0 text-right text-xs tabular-nums text-zinc-400">
                    {{ field.format(draft[field.key]) }}
                  </span>
                </div>
              </div>

              <div class="mt-6">
                <p class="mb-3 text-sm text-zinc-400">字体颜色</p>
                <div class="grid grid-cols-2 gap-3">
                  <button
                    v-for="opt in fontColorOptions"
                    :key="opt.id"
                    type="button"
                    class="rounded-xl py-2.5 text-sm font-medium transition"
                    :class="
                      draft.fontColor === opt.id
                        ? 'bg-accent text-white'
                        : 'border border-border text-zinc-400 hover:border-zinc-600'
                    "
                    @click="appearance.patchSkinDraft({ fontColor: opt.id })"
                  >
                    {{ opt.label }}
                  </button>
                </div>
              </div>

              <div v-if="showCustomAudio" class="mt-5 space-y-3">
                <SkinVideoAudioRow v-if="draftIsVideo" use-draft />
                <div v-if="showLocalBgm">
                  <p class="mb-2 text-sm text-zinc-400">背景音乐（本地）</p>
                  <SkinBgmPanel use-draft />
                </div>
                <p
                  v-else-if="draftIsVideo && draft.keepVideoAudio"
                  class="text-xs text-zinc-500"
                >
                  已保留视频原声，无法同时导入本地音乐
                </p>
              </div>
            </div>

            <!-- 右：材质 -->
            <div class="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-4 md:px-6 md:py-5">
              <section class="mb-6">
                <div
                  class="relative aspect-video w-full max-h-[154px] shrink-0 overflow-hidden rounded-xl border border-white/10"
                >
                  <SkinBackdropMedia
                    v-if="previewUrl"
                    class="absolute inset-0"
                    :src="previewUrl"
                    :blur="Math.min(draft.blur, 8)"
                    :brightness="draft.brightness"
                    :scale="draft.scale"
                    debug-tag="skin-dialog-material-preview"
                    fit="cover"
                  />
                  <div
                    v-else
                    class="absolute inset-0 bg-gradient-to-br from-violet-600/80 via-fuchsia-500/70 to-amber-400/60"
                  />
                  <div class="absolute inset-0" :style="materialSceneMaskStyle" />

                  <div class="absolute inset-0 z-10 p-4">
                    <div
                      class="mb-3 inline-block rounded-lg px-3 py-1.5"
                      :style="previewTitleStyle"
                    >
                      <span class="text-sm font-semibold" :class="previewTextClass">工具</span>
                    </div>
                    <div class="rounded-2xl p-4" :style="previewCardStyle">
                      <p class="text-sm font-semibold" :class="previewTextClass">示例卡片</p>
                    </div>
                  </div>
                </div>
                <p v-if="!previewUrl" class="mt-2 text-xs text-zinc-500">
                  选择背景图或视频后可预览材质效果
                </p>
              </section>

              <section class="mb-6">
                <p class="mb-3 text-sm text-zinc-400">卡片材质</p>
                <div class="mb-4 flex flex-wrap gap-2">
                  <button
                    v-for="opt in cardMaterialOptions"
                    :key="opt.id"
                    type="button"
                    class="rounded-full border px-3.5 py-1.5 text-xs transition"
                    :class="
                      draft.cardMaterial === opt.id
                        ? 'border-accent bg-accent/15 text-accent'
                        : 'border-border text-zinc-400 hover:border-zinc-500'
                    "
                    @click="appearance.setCardMaterial(opt.id)"
                  >
                    {{ opt.label }}
                  </button>
                </div>
                <div class="space-y-3.5">
                  <div
                    v-for="field in cardTuneSliders"
                    :key="field.key"
                    class="flex items-center gap-3"
                  >
                    <label class="w-12 shrink-0 text-sm text-zinc-400">{{ field.label }}</label>
                    <input
                      type="range"
                      class="skin-slider min-w-0 flex-1"
                      :min="field.min"
                      :max="field.max"
                      :step="field.step"
                      :value="draft[field.key]"
                      @input="onSlider(field.key, ($event.target as HTMLInputElement).value)"
                    />
                    <span class="w-11 text-right text-xs tabular-nums text-zinc-400">
                      {{ field.format(draft[field.key]) }}
                    </span>
                  </div>
                </div>
              </section>

              <section class="mb-6">
                <p class="mb-3 text-sm text-zinc-400">标题材质</p>
                <div class="mb-4 flex flex-wrap gap-2">
                  <button
                    v-for="opt in titleMaterialOptions"
                    :key="opt.id"
                    type="button"
                    class="rounded-full border px-3.5 py-1.5 text-xs transition"
                    :class="
                      draft.titleMaterial === opt.id
                        ? 'border-accent bg-accent/15 text-accent'
                        : 'border-border text-zinc-400 hover:border-zinc-500'
                    "
                    @click="appearance.setTitleMaterial(opt.id)"
                  >
                    {{ opt.label }}
                  </button>
                </div>
                <div class="space-y-3.5">
                  <div
                    v-for="field in titleTuneSliders"
                    :key="field.key"
                    class="flex items-center gap-3"
                    :class="{ 'pointer-events-none opacity-40': titleSlidersDisabled }"
                  >
                    <label class="w-12 shrink-0 text-sm text-zinc-400">{{ field.label }}</label>
                    <input
                      type="range"
                      class="skin-slider min-w-0 flex-1"
                      :min="field.min"
                      :max="field.max"
                      :step="field.step"
                      :disabled="titleSlidersDisabled"
                      :value="draft[field.key]"
                      @input="onSlider(field.key, ($event.target as HTMLInputElement).value)"
                    />
                    <span class="w-11 text-right text-xs tabular-nums text-zinc-400">
                      {{ field.format(draft[field.key]) }}
                    </span>
                  </div>
                  <label class="flex cursor-pointer items-center gap-2.5 pt-1 text-sm text-zinc-400">
                    <input
                      type="checkbox"
                      class="h-4 w-4 rounded border-border"
                      :checked="draft.titleTextShadow"
                      @change="
                        appearance.patchSkinDraft({
                          titleTextShadow: ($event.target as HTMLInputElement).checked,
                        })
                      "
                    />
                    标题文字阴影
                  </label>
                </div>
              </section>

              <section>
                <p class="mb-3 text-sm text-zinc-400">强调色</p>
                <div class="flex items-center gap-3 rounded-xl border border-border bg-black/20 px-4 py-3">
                  <input
                    type="color"
                    :value="appearance.customColors.accent"
                    class="h-9 w-11 cursor-pointer rounded-lg border border-border bg-transparent p-0.5"
                    @input="
                      appearance.setCustomColor(
                        'accent',
                        ($event.target as HTMLInputElement).value,
                      )
                    "
                  />
                  <span class="font-mono text-sm text-zinc-400">
                    {{ appearance.customColors.accent }}
                  </span>
                </div>
              </section>
            </div>
          </div>

          <footer class="flex shrink-0 gap-3 border-t border-border px-6 py-4">
            <button
              type="button"
              class="flex-1 rounded-xl border border-border py-2.5 text-sm font-medium text-zinc-300 transition hover:bg-white/5"
              @click="appearance.closeSkinDialog()"
            >
              取消
            </button>
            <button
              type="button"
              class="flex-1 rounded-xl bg-accent py-2.5 text-sm font-medium text-white transition hover:brightness-110"
              @click="appearance.saveAndApplySkin()"
            >
              保存并使用
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.skin-slider {
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  border-radius: 9999px;
  background: rgb(255 255 255 / 0.12);
  outline: none;
}

.skin-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--color-accent);
  cursor: pointer;
  box-shadow: 0 0 0 2px rgb(0 0 0 / 0.25);
}

.skin-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: none;
  border-radius: 50%;
  background: var(--color-accent);
  cursor: pointer;
}

.skin-dialog-enter-active,
.skin-dialog-leave-active {
  transition: opacity 0.2s ease;
}

.skin-dialog-enter-active > div:last-child,
.skin-dialog-leave-active > div:last-child {
  transition: transform 0.22s ease, opacity 0.22s ease;
}

.skin-dialog-enter-from,
.skin-dialog-leave-to {
  opacity: 0;
}

.skin-dialog-enter-from > div:last-child,
.skin-dialog-leave-to > div:last-child {
  opacity: 0;
  transform: scale(0.97) translateY(6px);
}
</style>
