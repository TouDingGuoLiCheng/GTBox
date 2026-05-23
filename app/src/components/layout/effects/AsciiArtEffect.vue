<script setup lang="ts">
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useAppearanceStore } from "../../../stores/appearance";
import {
  buildAsciiFramesFromUrl,
  buildPlaceholderFrame,
  fontSizeForCell,
  opacityFromIntensity,
  type AsciiFrameLayout,
  type DecodedAsciiFrames,
} from "../../../utils/asciiArt";

const props = withDefaults(
  defineProps<{
    theme?: "dark" | "light";
    intensity?: number;
    sourceSubpath?: string | null;
    threshold?: number;
    invert?: boolean;
    frameCount?: number;
    refreshNonce?: number;
    wandTolerance?: number;
    cellSize?: number;
  }>(),
  {
    theme: "dark",
    intensity: 80,
    sourceSubpath: null,
    threshold: 128,
    invert: false,
    frameCount: 24,
    refreshNonce: 0,
    wandTolerance: 36,
    cellSize: 6,
  },
);

const canvasRef = ref<HTMLCanvasElement | null>(null);

let raf = 0;
let viewW = 0;
let viewH = 0;
let ctx2d: CanvasRenderingContext2D | null = null;
let decoded: DecodedAsciiFrames | null = null;
let frameIndex = 0;
let frameElapsed = 0;
let lastTs = 0;
let loadGen = 0;
let cacheGen = 0;

/** 每帧预渲染到离屏 Canvas，贴图到主画布（避免 createImageBitmap 兼容问题） */
let frameCanvasCaches: HTMLCanvasElement[] = [];

function disposeCaches() {
  frameCanvasCaches = [];
}

function syncMainContext() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx2d = canvas.getContext("2d");
  if (ctx2d) {
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function buildParams() {
  return {
    viewW,
    viewH,
    cellSize: props.cellSize,
    threshold: props.threshold,
    invert: props.invert,
    frameCount: props.frameCount,
    wandTolerance: props.wandTolerance,
  };
}

async function resolveMediaUrl(subpath: string): Promise<string> {
  const abs = await invoke<string>("workspaces_subpath", { subpath });
  return convertFileSrc(abs);
}

function renderLayoutToOffscreen(layout: AsciiFrameLayout): HTMLCanvasElement | null {
  if (viewW < 1 || viewH < 1) return null;
  const oc = document.createElement("canvas");
  oc.width = viewW;
  oc.height = viewH;
  const ctx = oc.getContext("2d");
  if (!ctx) return null;

  const fontSize = fontSizeForCell(props.cellSize);
  ctx.font = `${fontSize}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const { cols, rows, cells } = layout;
  const cellPx = props.cellSize;
  const gridW = cols * cellPx;
  const gridH = rows * cellPx;
  const offsetX = (viewW - gridW) / 2;
  const offsetY = (viewH - gridH) / 2;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = cells[r * cols + c];
      if (!cell) continue;
      ctx.fillStyle = cell.color;
      ctx.fillText(
        cell.ch,
        offsetX + c * cellPx + cellPx / 2,
        offsetY + r * cellPx + cellPx / 2,
      );
    }
  }

  return oc;
}

async function precomputeFrameCaches(
  onProgress?: (ratio: number) => void,
) {
  if (!decoded?.frames.length) {
    frameCanvasCaches = [];
    return;
  }

  const gen = ++cacheGen;
  const caches: HTMLCanvasElement[] = [];
  const total = decoded.frames.length;
  for (let i = 0; i < total; i++) {
    if (gen !== cacheGen) return;
    const oc = renderLayoutToOffscreen(decoded.frames[i]);
    if (oc) caches.push(oc);
    onProgress?.((i + 1) / total);
    if (total > 3 && i % 2 === 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }
  if (gen !== cacheGen) return;
  frameCanvasCaches = caches;
}

function blitToMainCanvas() {
  const canvas = canvasRef.value;
  if (!canvas || viewW < 1 || viewH < 1) return;
  syncMainContext();
  const ctx = ctx2d;
  if (!ctx) return;

  const src = frameCanvasCaches[frameIndex];
  ctx.clearRect(0, 0, viewW, viewH);
  if (!src) return;

  const alpha = opacityFromIntensity(props.intensity);
  ctx.globalAlpha = alpha;
  ctx.drawImage(src, 0, 0, viewW, viewH);
  ctx.globalAlpha = 1;
}

function finishRebuild(gen: number) {
  if (gen !== loadGen) return;
  const appearance = useAppearanceStore();
  frameIndex = 0;
  frameElapsed = 0;
  lastTs = 0;

  appearance.setAsciiArtLoading(true, 92);

  requestAnimationFrame(() => {
    if (gen !== loadGen) return;
    blitToMainCanvas();
    if (decoded?.isAnimated) {
      startLoop();
    } else {
      stopLoop();
    }
    appearance.setAsciiArtLoading(false, 100);
  });
}

async function rebuildFrames() {
  const gen = ++loadGen;
  const appearance = useAppearanceStore();
  appearance.setAsciiArtLoading(true, 5);
  disposeCaches();
  stopLoop();

  try {
    if (viewW < 32 || viewH < 32) {
      decoded = null;
      appearance.setAsciiArtLoading(false);
      return;
    }

    const params = buildParams();

    if (!props.sourceSubpath) {
      appearance.setAsciiArtLoading(true, 20);
      appearance.setAsciiArtPlaybackMeta({
        sourceFrames: 1,
        nativeFps: 0,
        nativeLoopMs: 0,
      });
      decoded = {
        frames: [buildPlaceholderFrame(params)],
        frameDurations: [0],
        isAnimated: false,
        sourceFrameCount: 1,
        playbackFps: 0,
        nativeFps: 0,
        nativeLoopMs: 0,
      };
      await precomputeFrameCaches((ratio) => {
        appearance.setAsciiArtLoading(true, 20 + ratio * 65);
      });
      if (gen !== loadGen) return;
      finishRebuild(gen);
      return;
    }

    appearance.setAsciiArtLoading(true, 15);
    const url = await resolveMediaUrl(props.sourceSubpath);
    if (gen !== loadGen) return;

    appearance.setAsciiArtLoading(true, 35);
    try {
      decoded = await buildAsciiFramesFromUrl(url, params, (ratio) => {
        appearance.setAsciiArtLoading(true, 35 + ratio * 18);
      });
    } catch {
      if (gen !== loadGen) return;
      decoded = {
        frames: [buildPlaceholderFrame(params)],
        frameDurations: [0],
        isAnimated: false,
        sourceFrameCount: 1,
        playbackFps: 0,
        nativeFps: 0,
        nativeLoopMs: 0,
      };
    }

    if (gen !== loadGen) return;
    appearance.setAsciiArtPlaybackMeta({
      sourceFrames: decoded.sourceFrameCount,
      nativeFps: decoded.nativeFps,
      nativeLoopMs: decoded.nativeLoopMs,
    });
    appearance.setAsciiArtLoading(true, 55);
    await precomputeFrameCaches((ratio) => {
      appearance.setAsciiArtLoading(true, 55 + ratio * 35);
    });
    if (gen !== loadGen) return;
    finishRebuild(gen);
  } catch {
    if (gen === loadGen) {
      appearance.setAsciiArtLoading(false);
    }
  }
}

function updateAnimatedFrameIndex(ts: number) {
  if (!decoded?.isAnimated) return;

  if (lastTs === 0) lastTs = ts;
  const dt = ts - lastTs;
  lastTs = ts;

  frameElapsed += dt;
  const dur = decoded.frameDurations[frameIndex] ?? 100;
  if (dur > 0 && frameElapsed >= dur) {
    frameElapsed = 0;
    frameIndex = (frameIndex + 1) % decoded.frames.length;
  }
}

let lastPaintedFrame = -1;

function loop(ts: number) {
  if (!decoded?.isAnimated) {
    raf = 0;
    return;
  }

  if (document.hidden) {
    raf = requestAnimationFrame(loop);
    return;
  }

  updateAnimatedFrameIndex(ts);

  if (frameIndex !== lastPaintedFrame) {
    blitToMainCanvas();
    lastPaintedFrame = frameIndex;
  }

  raf = requestAnimationFrame(loop);
}

function startLoop() {
  if (raf) return;
  lastTs = 0;
  lastPaintedFrame = -1;
  raf = requestAnimationFrame(loop);
}

function stopLoop() {
  if (raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  lastTs = 0;
}

function resize() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const parent = canvas.parentElement;
  const w = parent?.clientWidth ?? window.innerWidth;
  const h = parent?.clientHeight ?? window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  viewW = w;
  viewH = h;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  syncMainContext();
  void rebuildFrames();
}

let ro: ResizeObserver | null = null;

function onVisibilityChange() {
  if (document.hidden) return;
  if (decoded?.isAnimated) {
    lastPaintedFrame = -1;
    startLoop();
  } else if (frameCanvasCaches.length > 0) {
    blitToMainCanvas();
  }
}

onMounted(async () => {
  await nextTick();
  resize();
  ro = new ResizeObserver(() => resize());
  if (canvasRef.value?.parentElement) {
    ro.observe(canvasRef.value.parentElement);
  }
  document.addEventListener("visibilitychange", onVisibilityChange);
});

onUnmounted(() => {
  stopLoop();
  ro?.disconnect();
  document.removeEventListener("visibilitychange", onVisibilityChange);
  disposeCaches();
  loadGen++;
});

watch(
  () => [
    props.sourceSubpath,
    props.threshold,
    props.invert,
    props.frameCount,
    props.refreshNonce,
    props.wandTolerance,
    props.cellSize,
  ],
  () => {
    void rebuildFrames();
  },
);

watch(
  () => props.intensity,
  () => {
    if (frameCanvasCaches.length > 0) {
      blitToMainCanvas();
    }
  },
);
</script>

<template>
  <canvas ref="canvasRef" class="absolute inset-0 h-full w-full" />
</template>
