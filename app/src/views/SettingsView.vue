<script setup lang="ts">
import { Icon } from "@iconify/vue";
import { invoke } from "@tauri-apps/api/core";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import SkinBgmPanel from "../components/settings/SkinBgmPanel.vue";
import SkinVideoAudioRow from "../components/settings/SkinVideoAudioRow.vue";
import { pushMediaDebug } from "../utils/mediaDebug";
import {
  CREATIVE_BACKGROUND_OPTIONS,
  SKIN_PRESET_LIST,
  useAppearanceStore,
  type ColorScheme,
  type CornerRadius,
  type FontScale,
  type ToolGridCols,
} from "../stores/appearance";

const router = useRouter();
const appearance = useAppearanceStore();

interface AppSettings {
  workspaceRoot: string;
  pythonPath: string;
}

type SettingsSection =
  | "appearance"
  | "general"
  | "toolbox"
  | "shortcuts"
  | "about";

const sections: { id: SettingsSection; label: string; icon: string }[] = [
  { id: "appearance", label: "外观", icon: "mdi:palette-outline" },
  { id: "general", label: "常规", icon: "mdi:tune-variant" },
  { id: "toolbox", label: "工具箱", icon: "mdi:toolbox-outline" },
  { id: "shortcuts", label: "快捷键", icon: "mdi:keyboard-outline" },
  { id: "about", label: "关于", icon: "mdi:information-outline" },
];

const activeSection = ref<SettingsSection>("appearance");

const form = reactive<AppSettings>({
  workspaceRoot: "",
  pythonPath: ".venv\\Scripts\\python.exe",
});
const loading = ref(false);
const saving = ref(false);
const message = ref<string | null>(null);

const colorSchemeOptions: {
  id: ColorScheme;
  label: string;
  icon: string;
  preview: string;
}[] = [
  { id: "dark", label: "深色", icon: "mdi:moon-waning-crescent", preview: "#0f0f12" },
  { id: "light", label: "浅色", icon: "mdi:white-balance-sunny", preview: "#f4f4f5" },
  {
    id: "galaxy",
    label: "银河",
    icon: "mdi:image-filter-hdr",
    preview: "linear-gradient(135deg, #1a1030 0%, #4c3d8f 40%, #a5b4fc 100%)",
  },
  {
    id: "pixel",
    label: "像素",
    icon: "mdi:grid",
    preview:
      "repeating-conic-gradient(#5dbd4c 0% 25%, #4a9639 0% 50%) 0 0 / 16px 16px, linear-gradient(180deg, #5dbd4c, #866043)",
  },
  {
    id: "custom",
    label: "自定义",
    icon: "mdi:tshirt-crew-outline",
    preview: "linear-gradient(135deg, #0c4a6e 0%, #38bdf8 50%, #bae6fd 100%)",
  },
];

const togglePrefs = [
  { key: "pageAnimation" as const, label: "页面切换动效" },
  { key: "cardAnimation" as const, label: "卡片入场动效" },
];

const radiusOptions: { id: CornerRadius; label: string }[] = [
  { id: "compact", label: "紧凑" },
  { id: "standard", label: "标准" },
  { id: "rounded", label: "圆润" },
];

const fontScaleOptions: { id: FontScale; label: string }[] = [
  { id: "standard", label: "标准" },
  { id: "large", label: "较大" },
];

const gridColOptions: { id: ToolGridCols; label: string }[] = [
  { id: "auto", label: "自适应" },
  { id: "2", label: "两列" },
  { id: "3", label: "三列" },
];

const isCustom = computed(() => appearance.colorScheme === "custom");
const prefs = computed(() => appearance.uiPreferences);
const desktopPeekBlocked = computed(
  () =>
    appearance.colorScheme === "galaxy" ||
    (isCustom.value && !!appearance.customSkin.backgroundImage),
);
const desktopPeekBlockedHint = computed(() => {
  if (appearance.colorScheme === "galaxy") {
    return "银河主题已内置壁纸，无法开启透视桌面。";
  }
  return "已使用自定义壁纸，请先清除壁纸后再开启透视桌面。";
});
const creative = computed(() => appearance.creativeBackground);

const particleStarsPanelOpen = ref(false);
const asciiArtPanelOpen = ref(false);
const skinPresetBgmPanelOpen = ref(false);
const ps = computed(() => appearance.creativeBackground.particleStars);
const aa = computed(() => appearance.creativeBackground.asciiArt);
const asciiUploading = ref(false);
const asciiBusy = computed(
  () => appearance.asciiArtLoading || asciiUploading.value,
);

/** 播放帧率上限：不超过源 GIF 原始帧率（避免比原 GIF 更快） */
const asciiFpsMax = computed(() => {
  const native = appearance.asciiArtNativeFps;
  const src = appearance.asciiArtSourceFrames;
  if (native && native > 0) {
    return Math.max(1, Math.min(120, Math.ceil(native)));
  }
  if (src && src > 1) return Math.min(120, src);
  return 120;
});

/** 字符画滑块拖动时仅更新预览，松开鼠标后再写入并触发加载 */
const asciiDraft = reactive({
  cellSize: appearance.creativeBackground.asciiArt.cellSize,
  frameCount: appearance.creativeBackground.asciiArt.frameCount,
  wandTolerance: appearance.creativeBackground.asciiArt.wandTolerance,
  threshold: appearance.creativeBackground.asciiArt.threshold,
});

function syncAsciiDraftFromStore() {
  const s = appearance.creativeBackground.asciiArt;
  asciiDraft.cellSize = s.cellSize;
  asciiDraft.frameCount = s.frameCount;
  asciiDraft.wandTolerance = s.wandTolerance;
  asciiDraft.threshold = s.threshold;
}

watch(
  () => appearance.creativeBackground.asciiArt,
  () => syncAsciiDraftFromStore(),
  { deep: true },
);

type AsciiSliderKey = "cellSize" | "frameCount" | "wandTolerance" | "threshold";

function onAsciiRangeInput(key: AsciiSliderKey, el: HTMLInputElement) {
  asciiDraft[key] = Number(el.value);
}

function commitAsciiSlider(key: AsciiSliderKey) {
  if (key === "frameCount") {
    const max = asciiFpsMax.value;
    asciiDraft.frameCount = Math.min(max, Math.max(1, asciiDraft.frameCount));
  }
  appearance.patchCreativeBackground({
    asciiArt: { [key]: asciiDraft[key] },
  });
}

function patchParticleStars(
  starTrails?: boolean,
  showFlares?: boolean,
  transparentCards?: boolean,
  showMeteors?: boolean,
) {
  const patch: Record<string, boolean> = {};
  if (starTrails !== undefined) patch.starTrails = starTrails;
  if (showFlares !== undefined) patch.showFlares = showFlares;
  if (showMeteors !== undefined) patch.showMeteors = showMeteors;
  if (transparentCards !== undefined) patch.transparentCards = transparentCards;
  appearance.patchCreativeBackground({ particleStars: patch });
}

function onSchemeClick(scheme: ColorScheme) {
  if (scheme === "custom") {
    appearance.openSkinDialog();
    return;
  }
  appearance.setColorScheme(scheme);
}

async function loadSettings() {
  loading.value = true;
  message.value = null;
  try {
    const settings = await invoke<AppSettings>("get_settings");
    form.workspaceRoot = settings.workspaceRoot;
    form.pythonPath = settings.pythonPath;
  } catch (err) {
    message.value = `读取设置失败：${err instanceof Error ? err.message : String(err)}`;
  } finally {
    loading.value = false;
  }
}

async function saveSettings() {
  saving.value = true;
  message.value = null;
  try {
    await invoke("save_settings", { settings: form });
    message.value = "设置已保存";
    pushMediaDebug("Settings", "save-settings", {
      workspaceRoot: form.workspaceRoot,
      pythonPath: form.pythonPath,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    message.value = `保存失败：${errMsg}`;
    pushMediaDebug("Settings", "save-settings-failed", { error: errMsg });
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void loadSettings();
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div class="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-zinc-400 transition hover:bg-white/5 hover:text-accent"
        @click="router.push('/')"
      >
        <Icon icon="mdi:arrow-left" />
        返回
      </button>
      <h2 class="text-lg font-semibold text-zinc-100">设置</h2>
    </div>

    <div class="flex min-h-0 flex-1 overflow-hidden">
      <!-- 左侧分类导航 -->
      <aside class="w-44 shrink-0 overflow-y-auto border-r border-border py-4 pl-3 pr-2">
        <ul class="space-y-0.5">
          <li v-for="sec in sections" :key="sec.id">
            <button
              type="button"
              class="relative flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition"
              :class="
                activeSection === sec.id
                  ? 'bg-white/8 font-medium text-zinc-100'
                  : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
              "
              @click="activeSection = sec.id"
            >
              <span
                v-if="activeSection === sec.id"
                class="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent"
              />
              <Icon :icon="sec.icon" class="text-base opacity-80" />
              {{ sec.label }}
            </button>
          </li>
        </ul>
      </aside>

      <!-- 右侧内容区 -->
      <section class="min-w-0 flex-1 overflow-y-auto px-8 py-6">
        <!-- 外观 -->
        <div v-if="activeSection === 'appearance'" class="mx-auto max-w-2xl space-y-8">
          <div>
            <h3 class="mb-4 flex items-center gap-2 text-base font-semibold text-zinc-100">
              <span class="h-4 w-0.5 rounded-full bg-accent" />
              配色方案
            </h3>
            <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <button
                v-for="opt in colorSchemeOptions"
                :key="opt.id"
                type="button"
                class="group flex flex-col items-center gap-3 rounded-2xl border-2 px-4 py-5 transition"
                :class="
                  appearance.colorScheme === opt.id
                    ? 'border-accent bg-accent/8 shadow-[0_0_0_1px] shadow-accent/20'
                    : 'border-border bg-surface-elevated/50 hover:border-zinc-600'
                "
                @click="onSchemeClick(opt.id)"
              >
                <span
                  class="flex h-14 w-full items-center justify-center rounded-xl"
                  :style="{ background: opt.preview }"
                >
                  <Icon
                    :icon="opt.icon"
                    class="text-2xl"
                    :class="
                      opt.id === 'light'
                        ? 'text-zinc-700'
                        : opt.id === 'galaxy'
                          ? 'text-indigo-200'
                          : opt.id === 'pixel'
                            ? 'text-lime-100'
                            : opt.id === 'custom'
                              ? 'text-sky-50'
                              : 'text-zinc-300'
                    "
                  />
                </span>
                <span class="text-sm font-medium text-zinc-200">{{ opt.label }}</span>
              </button>
            </div>
          </div>

          <div>
            <h3 class="mb-4 flex items-center gap-2 text-base font-semibold text-zinc-100">
              <span class="h-4 w-0.5 rounded-full bg-accent" />
              视频皮肤预设
            </h3>
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div
                v-for="preset in SKIN_PRESET_LIST"
                :key="preset.id"
                class="relative"
              >
                <button
                  type="button"
                  class="w-full rounded-xl border-2 p-4 text-left transition"
                  :class="
                    appearance.skinPresetId === preset.id && isCustom
                      ? 'border-accent bg-accent/8'
                      : 'border-border bg-black/15 hover:border-zinc-600'
                  "
                  @click="
                    appearance.applySkinPreset(preset.id);
                    if (preset.bgmWorkspaceSubpath) skinPresetBgmPanelOpen = true;
                  "
                >
                  <span
                    class="text-sm font-medium"
                    :class="
                      appearance.skinPresetId === preset.id && isCustom
                        ? 'text-accent'
                        : 'text-zinc-200'
                    "
                  >
                    {{ preset.label }}
                  </span>
                </button>
                <button
                  v-if="preset.bgmWorkspaceSubpath"
                  type="button"
                  class="titlebar-no-drag absolute right-2 top-2 rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/10 hover:text-zinc-200"
                  :class="
                    skinPresetBgmPanelOpen &&
                    isCustom &&
                    appearance.skinPresetId === preset.id
                      ? 'bg-white/10 text-accent'
                      : ''
                  "
                  :title="`${preset.label}选项`"
                  @click.stop="skinPresetBgmPanelOpen = !skinPresetBgmPanelOpen"
                >
                  <Icon icon="mdi:tune-variant" class="text-lg" />
                </button>
              </div>
            </div>
            <div
              v-if="
                skinPresetBgmPanelOpen &&
                isCustom &&
                !!appearance.activeSkinPreset()?.bgmWorkspaceSubpath
              "
              class="space-y-3 rounded-xl border border-border bg-black/20 px-4 py-3"
            >
              <div class="flex items-center justify-between gap-4">
                <span class="text-sm text-zinc-300">背景音乐</span>
                <button
                  type="button"
                  role="switch"
                  class="relative h-7 w-12 shrink-0 rounded-full transition"
                  :aria-checked="appearance.skinPresetBgm.enabled"
                  :class="appearance.skinPresetBgm.enabled ? 'bg-accent' : 'bg-zinc-700'"
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
              <div
                v-if="appearance.skinPresetBgm.enabled"
                class="flex items-center gap-3"
              >
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
          </div>

          <div v-if="isCustom" class="space-y-3">
            <div
              class="flex items-center justify-between rounded-2xl border border-border bg-surface-elevated/60 px-5 py-4"
            >
              <p class="text-sm font-medium text-zinc-200">自定义皮肤</p>
              <button
                type="button"
                class="shrink-0 rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-sm text-accent transition hover:bg-accent/20"
                @click="appearance.openSkinDialog()"
              >
                编辑皮肤
              </button>
            </div>
            <template v-if="!appearance.skinPresetId">
              <SkinVideoAudioRow />
              <div
                v-if="
                  !appearance.customSkin.keepVideoAudio ||
                  !appearance.isCustomSkinVideoBackground(
                    appearance.customSkin.backgroundImage,
                    appearance.getSkinImageUrl(appearance.customSkin.backgroundImage),
                  )
                "
              >
                <p class="mb-2 text-sm text-zinc-400">背景音乐（本地）</p>
                <SkinBgmPanel />
              </div>
              <p
                v-else-if="
                  appearance.isCustomSkinVideoBackground(
                    appearance.customSkin.backgroundImage,
                    appearance.getSkinImageUrl(appearance.customSkin.backgroundImage),
                  )
                "
                class="text-xs text-zinc-500"
              >
                已保留视频原声，无法同时导入本地音乐
              </p>
            </template>
          </div>

          <div>
            <h3 class="mb-4 text-base font-semibold text-zinc-100">创意背景</h3>
            <div class="space-y-5 rounded-2xl border border-border bg-surface-elevated/40 p-5">
              <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div
                  v-for="opt in CREATIVE_BACKGROUND_OPTIONS"
                  :key="opt.id"
                  class="relative"
                >
                  <button
                    type="button"
                    class="w-full rounded-xl border-2 p-4 text-left transition"
                    :class="
                      creative.effect === opt.id
                        ? 'border-accent bg-accent/8'
                        : 'border-border bg-black/15 hover:border-zinc-600'
                    "
                    @click="
                      appearance.patchCreativeBackground({ effect: opt.id });
                      if (opt.id === 'particle-stars') particleStarsPanelOpen = true;
                      if (opt.id === 'ascii-art') asciiArtPanelOpen = true;
                    "
                  >
                    <span
                      class="text-sm font-medium"
                      :class="creative.effect === opt.id ? 'text-accent' : 'text-zinc-200'"
                    >
                      {{ opt.label }}
                    </span>
                  </button>
                  <button
                    v-if="opt.id === 'particle-stars' || opt.id === 'ascii-art'"
                    type="button"
                    class="titlebar-no-drag absolute right-2 top-2 rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/10 hover:text-zinc-200"
                    :class="
                      (opt.id === 'particle-stars' && particleStarsPanelOpen) ||
                      (opt.id === 'ascii-art' && asciiArtPanelOpen)
                        ? 'bg-white/10 text-accent'
                        : ''
                    "
                    :title="opt.id === 'ascii-art' ? '字符画选项' : '粒子星辰选项'"
                    @click.stop="
                      opt.id === 'particle-stars'
                        ? (particleStarsPanelOpen = !particleStarsPanelOpen)
                        : (asciiArtPanelOpen = !asciiArtPanelOpen)
                    "
                  >
                    <Icon icon="mdi:tune-variant" class="text-lg" />
                  </button>
                </div>
              </div>
              <div
                v-if="particleStarsPanelOpen && creative.effect === 'particle-stars'"
                class="space-y-3 rounded-xl border border-border bg-black/20 px-4 py-3"
              >
                <label
                  class="flex cursor-pointer items-center justify-between gap-3 text-sm text-zinc-300"
                >
                  <span>开启星轨</span>
                  <input
                    type="checkbox"
                    class="h-4 w-4 accent-[var(--color-accent)]"
                    :checked="ps.starTrails"
                    @change="
                      patchParticleStars(($event.target as HTMLInputElement).checked)
                    "
                  />
                </label>
                <label
                  class="flex cursor-pointer items-center justify-between gap-3 text-sm text-zinc-300"
                >
                  <span>十字星芒</span>
                  <input
                    type="checkbox"
                    class="h-4 w-4 accent-[var(--color-accent)]"
                    :checked="ps.showFlares"
                    @change="
                      patchParticleStars(undefined, ($event.target as HTMLInputElement).checked)
                    "
                  />
                </label>
                <label
                  class="flex cursor-pointer items-center justify-between gap-3 text-sm text-zinc-300"
                >
                  <span>流星</span>
                  <input
                    type="checkbox"
                    class="h-4 w-4 accent-[var(--color-accent)]"
                    :checked="ps.showMeteors"
                    @change="
                      patchParticleStars(
                        undefined,
                        undefined,
                        undefined,
                        ($event.target as HTMLInputElement).checked,
                      )
                    "
                  />
                </label>
                <label
                  class="flex cursor-pointer items-center justify-between gap-3 text-sm text-zinc-300"
                >
                  <span>卡片透明</span>
                  <input
                    type="checkbox"
                    class="h-4 w-4 accent-[var(--color-accent)]"
                    :checked="ps.transparentCards"
                    @change="
                      patchParticleStars(
                        undefined,
                        undefined,
                        ($event.target as HTMLInputElement).checked,
                      )
                    "
                  />
                </label>
              </div>
              <div
                v-if="asciiArtPanelOpen && creative.effect === 'ascii-art'"
                class="space-y-4 rounded-xl border border-border bg-black/20 px-4 py-3"
              >
                <div
                  v-if="asciiBusy"
                  class="space-y-1.5 rounded-lg border border-border/80 bg-black/30 px-3 py-2.5"
                >
                  <div class="flex items-center justify-between text-xs">
                    <span class="text-zinc-300">正在生成字符画…</span>
                    <span class="tabular-nums text-zinc-500">
                      {{ appearance.asciiArtProgress }}%
                    </span>
                  </div>
                  <div class="h-1.5 overflow-hidden rounded-full bg-zinc-700/80">
                    <div
                      class="h-full rounded-full bg-accent transition-[width] duration-150 ease-out"
                      :style="{ width: `${Math.max(4, appearance.asciiArtProgress)}%` }"
                    />
                  </div>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    class="titlebar-no-drag rounded-lg border border-border bg-black/25 px-3 py-2 text-sm text-zinc-200 transition hover:border-accent/50 hover:text-accent disabled:opacity-50"
                    :disabled="asciiBusy"
                    @click="
                      asciiUploading = true;
                      appearance.pickAsciiArtSource().finally(() => (asciiUploading = false));
                    "
                  >
                    {{ asciiBusy ? "处理中…" : "上传图片 / GIF / 视频" }}
                  </button>
                  <button
                    v-if="aa.sourceSubpath"
                    type="button"
                    class="titlebar-no-drag rounded-lg border border-border bg-black/25 px-3 py-2 text-sm text-zinc-200 transition hover:border-accent/50 hover:text-accent disabled:opacity-50"
                    :disabled="asciiBusy"
                    @click="appearance.refreshAsciiArt()"
                  >
                    刷新
                  </button>
                  <button
                    v-if="aa.sourceSubpath"
                    type="button"
                    class="titlebar-no-drag rounded-lg px-3 py-2 text-sm text-zinc-400 transition hover:text-zinc-200"
                    @click="appearance.clearAsciiArtSource()"
                  >
                    清除
                  </button>
                </div>
                <p v-if="aa.fileName" class="truncate text-xs text-zinc-500">
                  {{ aa.fileName }}
                </p>
                <div class="flex items-center gap-3">
                  <label class="w-14 shrink-0 text-sm text-zinc-400">格子</label>
                  <input
                    type="range"
                    class="min-w-0 flex-1 accent-[var(--color-accent)]"
                    min="4"
                    max="14"
                    step="1"
                    :disabled="asciiBusy"
                    :value="asciiDraft.cellSize"
                    @input="onAsciiRangeInput('cellSize', $event.target as HTMLInputElement)"
                    @change="commitAsciiSlider('cellSize')"
                  />
                  <span class="w-10 text-right text-xs tabular-nums text-zinc-400">
                    {{ asciiDraft.cellSize }}px
                  </span>
                </div>
                <div class="flex items-center gap-3">
                  <label class="w-14 shrink-0 text-sm text-zinc-400">帧率</label>
                  <input
                    type="range"
                    class="min-w-0 flex-1 accent-[var(--color-accent)]"
                    min="1"
                    :max="asciiFpsMax"
                    step="1"
                    :disabled="asciiBusy"
                    :value="Math.min(asciiDraft.frameCount, asciiFpsMax)"
                    @input="onAsciiRangeInput('frameCount', $event.target as HTMLInputElement)"
                    @change="commitAsciiSlider('frameCount')"
                  />
                  <span class="w-12 text-right text-xs tabular-nums text-zinc-400">
                    {{ Math.min(asciiDraft.frameCount, asciiFpsMax) }}fps
                  </span>
                </div>
                <div class="flex items-center gap-3">
                  <label class="w-14 shrink-0 text-sm text-zinc-400">魔棒</label>
                  <input
                    type="range"
                    class="min-w-0 flex-1 accent-[var(--color-accent)]"
                    min="8"
                    max="96"
                    step="1"
                    :disabled="asciiBusy"
                    :value="asciiDraft.wandTolerance"
                    @input="onAsciiRangeInput('wandTolerance', $event.target as HTMLInputElement)"
                    @change="commitAsciiSlider('wandTolerance')"
                  />
                  <span class="w-10 text-right text-xs tabular-nums text-zinc-400">
                    {{ asciiDraft.wandTolerance }}
                  </span>
                </div>
                <div class="flex items-center gap-3">
                  <label class="w-14 shrink-0 text-sm text-zinc-400">阈值</label>
                  <input
                    type="range"
                    class="min-w-0 flex-1 accent-[var(--color-accent)]"
                    min="0"
                    max="255"
                    step="1"
                    :disabled="asciiBusy"
                    :value="asciiDraft.threshold"
                    @input="onAsciiRangeInput('threshold', $event.target as HTMLInputElement)"
                    @change="commitAsciiSlider('threshold')"
                  />
                  <span class="w-10 text-right text-xs tabular-nums text-zinc-400">
                    {{ asciiDraft.threshold }}
                  </span>
                </div>
                <label
                  class="flex cursor-pointer items-center justify-between gap-3 text-sm text-zinc-300"
                >
                  <span>反相（亮区显示为 0）</span>
                  <input
                    type="checkbox"
                    class="h-4 w-4 accent-[var(--color-accent)]"
                    :disabled="asciiBusy"
                    :checked="aa.invert"
                    @change="
                      appearance.patchCreativeBackground({
                        asciiArt: {
                          invert: ($event.target as HTMLInputElement).checked,
                        },
                      })
                    "
                  />
                </label>
              </div>
              <div v-if="creative.effect !== 'none'" class="border-t border-border pt-4">
                <div class="flex items-center gap-3">
                  <label class="w-14 shrink-0 text-sm text-zinc-400">强度</label>
                  <input
                    type="range"
                    class="min-w-0 flex-1 accent-[var(--color-accent)]"
                    min="10"
                    max="200"
                    step="1"
                    :value="creative.intensity"
                    @input="
                      appearance.patchCreativeBackground({
                        intensity: Number(($event.target as HTMLInputElement).value),
                      })
                    "
                  />
                  <span class="w-10 text-right text-xs tabular-nums text-zinc-400">
                    {{ creative.intensity }}%
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h3 class="mb-4 text-base font-semibold text-zinc-100">界面偏好</h3>

            <div class="space-y-6 rounded-2xl border border-border bg-surface-elevated/40 p-5">
              <div class="space-y-4 border-b border-border pb-5">
                <div class="flex items-center justify-between gap-4">
                  <p class="text-sm text-zinc-300">透视桌面</p>
                  <button
                    type="button"
                    role="switch"
                    class="relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-40"
                    :aria-checked="prefs.desktopPeek"
                    :disabled="desktopPeekBlocked"
                    :class="prefs.desktopPeek ? 'bg-accent' : 'bg-zinc-700'"
                    @click="
                      appearance.patchUiPreferences({
                        desktopPeek: !prefs.desktopPeek,
                      })
                    "
                  >
                    <span
                      class="absolute top-0.5 block h-6 w-6 rounded-full bg-white shadow transition-transform"
                      :class="prefs.desktopPeek ? 'translate-x-5' : 'translate-x-0.5'"
                    />
                  </button>
                </div>
                <div
                  v-if="prefs.desktopPeek && !desktopPeekBlocked"
                  class="flex items-center gap-3"
                >
                  <label class="w-14 shrink-0 text-sm text-zinc-400">透视度</label>
                  <input
                    type="range"
                    class="min-w-0 flex-1 accent-[var(--color-accent)]"
                    min="1"
                    max="100"
                    step="1"
                    :value="prefs.desktopPeekAmount"
                    @input="
                      appearance.patchUiPreferences({
                        desktopPeekAmount: Number(
                          ($event.target as HTMLInputElement).value,
                        ),
                      })
                    "
                  />
                  <span class="w-10 text-right text-xs tabular-nums text-zinc-400">
                    {{ prefs.desktopPeekAmount }}%
                  </span>
                </div>
                <div
                  v-if="prefs.desktopPeek && !desktopPeekBlocked"
                  class="flex items-center justify-between gap-4"
                >
                  <p class="text-sm text-zinc-300">透视时隐藏创意背景</p>
                  <button
                    type="button"
                    role="switch"
                    class="relative h-7 w-12 shrink-0 rounded-full transition"
                    :aria-checked="prefs.desktopPeekHideCreative"
                    :class="prefs.desktopPeekHideCreative ? 'bg-accent' : 'bg-zinc-700'"
                    @click="
                      appearance.patchUiPreferences({
                        desktopPeekHideCreative: !prefs.desktopPeekHideCreative,
                      })
                    "
                  >
                    <span
                      class="absolute top-0.5 block h-6 w-6 rounded-full bg-white shadow transition-transform"
                      :class="
                        prefs.desktopPeekHideCreative ? 'translate-x-5' : 'translate-x-0.5'
                      "
                    />
                  </button>
                </div>
                <p v-if="desktopPeekBlocked" class="text-xs text-amber-400/90">
                  {{ desktopPeekBlockedHint }}
                </p>
              </div>

              <div class="space-y-4">
                <div
                  v-for="item in togglePrefs"
                  :key="item.key"
                  class="flex items-center justify-between gap-4"
                >
                  <span class="text-sm text-zinc-300">{{ item.label }}</span>
                  <button
                    type="button"
                    role="switch"
                    class="relative h-7 w-12 shrink-0 rounded-full transition"
                    :aria-checked="prefs[item.key]"
                    :class="prefs[item.key] ? 'bg-accent' : 'bg-zinc-700'"
                    @click="appearance.patchUiPreferences({ [item.key]: !prefs[item.key] })"
                  >
                    <span
                      class="absolute top-0.5 block h-6 w-6 rounded-full bg-white shadow transition-transform"
                      :class="prefs[item.key] ? 'translate-x-5' : 'translate-x-0.5'"
                    />
                  </button>
                </div>
              </div>

              <div class="border-t border-border pt-5">
                <p class="mb-3 text-sm text-zinc-400">圆角风格</p>
                <div class="flex rounded-xl bg-black/30 p-1">
                  <button
                    v-for="opt in radiusOptions"
                    :key="opt.id"
                    type="button"
                    class="flex-1 rounded-lg py-2.5 text-sm transition"
                    :class="
                      prefs.cornerRadius === opt.id
                        ? 'bg-surface-elevated font-medium text-zinc-100 ring-1 ring-white/10'
                        : 'text-zinc-500 hover:text-zinc-300'
                    "
                    @click="appearance.patchUiPreferences({ cornerRadius: opt.id })"
                  >
                    {{ opt.label }}
                  </button>
                </div>
              </div>

              <div class="border-t border-border pt-5">
                <p class="mb-3 text-sm text-zinc-400">文字大小</p>
                <div class="flex rounded-xl bg-black/30 p-1">
                  <button
                    v-for="opt in fontScaleOptions"
                    :key="opt.id"
                    type="button"
                    class="flex-1 rounded-lg py-2.5 text-sm transition"
                    :class="
                      prefs.fontScale === opt.id
                        ? 'bg-surface-elevated font-medium text-zinc-100 ring-1 ring-white/10'
                        : 'text-zinc-500 hover:text-zinc-300'
                    "
                    @click="appearance.patchUiPreferences({ fontScale: opt.id })"
                  >
                    {{ opt.label }}
                  </button>
                </div>
              </div>

              <div class="border-t border-border pt-5">
                <p class="mb-3 text-sm text-zinc-400">首页工具列数</p>
                <div class="flex rounded-xl bg-black/30 p-1">
                  <button
                    v-for="opt in gridColOptions"
                    :key="opt.id"
                    type="button"
                    class="flex-1 rounded-lg py-2.5 text-sm transition"
                    :class="
                      prefs.toolGridCols === opt.id
                        ? 'bg-surface-elevated font-medium text-zinc-100 ring-1 ring-white/10'
                        : 'text-zinc-500 hover:text-zinc-300'
                    "
                    @click="appearance.patchUiPreferences({ toolGridCols: opt.id })"
                  >
                    {{ opt.label }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 常规 -->
        <div v-else-if="activeSection === 'general'" class="mx-auto max-w-xl space-y-5">
          <h3 class="mb-2 flex items-center gap-2 text-base font-semibold text-zinc-100">
            <span class="h-4 w-0.5 rounded-full bg-accent" />
            运行环境
          </h3>
          <div class="rounded-2xl border border-border bg-surface-elevated/60 p-6 space-y-5">
            <p v-if="loading" class="text-sm text-zinc-400">正在读取设置...</p>
            <div>
              <label class="mb-1.5 block text-sm text-zinc-400">工作区根目录</label>
              <input
                v-model="form.workspaceRoot"
                type="text"
                class="w-full rounded-lg border border-border bg-black/20 px-3 py-2 text-sm text-zinc-300"
              />
            </div>
            <div>
              <label class="mb-1.5 block text-sm text-zinc-400">Python 解释器</label>
              <input
                v-model="form.pythonPath"
                type="text"
                class="w-full rounded-lg border border-border bg-black/20 px-3 py-2 text-sm text-zinc-300"
              />
            </div>
            <div class="border-t border-border pt-4 space-y-3">
              <div class="flex items-center justify-between gap-4">
                <div>
                  <p class="text-sm text-zinc-300">显示媒体调试终端</p>
                  <p class="text-xs text-zinc-500">右下角实时显示主题媒体加载日志</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  class="relative h-7 w-12 shrink-0 rounded-full transition"
                  :aria-checked="prefs.mediaDebugOverlay"
                  :class="prefs.mediaDebugOverlay ? 'bg-accent' : 'bg-zinc-700'"
                  @click="
                    appearance.patchUiPreferences({
                      mediaDebugOverlay: !prefs.mediaDebugOverlay,
                    })
                  "
                >
                  <span
                    class="absolute top-0.5 block h-6 w-6 rounded-full bg-white shadow transition-transform"
                    :class="prefs.mediaDebugOverlay ? 'translate-x-5' : 'translate-x-0.5'"
                  />
                </button>
              </div>
              <div class="flex items-center justify-between gap-4">
                <div>
                  <p class="text-sm text-zinc-300">禁用主题遮罩与滤镜（诊断）</p>
                  <p class="text-xs text-zinc-500">临时关闭背景模糊/亮度/遮罩/缩放，仅显示原图或原视频</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  class="relative h-7 w-12 shrink-0 rounded-full transition"
                  :aria-checked="prefs.disableSkinFxForDebug"
                  :class="prefs.disableSkinFxForDebug ? 'bg-accent' : 'bg-zinc-700'"
                  @click="
                    appearance.patchUiPreferences({
                      disableSkinFxForDebug: !prefs.disableSkinFxForDebug,
                    })
                  "
                >
                  <span
                    class="absolute top-0.5 block h-6 w-6 rounded-full bg-white shadow transition-transform"
                    :class="prefs.disableSkinFxForDebug ? 'translate-x-5' : 'translate-x-0.5'"
                  />
                </button>
              </div>
            </div>
            <button
              type="button"
              class="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="saving"
              @click="saveSettings"
            >
              {{ saving ? "保存中..." : "保存设置" }}
            </button>
            <p v-if="message" class="text-sm text-zinc-400">{{ message }}</p>
          </div>
        </div>

        <!-- 占位 -->
        <div
          v-else
          class="mx-auto flex max-w-md flex-col items-center justify-center py-24 text-center"
        >
          <Icon icon="mdi:hammer-wrench" class="mb-4 text-5xl text-zinc-600" />
          <p class="text-sm text-zinc-400">此分类功能开发中，敬请期待。</p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
