<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  useAttrs,
  watch,
} from "vue";
import type { MediaContentRect, SkinWatermarkCover } from "../../utils/skinPresets";
import {
  applyContentRectScale,
  computeObjectFitContentRect,
  watermarkCoverAdaptiveStyle,
} from "../../utils/skinPresets";
import { isVideoSkinPath } from "../../utils/skinMedia";
import { pushMediaDebug } from "../../utils/mediaDebug";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    src: string | null;
    debugTag?: string;
    blur?: number;
    brightness?: number;
    scale?: number;
    fit?: "cover" | "contain";
    watermarkCover?: SkinWatermarkCover | null;
    videoMuted?: boolean;
    videoVolume?: number;
  }>(),
  {
    debugTag: "unknown",
    blur: 0,
    brightness: 100,
    scale: 1,
    fit: "cover",
    watermarkCover: null,
    videoMuted: true,
    videoVolume: 1,
  },
);

const attrs = useAttrs();
const rootRef = ref<HTMLElement | null>(null);
const videoRef = ref<HTMLVideoElement | null>(null);
const imageRef = ref<HTMLImageElement | null>(null);
const contentRect = ref<MediaContentRect | null>(null);
const resolvedSrc = ref<string | null>(props.src);
const encodedFallbackTried = ref(false);
const imageErrored = ref(false);

const isVideo = computed(() => isVideoSkinPath(resolvedSrc.value));

function debugLog(event: string, extra?: Record<string, unknown>) {
  const payload: Record<string, unknown> = {
    tag: props.debugTag,
    event,
    src: props.src,
    resolvedSrc: resolvedSrc.value,
    isVideo: isVideo.value,
    ...extra,
  };
  pushMediaDebug(`SkinBackdropMedia:${props.debugTag}`, event, payload);
}

const videoStyle = computed(() => ({
  filter: `blur(${props.blur}px) brightness(${props.brightness / 100})`,
  transform: `scale(${props.scale})`,
}));

const imageStyle = computed(() => {
  if (!resolvedSrc.value || isVideo.value) return {};
  return {
    filter: `blur(${props.blur}px) brightness(${props.brightness / 100})`,
    transform: `scale(${props.scale})`,
  };
});

const imageFallbackStyle = computed(() => {
  if (!resolvedSrc.value || isVideo.value) return {};
  return {
    filter: `blur(${props.blur}px) brightness(${props.brightness / 100})`,
    transform: `scale(${props.scale})`,
    backgroundImage: `url("${resolvedSrc.value}")`,
    backgroundSize: props.fit,
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  };
});

const watermarkStyle = computed(() => {
  if (!props.watermarkCover || !contentRect.value) return { display: "none" };
  return watermarkCoverAdaptiveStyle(props.watermarkCover, contentRect.value);
});

function sameRect(a: MediaContentRect | null, b: MediaContentRect | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.w - b.w) < 0.5 &&
    Math.abs(a.h - b.h) < 0.5
  );
}

let resizeObserver: ResizeObserver | undefined;
let lastMeasureKey = "";
let scheduled = false;
let rafId = 0;
/** 上次有效内容区，用于视频/容器瞬时 0 尺寸时保留水印位置（避免清空后无法恢复） */
let lastGoodContentRect: MediaContentRect | null = null;
let boundVideoEl: HTMLVideoElement | null = null;

function resetContentRectCache() {
  lastGoodContentRect = null;
  lastMeasureKey = "";
  contentRect.value = null;
}

function shouldRetainStaleContentRect(
  cw: number,
  ch: number,
  nextRect: MediaContentRect | null,
): boolean {
  if (nextRect || !lastGoodContentRect || !resolvedSrc.value) return false;
  if (cw <= 0 || ch <= 0) return true;
  if (isVideo.value) {
    const v = videoRef.value;
    if (!v || !v.videoWidth || !v.videoHeight) return true;
  } else if (imageRef.value) {
    const img = imageRef.value;
    if (!img.naturalWidth || !img.naturalHeight) return true;
  }
  return false;
}

function commitContentRect(nextRect: MediaContentRect | null, retainStale: boolean) {
  if (nextRect) {
    lastGoodContentRect = nextRect;
    if (!sameRect(contentRect.value, nextRect)) {
      contentRect.value = nextRect;
    }
    return;
  }
  if (retainStale && lastGoodContentRect) {
    if (!contentRect.value) {
      contentRect.value = lastGoodContentRect;
    }
    return;
  }
  lastGoodContentRect = null;
  if (!sameRect(contentRect.value, null)) {
    contentRect.value = null;
  }
}

function measureContentRect(force = false) {
  const root = rootRef.value;
  if (!root || !resolvedSrc.value) {
    resetContentRectCache();
    return;
  }

  const { width: cw, height: ch } = root.getBoundingClientRect();

  let key = `${Math.round(cw * 10) / 10}x${Math.round(ch * 10) / 10}|${props.fit}|${props.scale}|${resolvedSrc.value ?? ""}|${isVideo.value ? "video" : "image"}`;
  let nextRect: MediaContentRect | null = null;

  if (cw > 0 && ch > 0) {
    if (isVideo.value && videoRef.value) {
      const v = videoRef.value;
      const vw = v.videoWidth;
      const vh = v.videoHeight;
      key += `|${vw}x${vh}`;
      if (vw && vh) {
        const rect = computeObjectFitContentRect(cw, ch, vw, vh, props.fit);
        nextRect = rect ? applyContentRectScale(rect, props.scale) : null;
      }
    } else if (!isVideo.value && imageRef.value) {
      const img = imageRef.value;
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      key += `|${iw}x${ih}`;
      if (iw && ih) {
        const rect = computeObjectFitContentRect(cw, ch, iw, ih, props.fit);
        nextRect = rect ? applyContentRectScale(rect, props.scale) : null;
      }
    }
  }

  if (!force && key === lastMeasureKey) return;
  lastMeasureKey = key;

  commitContentRect(nextRect, shouldRetainStaleContentRect(cw, ch, nextRect));
}

function onVideoIntrinsicResize() {
  scheduleMeasure();
}

function scheduleMeasure(force = false) {
  if (scheduled) return;
  scheduled = true;
  void nextTick(() => {
    rafId = requestAnimationFrame(() => {
      scheduled = false;
      measureContentRect(force);
    });
  });
}

function bindVideoState(el: HTMLVideoElement | null) {
  if (boundVideoEl && boundVideoEl !== el) {
    boundVideoEl.removeEventListener("resize", onVideoIntrinsicResize);
    boundVideoEl = null;
  }
  if (!el) return;
  if (boundVideoEl !== el) {
    el.addEventListener("resize", onVideoIntrinsicResize);
    boundVideoEl = el;
  }
  el.muted = props.videoMuted;
  el.volume = Math.min(1, Math.max(0, props.videoVolume));
  // 无论是否静音都主动尝试播放，避免在部分 WebView 中停在黑帧
  void el.play().catch((err) => {
    debugLog("video-play-failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  });
}

function ensureVideoPlaying() {
  const v = videoRef.value;
  if (!v) return;
  void v.play().catch((err) => {
    debugLog("video-play-failed", {
      stage: "ensure",
      message: err instanceof Error ? err.message : String(err),
      paused: v.paused,
      currentTime: v.currentTime,
      readyState: v.readyState,
    });
  });
}

function maybeUseEncodedFallback() {
  const src = resolvedSrc.value;
  if (!src || encodedFallbackTried.value) return;
  if (src.startsWith("data:") || src.startsWith("blob:")) return;
  // convertFileSrc 产出的 URL 已编码，二次 encodeURI 会导致路径失效
  if (src.includes("asset.localhost") || src.startsWith("asset://")) {
    debugLog("skip-encoded-fallback");
    return;
  }
  const encoded = encodeURI(src);
  if (encoded === src) return;
  encodedFallbackTried.value = true;
  resolvedSrc.value = encoded;
  debugLog("apply-encoded-fallback", { encoded });
  scheduleMeasure(true);
}

onMounted(() => {
  debugLog("mounted");
  scheduleMeasure(true);
  resizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    const sizeKey = `${Math.round(entry.contentRect.width * 10) / 10}x${Math.round(entry.contentRect.height * 10) / 10}`;
    if (rootRef.value?.dataset.sizeKey === sizeKey) return;
    if (rootRef.value) rootRef.value.dataset.sizeKey = sizeKey;
    scheduleMeasure();
  });
  if (rootRef.value) resizeObserver.observe(rootRef.value);
});

onUnmounted(() => {
  debugLog("unmounted");
  resizeObserver?.disconnect();
  if (rafId) cancelAnimationFrame(rafId);
  boundVideoEl?.removeEventListener("resize", onVideoIntrinsicResize);
  boundVideoEl = null;
});

watch(
  () => [props.videoMuted, props.videoVolume, resolvedSrc.value] as const,
  () => bindVideoState(videoRef.value),
);

watch(videoRef, (el) => bindVideoState(el));

watch(
  () => [props.fit, props.scale, resolvedSrc.value, isVideo.value] as const,
  () => scheduleMeasure(true),
);

watch(
  () => props.src,
  (next) => {
    resolvedSrc.value = next;
    encodedFallbackTried.value = false;
    imageErrored.value = false;
    resetContentRectCache();
    debugLog("source-updated");
    scheduleMeasure(true);
  },
  { immediate: true },
);
</script>

<template>
  <div ref="rootRef" v-bind="attrs" class="relative h-full w-full overflow-hidden">
    <video
      v-if="resolvedSrc && isVideo"
      ref="videoRef"
      class="absolute inset-0 h-full w-full origin-center object-center"
      :class="fit === 'cover' ? 'object-cover' : 'object-contain'"
      :style="videoStyle"
      :src="resolvedSrc"
      autoplay
      loop
      playsinline
      preload="auto"
      :muted="videoMuted"
      @loadedmetadata="
        ensureVideoPlaying();
        scheduleMeasure(true);
        debugLog('video-loadedmetadata', {
          videoWidth: videoRef?.videoWidth ?? 0,
          videoHeight: videoRef?.videoHeight ?? 0,
          clientWidth: videoRef?.clientWidth ?? 0,
          clientHeight: videoRef?.clientHeight ?? 0,
          rootWidth: rootRef?.clientWidth ?? 0,
          rootHeight: rootRef?.clientHeight ?? 0,
          paused: videoRef?.paused ?? null,
          currentTime: videoRef?.currentTime ?? null,
          readyState: videoRef?.readyState ?? null,
        });
      "
      @canplay="
        ensureVideoPlaying();
        debugLog('video-canplay', {
          paused: videoRef?.paused ?? null,
          currentTime: videoRef?.currentTime ?? null,
          readyState: videoRef?.readyState ?? null,
        });
      "
      @playing="
        debugLog('video-playing', {
          paused: videoRef?.paused ?? null,
          currentTime: videoRef?.currentTime ?? null,
          readyState: videoRef?.readyState ?? null,
        });
      "
      @pause="
        debugLog('video-pause', {
          paused: videoRef?.paused ?? null,
          currentTime: videoRef?.currentTime ?? null,
          readyState: videoRef?.readyState ?? null,
        });
      "
      @error="
        debugLog('video-error', {
          mediaErrorCode: videoRef?.error?.code ?? null,
          mediaErrorMessage: videoRef?.error?.message ?? null,
        });
        maybeUseEncodedFallback();
      "
    />
    <img
      v-else-if="resolvedSrc"
      ref="imageRef"
      v-show="!imageErrored"
      class="absolute inset-0 h-full w-full origin-center object-center"
      :class="fit === 'cover' ? 'object-cover' : 'object-contain'"
      :style="imageStyle"
      :src="resolvedSrc"
      alt=""
      draggable="false"
      @load="
        scheduleMeasure(true);
        debugLog('image-load', {
          naturalWidth: imageRef?.naturalWidth ?? 0,
          naturalHeight: imageRef?.naturalHeight ?? 0,
          clientWidth: imageRef?.clientWidth ?? 0,
          clientHeight: imageRef?.clientHeight ?? 0,
          rootWidth: rootRef?.clientWidth ?? 0,
          rootHeight: rootRef?.clientHeight ?? 0,
        });
      "
      @error="
        debugLog('image-error');
        imageErrored = true;
        maybeUseEncodedFallback();
      "
    />
    <div
      v-if="resolvedSrc && !isVideo && imageErrored"
      class="absolute inset-0 origin-center"
      :style="imageFallbackStyle"
    />
    <div
      v-if="watermarkCover && contentRect"
      class="skin-watermark-cover"
      :style="watermarkStyle"
      aria-hidden="true"
    />
  </div>
</template>