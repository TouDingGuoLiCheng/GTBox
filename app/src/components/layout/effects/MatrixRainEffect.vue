<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    theme?: "dark" | "light";
    intensity?: number;
    /** 像素主题：暗底衬垫 + 浅绿高亮，避免白字铺满像「背景变白」 */
    pixelStyle?: boolean;
  }>(),
  {
    theme: "dark",
    intensity: 60,
    pixelStyle: false,
  },
);

const canvasRef = ref<HTMLCanvasElement | null>(null);

const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** 固定在格子上的字符，不随列整体位移 */
interface Glyph {
  row: number;
  char: string;
  bornAt: number;
}

interface Column {
  x: number;
  headRow: number;
  extendAccum: number;
  extendSpeed: number;
  glyphs: Glyph[];
}

const MATRIX_GREEN = "#00FF41";
const HEAD_WHITE = "#FFFFFF";
const PIXEL_MATRIX_GREEN = "#55ee55";
const PIXEL_HEAD = "#b8ffb8";
const LIGHT_HEAD = "#15803d";
const LIGHT_TRAIL = "#16a34a";

let raf = 0;
let columns: Column[] = [];
let fontSize = 12;
let viewW = 0;
let viewH = 0;
let lastFrameTime = 0;

function randomChar() {
  return CHARSET[Math.floor(Math.random() * CHARSET.length)] ?? "0";
}

/** 强度 10%～200%，100% 为基准 1.0 */
function intensityT() {
  return props.intensity / 100;
}

/** 整体可见度（低强度更淡、列更少） */
function visibilityMul() {
  const t = intensityT();
  return Math.min(1.25, 0.18 + t * 0.42);
}

/** 字符存活时间（毫秒），到期后消失 */
function glyphTtlMs() {
  const t = intensityT();
  return Math.max(700, 3800 - t * 2100);
}

function extendSpeedForColumn() {
  const t = intensityT();
  return 2.4 + Math.random() * (1.2 + t * 9);
}

function initColumns(width: number, height: number) {
  viewW = width;
  viewH = height;
  const t = intensityT();
  fontSize = Math.max(8, Math.min(15, 14 - Math.floor(t * 1.6)));
  const maxColsByWidth = Math.ceil(width / fontSize) + 1;
  const colCount = Math.min(
    maxColsByWidth,
    Math.max(6, Math.floor(8 + t * 42)),
  );
  const step = width / colCount;
  const maxRow = Math.ceil(height / fontSize);
  const now = performance.now();
  columns = Array.from({ length: colCount }, (_, i) => {
    const headRow = Math.floor(Math.random() * maxRow * 0.7);
    const trail = 3 + Math.floor(Math.random() * (4 + t * 6));
    const glyphs: Glyph[] = [];
    for (let r = headRow - trail; r <= headRow; r++) {
      glyphs.push({
        row: r,
        char: randomChar(),
        bornAt: now - (headRow - r) * 120,
      });
    }
    return {
      x: i * step,
      headRow,
      extendAccum: 0,
      extendSpeed: extendSpeedForColumn(),
      glyphs,
    };
  });
}

function syncIntensityParams() {
  if (!viewW || !viewH) return;
  initColumns(viewW, viewH);
}

function opacityForGlyph(ageMs: number, isHead: boolean) {
  const ttl = glyphTtlMs();
  if (isHead) return 1;
  const fadeStart = ttl * 0.45;
  if (ageMs < fadeStart) {
    return 0.55 + (1 - ageMs / fadeStart) * 0.35;
  }
  const fade = (ageMs - fadeStart) / (ttl - fadeStart);
  return Math.max(0, 1 - fade) * 0.9;
}

function drawGlyph(
  ctx: CanvasRenderingContext2D,
  g: Glyph,
  col: Column,
  x: number,
  now: number,
  isLight: boolean,
) {
  const py = Math.floor(g.row * fontSize);
  if (py < -fontSize || py > viewH + fontSize) return;

  const isHead = g.row === col.headRow;
  const age = now - g.bornAt;
  let alpha = opacityForGlyph(age, isHead) * visibilityMul();
  if (alpha <= 0.02) return;

  ctx.globalAlpha = Math.min(1, alpha);
  const px = Math.floor(x);
  if (isLight) {
    ctx.fillStyle = isHead ? LIGHT_HEAD : LIGHT_TRAIL;
    ctx.fillText(g.char, px, py);
  } else if (props.pixelStyle) {
    ctx.fillStyle = isHead ? PIXEL_HEAD : PIXEL_MATRIX_GREEN;
    ctx.fillText(g.char, px, py);
  } else {
    ctx.fillStyle = MATRIX_GREEN;
    ctx.fillText(g.char, px, py);
    if (isHead) {
      ctx.fillStyle = HEAD_WHITE;
      ctx.fillText(g.char, px, py);
    }
  }
}

function pruneGlyphs(col: Column, now: number) {
  const ttl = glyphTtlMs();
  col.glyphs = col.glyphs.filter((g) => now - g.bornAt < ttl);
}

function maybeMutateGlyphs(col: Column) {
  const mutateChance = 0.015 + intensityT() * 0.1;
  if (col.glyphs.length < 2 || Math.random() > mutateChance) return;
  const idx = Math.floor(Math.random() * (col.glyphs.length - 1));
  const g = col.glyphs[idx];
  if (g && g.row !== col.headRow) g.char = randomChar();
}

function resetColumn(col: Column, maxRow: number) {
  const now = performance.now();
  col.headRow = Math.floor(Math.random() * maxRow * 0.25);
  col.extendAccum = 0;
  col.extendSpeed = extendSpeedForColumn();
  col.glyphs = [
    {
      row: col.headRow,
      char: randomChar(),
      bornAt: now,
    },
  ];
}

function drawFrame(now: number) {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dt = lastFrameTime ? Math.min(0.05, (now - lastFrameTime) / 1000) : 0.016;
  lastFrameTime = now;

  const isLight = props.theme === "light";
  const isPixel = props.pixelStyle;
  const maxRow = Math.ceil(viewH / fontSize) + 4;

  if (isPixel) {
    ctx.fillStyle = "rgb(20 30 18 / 0.25)";
    ctx.fillRect(0, 0, viewW, viewH);
  } else {
    ctx.clearRect(0, 0, viewW, viewH);
  }
  ctx.shadowBlur = 0;
  ctx.font = `${fontSize}px "Consolas", "Courier New", "MS Gothic", monospace`;
  ctx.textBaseline = "top";

  for (const col of columns) {
    col.extendAccum += col.extendSpeed * dt;
    while (col.extendAccum >= 1) {
      col.extendAccum -= 1;
      col.headRow += 1;
      col.glyphs.push({
        row: col.headRow,
        char: randomChar(),
        bornAt: now,
      });
      maybeMutateGlyphs(col);
    }

    pruneGlyphs(col, now);

    for (const g of col.glyphs) {
      drawGlyph(ctx, g, col, Math.floor(col.x), now, isLight);
    }

    if (col.headRow > maxRow) {
      resetColumn(col, maxRow);
    }
  }

  ctx.globalAlpha = 1;
  raf = requestAnimationFrame(drawFrame);
}

function resize() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const parent = canvas.parentElement;
  if (!parent) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = parent.clientWidth;
  const h = parent.clientHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }
  lastFrameTime = 0;
  initColumns(w, h);
}

function start() {
  cancelAnimationFrame(raf);
  resize();
  lastFrameTime = 0;
  raf = requestAnimationFrame(drawFrame);
}

function stop() {
  cancelAnimationFrame(raf);
}

let resizeObserver: ResizeObserver | undefined;

function onVisibility() {
  if (document.hidden) stop();
  else start();
}

onMounted(() => {
  start();
  resizeObserver = new ResizeObserver(() => resize());
  if (canvasRef.value?.parentElement) {
    resizeObserver.observe(canvasRef.value.parentElement);
  }
  document.addEventListener("visibilitychange", onVisibility);
});

onUnmounted(() => {
  stop();
  resizeObserver?.disconnect();
  document.removeEventListener("visibilitychange", onVisibility);
});

watch(
  () => [props.theme, props.pixelStyle] as const,
  () => start(),
);

watch(
  () => props.intensity,
  () => syncIntensityParams(),
);
</script>

<template>
  <canvas
    ref="canvasRef"
    class="pointer-events-none absolute inset-0 h-full w-full"
    aria-hidden="true"
  />
</template>
