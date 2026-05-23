<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    theme?: "dark" | "light";
    intensity?: number;
  }>(),
  {
    theme: "dark",
    intensity: 80,
  },
);

const canvasRef = ref<HTMLCanvasElement | null>(null);

interface Band {
  /** 锚点在画布高度上的比例 */
  yRatio: number;
  phase: number;
  speed: number;
  width: number;
  height: number;
  angle: number;
  alphaMul: number;
}

let raf = 0;
let bands: Band[] = [];
let viewW = 0;
let viewH = 0;
let lastFrameTime = 0;
let accentRgb: [number, number, number] = [34, 211, 238];

const canvasContextOptions: CanvasRenderingContext2DSettings = {
  desynchronized: true,
};

function intensityT() {
  return props.intensity / 100;
}

function parseAccentColor(): [number, number, number] {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--color-accent")
    .trim();
  if (!raw) return [34, 211, 238];
  if (raw.startsWith("#")) {
    const h = raw.slice(1);
    const full =
      h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6);
    const n = Number.parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = raw.match(/(\d+)\s+(\d+)\s+(\d+)/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return [34, 211, 238];
}

function initBands() {
  const t = intensityT();
  const count = Math.max(1, Math.round(1 + t * 5));
  bands = [];
  for (let i = 0; i < count; i++) {
    const top = i % 2 === 0;
    bands.push({
      yRatio: top ? 0.08 + Math.random() * 0.22 : 0.7 + Math.random() * 0.22,
      phase: Math.random() * 1200,
      speed: (8 + Math.random() * 14) * (0.35 + t * 1.45) * (top ? 1 : -1),
      width: viewW * (0.3 + Math.random() * 0.25 + t * 0.28),
      height: (45 + Math.random() * 70) * (0.65 + t * 0.75),
      angle: (top ? -1 : 1) * (0.08 + Math.random() * 0.12),
      alphaMul: 0.55 + Math.random() * 0.45,
    });
  }
}

function drawBand(
  ctx: CanvasRenderingContext2D,
  band: Band,
  t: number,
  isLight: boolean,
) {
  const [r, g, b] = accentRgb;
  const baseAlpha = (isLight ? 0.02 : 0.04) + t * (isLight ? 0.2 : 0.36);
  const a = baseAlpha * band.alphaMul;
  const travel = viewW + band.width * 1.4;
  const x = ((band.phase % travel) + travel) % travel - band.width * 0.7;
  const y = band.yRatio * viewH;

  const grad = ctx.createLinearGradient(-band.width * 0.5, 0, band.width * 0.5, 0);
  grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
  grad.addColorStop(0.32, `rgba(${r}, ${g}, ${b}, ${a * 0.35})`);
  grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${a})`);
  grad.addColorStop(0.68, `rgba(${r}, ${g}, ${b}, ${a * 0.35})`);
  grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(band.angle);
  ctx.fillStyle = grad;
  ctx.fillRect(-band.width * 0.5, -band.height * 0.5, band.width, band.height);
  ctx.restore();
}

function drawFrame(now: number) {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d", canvasContextOptions);
  if (!ctx) return;

  const dt = lastFrameTime ? Math.min(0.05, (now - lastFrameTime) / 1000) : 0.016;
  lastFrameTime = now;
  const t = intensityT();
  const isLight = props.theme === "light";

  ctx.clearRect(0, 0, viewW, viewH);

  for (const band of bands) {
    band.phase += band.speed * dt;
    drawBand(ctx, band, t, isLight);
  }

  raf = requestAnimationFrame(drawFrame);
}

function resize() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const parent = canvas.parentElement;
  if (!parent) return;
  accentRgb = parseAccentColor();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = parent.clientWidth;
  const h = parent.clientHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext("2d", canvasContextOptions);
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
  }
  viewW = w;
  viewH = h;
  lastFrameTime = 0;
  initBands();
}

function start() {
  cancelAnimationFrame(raf);
  resize();
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
  () => props.theme,
  () => start(),
);

watch(
  () => props.intensity,
  () => {
    if (viewW > 0) initBands();
  },
);
</script>

<template>
  <canvas
    ref="canvasRef"
    class="pointer-events-none absolute inset-0 h-full w-full"
    aria-hidden="true"
  />
</template>
