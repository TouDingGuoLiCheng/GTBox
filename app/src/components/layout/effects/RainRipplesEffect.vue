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

interface Ripple {
  x: number;
  y: number;
  bornAt: number;
  maxRadius: number;
  expandSpeed: number;
}

interface RainStreak {
  x: number;
  y: number;
  length: number;
  speed: number;
}

let raf = 0;
let ripples: Ripple[] = [];
let rain: RainStreak[] = [];
let viewW = 0;
let viewH = 0;
let lastFrameTime = 0;
let spawnCooldown = 0;

const canvasContextOptions: CanvasRenderingContext2DSettings = {
  desynchronized: true,
};

function intensityT() {
  return props.intensity / 100;
}

function maxRipples() {
  return Math.floor(8 + intensityT() * 28);
}

function spawnInterval() {
  return Math.max(0.12, 0.55 - intensityT() * 0.38);
}

function spawnRipple() {
  if (ripples.length >= maxRipples()) return;
  const t = intensityT();
  ripples.push({
    x: Math.random() * viewW,
    y: Math.random() * viewH,
    bornAt: performance.now(),
    maxRadius: 24 + Math.random() * (55 + t * 90),
    expandSpeed: 55 + Math.random() * (40 + t * 70),
  });
}

function initRain() {
  const t = intensityT();
  const count = Math.floor(viewW * 0.018 * (0.5 + t * 1.2));
  rain = [];
  for (let i = 0; i < count; i++) {
    rain.push({
      x: Math.random() * viewW,
      y: Math.random() * viewH,
      length: 6 + Math.random() * 14,
      speed: 280 + Math.random() * 220 * (0.6 + t),
    });
  }
}

function drawScrim(ctx: CanvasRenderingContext2D, t: number, isLight: boolean) {
  const g = ctx.createLinearGradient(0, 0, 0, viewH);
  if (isLight) {
    g.addColorStop(0, `rgba(200, 220, 235, ${0.02 + t * 0.04})`);
    g.addColorStop(1, `rgba(160, 190, 210, ${0.04 + t * 0.06})`);
  } else {
    g.addColorStop(0, `rgba(8, 14, 24, ${0.08 + t * 0.1})`);
    g.addColorStop(1, `rgba(4, 8, 16, ${0.14 + t * 0.12})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, viewW, viewH);
}

function drawRain(ctx: CanvasRenderingContext2D, dt: number, t: number, isLight: boolean) {
  const alpha = (isLight ? 0.08 : 0.14) + t * (isLight ? 0.18 : 0.28);
  ctx.strokeStyle = isLight
    ? `rgba(90, 130, 170, ${alpha})`
    : `rgba(190, 215, 235, ${alpha})`;
  ctx.lineWidth = 0.8;
  ctx.lineCap = "round";

  for (const drop of rain) {
    drop.y += drop.speed * dt;
    if (drop.y - drop.length > viewH) {
      drop.y = -drop.length - Math.random() * 40;
      drop.x = Math.random() * viewW;
    }
    ctx.beginPath();
    ctx.moveTo(drop.x, drop.y);
    ctx.lineTo(drop.x + 0.6, drop.y - drop.length);
    ctx.stroke();
  }
}

function drawRipples(ctx: CanvasRenderingContext2D, now: number, t: number, isLight: boolean) {
  const next: Ripple[] = [];
  for (const ripple of ripples) {
    const age = (now - ripple.bornAt) / 1000;
    const radius = age * ripple.expandSpeed;
    if (radius > ripple.maxRadius + 12) continue;
    next.push(ripple);

    const life = 1 - radius / ripple.maxRadius;
    if (life <= 0) continue;

    const rings = 3;
    for (let i = 0; i < rings; i++) {
      const r = radius - i * 7;
      if (r < 2) continue;
      const a = life * (0.22 - i * 0.05) * t;
      if (a <= 0.01) continue;
      ctx.strokeStyle = isLight
        ? `rgba(70, 115, 155, ${a})`
        : `rgba(175, 205, 230, ${a})`;
      ctx.lineWidth = Math.max(0.5, 1.4 - i * 0.35);
      ctx.beginPath();
      ctx.ellipse(ripple.x, ripple.y, r, r * 0.88, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    const coreA = life * 0.12 * t;
    if (coreA > 0.01 && radius < 10) {
      const cg = ctx.createRadialGradient(
        ripple.x,
        ripple.y,
        0,
        ripple.x,
        ripple.y,
        10,
      );
      cg.addColorStop(
        0,
        isLight ? `rgba(120, 170, 210, ${coreA})` : `rgba(210, 230, 255, ${coreA})`,
      );
      cg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, 10, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ripples = next;
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
  drawScrim(ctx, t, isLight);
  drawRain(ctx, dt, t, isLight);

  spawnCooldown -= dt;
  while (spawnCooldown <= 0) {
    spawnRipple();
    spawnCooldown += spawnInterval();
  }
  drawRipples(ctx, now, t, isLight);

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
  const ctx = canvas.getContext("2d", canvasContextOptions);
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
  }
  viewW = w;
  viewH = h;
  lastFrameTime = 0;
  ripples = [];
  spawnCooldown = 0;
  initRain();
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
    if (viewW > 0) initRain();
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
