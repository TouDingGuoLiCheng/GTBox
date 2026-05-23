/** 字符画单元：带颜色的 0 或 1 */
export interface AsciiCell {
  ch: "0" | "1";
  color: string;
}

/** 一帧布局：在视口内居中，等比贴合后的网格 */
export interface AsciiFrameLayout {
  cols: number;
  rows: number;
  offsetX: number;
  offsetY: number;
  /** 行优先，null 表示空白不绘制 */
  cells: (AsciiCell | null)[];
}

export interface AsciiBuildParams {
  viewW: number;
  viewH: number;
  /** 正方形格子边长（像素），越小图越精细 */
  cellSize: number;
  threshold: number;
  invert: boolean;
  /** 动图播放帧率（FPS），实际不超过源帧数 */
  frameCount: number;
  /** 魔棒容差：与边缘/背景色相近的连通区域不填字（约 8–96） */
  wandTolerance: number;
}

export interface DecodedAsciiFrames {
  frames: AsciiFrameLayout[];
  frameDurations: number[];
  isAnimated: boolean;
  /** 源 GIF 总帧数（静态图为 1） */
  sourceFrameCount: number;
  /** 用户设定的播放帧率（仅用于放慢，不会超过原 GIF） */
  playbackFps: number;
  /** 按 GIF 原始延时估算的帧率 */
  nativeFps: number;
  /** 按 GIF 原始延时播放一圈的毫秒数 */
  nativeLoopMs: number;
}

const MAX_ASCII_SOURCE_FRAMES = 120;

const ALPHA_EMPTY = 40;

const MAX_GRID_COLS = 360;
const MAX_GRID_ROWS = 240;

/** 字号适配正方形格，避免字形撑破比例 */
export function fontSizeForCell(cellSize: number): number {
  return Math.max(5, Math.floor(cellSize * 0.78));
}

export function opacityFromIntensity(intensity: number): number {
  const t = Math.min(200, Math.max(10, intensity)) / 100;
  return Math.min(1, 0.4 + t * 0.5);
}

/**
 * 等比 contain：正方形格子，cols/rows 比例 = 图片比例（不拉伸）
 */
export function computeContainedLayout(
  viewW: number,
  viewH: number,
  imgW: number,
  imgH: number,
  cellSize: number,
): { cols: number; rows: number; offsetX: number; offsetY: number } | null {
  if (viewW < 32 || viewH < 32 || imgW < 1 || imgH < 1 || cellSize < 1) {
    return null;
  }
  const imgAspect = imgW / imgH;
  let maxCols = Math.max(8, Math.floor(viewW / cellSize));
  let maxRows = Math.max(8, Math.floor(viewH / cellSize));
  maxCols = Math.min(maxCols, MAX_GRID_COLS);
  maxRows = Math.min(maxRows, MAX_GRID_ROWS);

  let rows = maxRows;
  let cols = Math.max(8, Math.round(rows * imgAspect));
  if (cols > maxCols) {
    cols = maxCols;
    rows = Math.max(8, Math.round(cols / imgAspect));
  }

  const gridW = cols * cellSize;
  const gridH = rows * cellSize;
  return {
    cols,
    rows,
    offsetX: (viewW - gridW) / 2,
    offsetY: (viewH - gridH) / 2,
  };
}

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function colorDist(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function samplePixel(
  px: Uint8ClampedArray,
  width: number,
  height: number,
  cols: number,
  rows: number,
  c: number,
  r: number,
): { r: number; g: number; b: number; a: number } {
  const sx = Math.min(width - 1, Math.floor(((c + 0.5) / cols) * width));
  const sy = Math.min(height - 1, Math.floor(((r + 0.5) / rows) * height));
  const i = (sy * width + sx) * 4;
  return { r: px[i], g: px[i + 1], b: px[i + 2], a: px[i + 3] };
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** 从四边采样估计背景色（魔棒种子色） */
function estimateBorderBackgroundColor(
  px: Uint8ClampedArray,
  width: number,
  height: number,
  cols: number,
  rows: number,
): { r: number; g: number; b: number } | null {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];

  const sampleBorder = (c: number, r: number) => {
    const p = samplePixel(px, width, height, cols, rows, c, r);
    if (p.a >= ALPHA_EMPTY) {
      rs.push(p.r);
      gs.push(p.g);
      bs.push(p.b);
    }
  };

  for (let c = 0; c < cols; c++) {
    sampleBorder(c, 0);
    sampleBorder(c, rows - 1);
  }
  for (let r = 1; r < rows - 1; r++) {
    sampleBorder(0, r);
    sampleBorder(cols - 1, r);
  }

  if (rs.length < 4) return null;
  return { r: medianOf(rs), g: medianOf(gs), b: medianOf(bs) };
}

/**
 * 魔棒式选区：从画面边缘种子出发，泛洪与背景色/邻接色相近的连通区域（不填字）
 * - 与 PS 魔棒相同：容差内且与种子连通 → 背景
 * - 人物等未与边缘连通的主体 → 保留填色
 */
function buildBackgroundMaskMagicWand(
  px: Uint8ClampedArray,
  width: number,
  height: number,
  cols: number,
  rows: number,
  tolerance: number,
): Uint8Array {
  const n = cols * rows;
  const isBg = new Uint8Array(n);
  const seen = new Uint8Array(n);
  const queue: number[] = [];
  const tol = Math.max(8, Math.min(96, tolerance));
  const bgRef = estimateBorderBackgroundColor(px, width, height, cols, rows);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  const matchesBgRef = (r: number, g: number, b: number) =>
    bgRef !== null && colorDist(r, g, b, bgRef.r, bgRef.g, bgRef.b) < tol;

  const seedBorder = (c: number, r: number) => {
    const idx = r * cols + c;
    if (seen[idx]) return;
    const p = samplePixel(px, width, height, cols, rows, c, r);
    if (p.a < ALPHA_EMPTY || matchesBgRef(p.r, p.g, p.b)) {
      seen[idx] = 1;
      isBg[idx] = 1;
      queue.push(idx);
    }
  };

  for (let c = 0; c < cols; c++) {
    seedBorder(c, 0);
    seedBorder(c, rows - 1);
  }
  for (let r = 1; r < rows - 1; r++) {
    seedBorder(0, r);
    seedBorder(cols - 1, r);
  }

  while (queue.length > 0) {
    const idx = queue.shift()!;
    const cr = Math.floor(idx / cols);
    const cc = idx % cols;
    const cur = samplePixel(px, width, height, cols, rows, cc, cr);

    for (const [dc, dr] of dirs) {
      const nr = cr + dr;
      const nc = cc + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const ni = nr * cols + nc;
      if (seen[ni]) continue;

      const nb = samplePixel(px, width, height, cols, rows, nc, nr);
      let join = nb.a < ALPHA_EMPTY;
      if (!join && matchesBgRef(nb.r, nb.g, nb.b)) join = true;
      if (!join && cur.a >= ALPHA_EMPTY && nb.a >= ALPHA_EMPTY) {
        join = colorDist(cur.r, cur.g, cur.b, nb.r, nb.g, nb.b) < tol;
      }
      if (!join) continue;

      seen[ni] = 1;
      isBg[ni] = 1;
      queue.push(ni);
    }
  }

  return isBg;
}

function drawBitmapContained(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  cols: number,
  rows: number,
) {
  ctx.clearRect(0, 0, cols, rows);
  const imgAspect = bitmap.width / bitmap.height;
  const gridAspect = cols / rows;
  // 网格比例已与图片对齐时铺满采样画布，避免二次缩放失真
  if (Math.abs(imgAspect - gridAspect) < 0.02) {
    ctx.drawImage(bitmap, 0, 0, cols, rows);
    return;
  }
  let dw = cols;
  let dh = rows;
  let dx = 0;
  let dy = 0;
  if (imgAspect > gridAspect) {
    dh = cols / imgAspect;
    dy = (rows - dh) / 2;
  } else {
    dw = rows * imgAspect;
    dx = (cols - dw) / 2;
  }
  ctx.drawImage(bitmap, dx, dy, dw, dh);
}

function imageDataToFrame(
  data: ImageData,
  layout: { cols: number; rows: number; offsetX: number; offsetY: number },
  threshold: number,
  invert: boolean,
  wandTolerance: number,
): AsciiFrameLayout {
  const { cols, rows, offsetX, offsetY } = layout;
  const { width, height, data: px } = data;
  const bgMask = buildBackgroundMaskMagicWand(
    px,
    width,
    height,
    cols,
    rows,
    wandTolerance,
  );
  const cells: (AsciiCell | null)[] = new Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (bgMask[idx]) {
        cells[idx] = null;
        continue;
      }
      const { r: pr, g, b, a } = samplePixel(px, width, height, cols, rows, c, r);
      if (a < ALPHA_EMPTY) {
        cells[idx] = null;
        continue;
      }
      const lum = luminance(pr, g, b);
      const dark = lum < threshold;
      const on = invert ? !dark : dark;
      const alpha = Math.min(1, a / 255);
      cells[idx] = {
        ch: on ? "1" : "0",
        color: `rgba(${pr},${g},${b},${(0.55 + alpha * 0.45).toFixed(3)})`,
      };
    }
  }

  return { cols, rows, offsetX, offsetY, cells };
}

function bitmapToFrame(
  bitmap: ImageBitmap,
  params: AsciiBuildParams,
): AsciiFrameLayout | null {
  const layout = computeContainedLayout(
    params.viewW,
    params.viewH,
    bitmap.width,
    bitmap.height,
    params.cellSize,
  );
  if (!layout) return null;

  const canvas = document.createElement("canvas");
  canvas.width = layout.cols;
  canvas.height = layout.rows;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  drawBitmapContained(ctx, bitmap, layout.cols, layout.rows);
  const data = ctx.getImageData(0, 0, layout.cols, layout.rows);
  return imageDataToFrame(
    data,
    layout,
    params.threshold,
    params.invert,
    params.wandTolerance,
  );
}

/** 源帧过多时均匀抽样到上限；否则保留 GIF 全部帧 */
function indicesForAsciiSource(total: number): number[] {
  if (total <= 1) return [0];
  if (total <= MAX_ASCII_SOURCE_FRAMES) {
    return Array.from({ length: total }, (_, i) => i);
  }
  const indices: number[] = [];
  const n = MAX_ASCII_SOURCE_FRAMES;
  for (let i = 0; i < n; i++) {
    indices.push(Math.round((i * (total - 1)) / (n - 1)));
  }
  return indices;
}

/** 播放帧率：不超过源帧数 */
export function effectivePlaybackFps(requestedFps: number, sourceFrameCount: number): number {
  const fps = Math.max(1, Math.min(120, Math.floor(requestedFps) || 1));
  if (sourceFrameCount <= 1) return fps;
  return Math.min(fps, sourceFrameCount);
}

function clampGifDelayMs(ms: number): number {
  return Math.min(500, Math.max(40, ms > 0 ? ms : 100));
}

/**
 * 按请求 FPS 生成各帧停留时间：整圈时长 ≥ 原 GIF，仅允许放慢、不允许加快。
 */
export function computePlaybackDurations(
  nativeDelaysMs: number[],
  requestedFps: number,
): number[] {
  const native = nativeDelaysMs.map((d) => clampGifDelayMs(d));
  const n = native.length;
  if (n <= 1) return native;

  const nativeLoopMs = native.reduce((s, d) => s + d, 0);
  if (nativeLoopMs <= 0) return native;

  const fps = Math.max(1, Math.min(120, Math.floor(requestedFps) || 1));
  const nativeFps = (n / nativeLoopMs) * 1000;
  const effectiveFps = nativeFps > 0 ? Math.min(fps, nativeFps) : fps;
  const minLoopFromFps = n * (1000 / effectiveFps);
  const targetLoopMs = Math.max(nativeLoopMs, minLoopFromFps);
  const scale = targetLoopMs / nativeLoopMs;

  return native.map((d) => clampGifDelayMs(d * scale));
}

export function estimateNativeFps(frameDelaysMs: number[]): number {
  const total = frameDelaysMs.reduce((s, d) => s + d, 0);
  if (total <= 0 || frameDelaysMs.length <= 1) return 0;
  return (frameDelaysMs.length / total) * 1000;
}

async function blobFromUrl(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`无法读取媒体: ${res.status}`);
  return res.blob();
}

function mimeFromBlob(blob: Blob, url: string): string {
  if (blob.type) return blob.type;
  const lower = url.toLowerCase();
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".mp4") || lower.endsWith(".m4v")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  return "image/png";
}

function isVideoSource(mime: string, url: string): boolean {
  if (mime.startsWith("video/")) return true;
  const lower = url.toLowerCase();
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(lower);
}

/** 从视频均匀抽帧，最多 MAX_ASCII_SOURCE_FRAMES 帧 */
const VIDEO_NATIVE_SAMPLE_FPS = 24;

function seekVideoTo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  const t = Math.max(0, timeSec);
  if (Math.abs(video.currentTime - t) < 0.02 && video.readyState >= 2) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("视频定位失败"));
    };
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    try {
      video.currentTime = t;
    } catch (e) {
      cleanup();
      reject(e instanceof Error ? e : new Error("视频定位失败"));
    }
  });
}

async function decodeVideoFrames(
  blob: Blob,
  onProgress?: (ratio: number) => void,
): Promise<RawDecodedFrame[]> {
  const objectUrl = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("视频无法解码（请尝试 MP4 H.264 或 WebM）"));
      video.src = objectUrl;
    });

    const duration = video.duration;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!Number.isFinite(duration) || duration <= 0 || w < 1 || h < 1) {
      throw new Error("无法读取视频画面或时长");
    }

    const wantFrames = Math.min(
      MAX_ASCII_SOURCE_FRAMES,
      Math.max(2, Math.floor(duration * VIDEO_NATIVE_SAMPLE_FPS)),
    );
    const stepSec = duration / wantFrames;
    const frameDelayMs = clampGifDelayMs((stepSec * 1000));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建视频画布");

    const raw: RawDecodedFrame[] = [];
    for (let i = 0; i < wantFrames; i++) {
      const t =
        i === wantFrames - 1
          ? Math.max(0, duration - 0.04)
          : Math.min(i * stepSec, Math.max(0, duration - 0.04));
      await seekVideoTo(video, t);
      ctx.drawImage(video, 0, 0, w, h);
      const bitmap = await createImageBitmap(canvas);
      raw.push({ bitmap, durationMs: frameDelayMs });
      onProgress?.((i + 1) / wantFrames);
    }
    return raw;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

/** ImageDecoder 不可用时的 GIF 逐帧解码 */
async function decodeGifWithGifuct(blob: Blob): Promise<RawDecodedFrame[]> {
  const { parseGIF, decompressFrames } = await import("gifuct-js");
  const buffer = await blob.arrayBuffer();
  const gif = parseGIF(buffer);
  const frames = decompressFrames(gif, true);
  if (frames.length === 0) return [];

  const canvas = document.createElement("canvas");
  canvas.width = gif.lsd.width;
  canvas.height = gif.lsd.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  const raw: RawDecodedFrame[] = [];
  let prevDisposal = 0;

  for (const frame of frames) {
    const disposal = frame.disposalType ?? 0;
    if (raw.length > 0 && (disposal === 2 || prevDisposal === 2)) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    prevDisposal = disposal;

    const patch = new Uint8ClampedArray(frame.patch);
    const patchData = new ImageData(patch, frame.dims.width, frame.dims.height);
    ctx.putImageData(patchData, frame.dims.left, frame.dims.top);

    const bitmap = await createImageBitmap(canvas);
    const delayCs = frame.delay != null && frame.delay > 0 ? frame.delay : 10;
    raw.push({
      bitmap,
      durationMs: Math.min(500, Math.max(40, delayCs * 10)),
    });
  }

  return raw;
}

async function loadStaticBitmap(blob: Blob): Promise<ImageBitmap> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("图片解码失败"));
      img.src = url;
    });
    return createImageBitmap(img);
  } finally {
    URL.revokeObjectURL(url);
  }
}

type FrameImageDecoder = {
  tracks: {
    ready: Promise<void>;
    selectedTrack: { frameCount: number };
  };
  decode(opts: { frameIndex: number }): Promise<{ image: VideoFrame }>;
  close(): void;
};

function getFrameImageDecoder():
  | (new (init: { data: Blob; type: string }) => FrameImageDecoder)
  | undefined {
  return (globalThis as { ImageDecoder?: new (init: { data: Blob; type: string }) => FrameImageDecoder })
    .ImageDecoder;
}

interface RawDecodedFrame {
  bitmap: ImageBitmap;
  durationMs: number;
}

async function decodeAllRawFrames(
  blob: Blob,
  mime: string,
  url: string,
  onProgress?: (ratio: number) => void,
): Promise<RawDecodedFrame[]> {
  if (isVideoSource(mime, url)) {
    const frames = await decodeVideoFrames(blob, onProgress);
    if (frames.length > 1) return frames;
    for (const { bitmap } of frames) bitmap.close();
    throw new Error("视频帧数不足");
  }

  const isGif = mime === "image/gif";
  const isAnimatedWebp = mime === "image/webp";

  if (isGif || isAnimatedWebp) {
    const Decoder = getFrameImageDecoder();
    if (Decoder) {
      try {
        const decoder = new Decoder({ data: blob, type: mime });
        await decoder.tracks.ready;
        const total = decoder.tracks.selectedTrack.frameCount;
        if (total > 1) {
          const raw: RawDecodedFrame[] = [];
          for (let i = 0; i < total; i++) {
            const { image: vf } = await decoder.decode({ frameIndex: i });
            const durUs = vf.duration && vf.duration > 0 ? vf.duration : 100_000;
            const bitmap = await createImageBitmap(vf);
            vf.close();
            raw.push({ bitmap, durationMs: Math.min(500, Math.max(40, durUs / 1000)) });
          }
          decoder.close();
          return raw;
        }
        decoder.close();
      } catch {
        /* 回退 */
      }
    }

    if (isGif) {
      try {
        const gifFrames = await decodeGifWithGifuct(blob);
        if (gifFrames.length > 1) return gifFrames;
        for (const { bitmap } of gifFrames) bitmap.close();
      } catch {
        /* 回退静态 */
      }
    }
  }

  const bitmap = await loadStaticBitmap(blob);
  return [{ bitmap, durationMs: 0 }];
}

/** 读入媒体（图 / GIF / 视频）→ 抽帧 → 按固定 FPS 播放 */
export async function buildAsciiFramesFromUrl(
  url: string,
  params: AsciiBuildParams,
  onDecodeProgress?: (ratio: number) => void,
): Promise<DecodedAsciiFrames> {
  const blob = await blobFromUrl(url);
  const mime = mimeFromBlob(blob, url);
  const rawFrames = await decodeAllRawFrames(blob, mime, url, onDecodeProgress);
  const sourceFrameCount = rawFrames.length;

  const indices = indicesForAsciiSource(sourceFrameCount);
  const frames: AsciiFrameLayout[] = [];
  const frameDurations: number[] = [];
  const isAnimated = sourceFrameCount > 1 && indices.length > 1;

  const nativeDelays = indices.map((idx) =>
    clampGifDelayMs(rawFrames[idx]?.durationMs ?? 100),
  );
  const nativeLoopMs = nativeDelays.reduce((s, d) => s + d, 0);
  const nativeFps = estimateNativeFps(nativeDelays);
  const playbackDelays = isAnimated
    ? computePlaybackDurations(nativeDelays, params.frameCount)
    : [];

  for (let j = 0; j < indices.length; j++) {
    const i = indices[j];
    const { bitmap } = rawFrames[i] ?? rawFrames[0];
    const frame = bitmapToFrame(bitmap, params);
    if (frame) {
      frames.push(frame);
      frameDurations.push(isAnimated ? (playbackDelays[j] ?? 100) : 0);
    }
  }

  for (const { bitmap } of rawFrames) {
    bitmap.close();
  }

  if (frames.length === 0) {
    throw new Error("无法生成字符画帧");
  }

  const playbackLoopMs = frameDurations.reduce((s, d) => s + d, 0);
  const playbackFps =
    isAnimated && playbackLoopMs > 0
      ? (frames.length / playbackLoopMs) * 1000
      : 0;

  return {
    frames,
    frameDurations,
    isAnimated,
    sourceFrameCount,
    playbackFps,
    nativeFps,
    nativeLoopMs,
  };
}

export function buildPlaceholderFrame(params: AsciiBuildParams): AsciiFrameLayout {
  const layout = computeContainedLayout(
    params.viewW,
    params.viewH,
    160,
    120,
    params.cellSize,
  );
  const cols = layout?.cols ?? 40;
  const rows = layout?.rows ?? 30;
  const offsetX = layout?.offsetX ?? 0;
  const offsetY = layout?.offsetY ?? 0;
  const cells: (AsciiCell | null)[] = new Array(cols * rows).fill(null);
  const cx = Math.floor(cols / 2);
  const cy = Math.floor(rows / 2);
  const pattern = [
    [0, 1, 1, 0, 0, 1, 1],
    [1, 0, 0, 1, 1, 0, 0],
    [0, 1, 1, 0, 0, 1, 1],
  ];
  for (let pr = 0; pr < pattern.length; pr++) {
    for (let pc = 0; pc < pattern[pr].length; pc++) {
      const r = cy - 1 + pr;
      const c = cx - 3 + pc;
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      const on = pattern[pr][pc] === 1;
      cells[r * cols + c] = {
        ch: on ? "1" : "0",
        color: on ? "rgba(34,211,238,0.9)" : "rgba(120,160,180,0.5)",
      };
    }
  }
  return { cols, rows, offsetX, offsetY, cells };
}
