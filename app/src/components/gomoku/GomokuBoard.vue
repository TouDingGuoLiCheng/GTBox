<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import type { Stone } from "../../types/gomoku";
import { useGomokuStore } from "../../stores/gomoku";
import { useGomokuLanStore } from "../../stores/gomokuLan";
import {
  BOARD_IMAGE_X,
  BOARD_IMAGE_Y,
  SCENE_HEIGHT,
  SCENE_WIDTH,
  STONE_RADIUS,
  clientToGrid,
  computeSceneLayout,
  gridToScene,
  type SceneLayout,
} from "../../utils/gomoku/coords";
import { playSound, unlockGomokuAudio } from "../../utils/gomoku/sounds";

const store = useGomokuStore();
const lanStore = useGomokuLanStore();
const { board, hover, canHumanPlay, activeStone, mode } = storeToRefs(store);

const containerRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const layout = ref<SceneLayout>({
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  width: SCENE_WIDTH,
  height: SCENE_HEIGHT,
});

const bgImage = new Image();
const boardImage = new Image();
bgImage.src = "/gomoku/images/background.png";
boardImage.src = "/gomoku/images/chessboard.png";

let imagesLoaded = 0;
function onImageLoad() {
  imagesLoaded += 1;
  if (imagesLoaded >= 2) draw();
}

bgImage.onload = onImageLoad;
boardImage.onload = onImageLoad;

function draw() {
  const canvas = canvasRef.value;
  const container = containerRef.value;
  if (!canvas || !container) return;

  const dpr = window.devicePixelRatio || 1;
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  layout.value = computeSceneLayout(cw, ch);

  canvas.width = Math.floor(cw * dpr);
  canvas.height = Math.floor(ch * dpr);
  canvas.style.width = `${cw}px`;
  canvas.style.height = `${ch}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);

  const { scale, offsetX, offsetY } = layout.value;
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  if (bgImage.complete) ctx.drawImage(bgImage, 0, 0, SCENE_WIDTH, SCENE_HEIGHT);
  if (boardImage.complete) ctx.drawImage(boardImage, BOARD_IMAGE_X, BOARD_IMAGE_Y);

  for (let row = 0; row < board.value.length; row += 1) {
    for (let col = 0; col < board.value[row].length; col += 1) {
      const stone = board.value[row][col] as Stone;
      if (stone === 0) continue;
      drawStone(ctx, row, col, stone);
    }
  }

  if (hover.value && canHumanPlay.value) {
    const previewStone = activeStone.value;
    drawStone(ctx, hover.value.row, hover.value.col, previewStone, true);
  }

  ctx.restore();
}

function drawStone(
  ctx: CanvasRenderingContext2D,
  row: number,
  col: number,
  stone: Stone,
  preview = false,
) {
  const { x, y } = gridToScene(row, col);
  ctx.beginPath();
  ctx.arc(x, y, STONE_RADIUS, 0, Math.PI * 2);
  if (preview) {
    ctx.fillStyle = stone === 1 ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.45)";
  } else if (stone === 1) {
    ctx.fillStyle = "#0a0a0a";
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
  } else {
    ctx.fillStyle = "#f8f8f8";
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 1;
  }
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  if (!preview) {
    ctx.strokeStyle = stone === 1 ? "#000" : "#666";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function pointerToCell(event: MouseEvent) {
  const canvas = canvasRef.value;
  if (!canvas) return null;
  return clientToGrid(event.clientX, event.clientY, canvas.getBoundingClientRect(), layout.value);
}

function onMouseMove(event: MouseEvent) {
  if (!canHumanPlay.value) {
    store.setHover(null);
    return;
  }
  store.setHover(pointerToCell(event));
}

function onMouseLeave() {
  store.setHover(null);
}

function onClick(event: MouseEvent) {
  unlockGomokuAudio();
  const cell = pointerToCell(event);
  if (!cell) return;
  if (mode.value === "pvn") {
    lanStore.tryLanMove(cell.row, cell.col);
    return;
  }
  if (store.humanMove(cell.row, cell.col)) {
    playSound("place");
  }
}

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  draw();
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => draw());
    resizeObserver.observe(containerRef.value);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
});

watch([board, hover, canHumanPlay, activeStone], () => draw(), { deep: true });
</script>

<template>
  <div ref="containerRef" class="relative h-full min-h-0 w-full">
    <canvas
      ref="canvasRef"
      class="block h-full w-full cursor-crosshair transition-opacity duration-150 hover:opacity-[0.98]"
      @mousemove="onMouseMove"
      @mouseleave="onMouseLeave"
      @click="onClick"
    />
  </div>
</template>
