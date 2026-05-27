<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import OverlayBar from "./OverlayBar.vue";
import { OVERLAY_BAR_COUNT } from "../overlayLayout";
import {
  normalizeOverlayBgLayout,
  panLayoutByPixels,
  zoomLayoutByWheel,
} from "../overlayBgLayout";
import { overlayAppearanceFromSettings } from "../overlayTheme";
import type { OverlayBgLayout, SrSettings } from "../types";

const props = defineProps<{
  settings: Pick<
    SrSettings,
    | "appTheme"
    | "overlayOpacity"
    | "overlayBackground"
    | "overlayTextColor"
    | "overlayWaveColor"
  >;
  localImagePath?: string | null;
}>();

const layout = defineModel<OverlayBgLayout>("layout", { required: true });

const emit = defineEmits<{
  "hover-change": [inside: boolean];
}>();

const bgDataUrl = ref<string | null>(null);
const bgLoading = ref(false);
const previewRef = ref<HTMLElement | null>(null);
const dragging = ref(false);
const dragStart = ref({ x: 0, y: 0, layout: normalizeOverlayBgLayout() });
const pointerInside = ref(false);
const previewText = ref("你好，这是语音识别预览");
const demoLevels = ref(
  Array.from({ length: OVERLAY_BAR_COUNT }, (_, i) => 8 + (i % 5) * 3),
);

const appearance = computed(() =>
  overlayAppearanceFromSettings({
    ...props.settings,
    overlayBgLayout: layout.value,
  } as SrSettings),
);

const canEditBg = computed(() => !!bgDataUrl.value && !bgLoading.value);

async function loadBg() {
  if (props.localImagePath) {
    bgLoading.value = true;
    try {
      const url = await invoke<string | null>("read_image_data_url", {
        path: props.localImagePath,
      });
      bgDataUrl.value = url;
    } catch {
      bgDataUrl.value = null;
    } finally {
      bgLoading.value = false;
    }
    return;
  }
  if (!props.settings.overlayBackground?.trim()) {
    bgDataUrl.value = null;
    return;
  }
  bgLoading.value = true;
  try {
    bgDataUrl.value = await invoke<string | null>("get_overlay_background_data_url");
  } catch {
    bgDataUrl.value = null;
  } finally {
    bgLoading.value = false;
  }
}

function onPointerDown(e: PointerEvent) {
  if (!canEditBg.value) return;
  if (e.button !== 0) return;
  const t = e.target as HTMLElement;
  if (t.closest(".overlay-bar__close")) return;
  e.preventDefault();
  dragging.value = true;
  dragStart.value = { x: e.clientX, y: e.clientY, layout: { ...layout.value } };
  previewRef.value?.setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value || !previewRef.value) return;
  e.preventDefault();
  const rect = previewRef.value.getBoundingClientRect();
  const dx = e.clientX - dragStart.value.x;
  const dy = e.clientY - dragStart.value.y;
  layout.value = panLayoutByPixels(
    dragStart.value.layout,
    dx,
    dy,
    rect.width,
    rect.height,
  );
}

function onPointerUp(e: PointerEvent) {
  if (!dragging.value) return;
  dragging.value = false;
  try {
    previewRef.value?.releasePointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
}

function onWheel(e: WheelEvent) {
  if (!canEditBg.value || !pointerInside.value) return;
  e.preventDefault();
  e.stopPropagation();
  layout.value = zoomLayoutByWheel(layout.value, e.deltaY);
}

watch(
  () => [props.localImagePath, props.settings.overlayBackground],
  () => {
    void loadBg();
  },
);

onMounted(() => {
  void loadBg();
  previewRef.value?.addEventListener("wheel", onWheel, { passive: false });
});

onBeforeUnmount(() => {
  previewRef.value?.removeEventListener("wheel", onWheel);
});

defineExpose({ reloadBackground: loadBg });
</script>

<template>
  <div
    ref="previewRef"
    class="overlay-preview"
    :class="settings.appTheme === 'light' ? 'theme-light' : 'theme-dark'"
    @pointerenter="pointerInside = true; emit('hover-change', true)"
    @pointerleave="pointerInside = false; emit('hover-change', false)"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <OverlayBar
      v-model="previewText"
      :appearance="appearance"
      :background-data-url="bgDataUrl"
      :levels="demoLevels"
      phase="preview"
      :voice-active="true"
      :editable="false"
    />
    <p
      v-if="canEditBg"
      class="preview-hint"
    >
      拖动平移 · 滚轮缩放
    </p>
  </div>
</template>

<style scoped>
@import "../assets/theme.css";

.overlay-preview {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.preview-hint {
  margin: 6px 0 0;
  font-size: 0.65rem;
  color: var(--muted);
}
</style>
