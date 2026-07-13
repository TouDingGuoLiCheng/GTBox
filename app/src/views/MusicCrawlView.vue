<script setup lang="ts">
import { Icon } from "@iconify/vue";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  useMusicCrawlRunStore,
  songQueryKey,
  type CrawlSongResult,
} from "../stores/musicCrawlRun";
import { pushDebugLine } from "../utils/mediaDebug";
import { storeToRefs } from "pinia";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";

type BoxRole = "title" | "artist" | "unpaired";
type EditableBox = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  score: number;
  role?: BoxRole;
  pairIndex?: number;
  note?: string;
  /** 手动添加、尚未按框 OCR 的框 */
  pendingRecognize?: boolean;
};
type MediaEntry = { name: string; path: string };

/** 阶段B：每首歌的下载状态。pending=未下载，success=成功，failed=失败。 */
type SongStatus = "pending" | "success" | "failed";
type SongItem = {
  /** 列表内稳定 id，仅本会话使用 */
  id: string;
  song: string;
  artist: string;
  status: SongStatus;
  /** 最近一次的提示文本（成功时是文件路径，失败时是原因） */
  note?: string;
};

// 注：workspace_root 默认就指向 workspaces/music_crawl，因此这里写相对路径无需再带 `music_crawl/` 前缀，
//     否则会变成 workspaces/music_crawl/music_crawl/songs_state.json 双层目录。
const SONGS_STATE_PATH = "songs_state.json";
let songItemSeq = 0;
function makeSongId() {
  songItemSeq += 1;
  return `song-${Date.now().toString(36)}-${songItemSeq}`;
}
function songQuery(item: { song: string; artist: string }) {
  const song = item.song.trim();
  const artist = item.artist.trim();
  return artist ? `${song}-${artist}` : song;
}
function songKeyFromItem(item: { song: string; artist: string }) {
  return songQueryKey(songQuery(item));
}

const router = useRouter();
const runStore = useMusicCrawlRunStore();
const { running, logs, ocrBatchActive, batchProgressPercent, batchStatusLabel, batchPhase, engineLoadPercent, lastRegionsReady, crawlStatuses, crawlCurrentQuery, siteRateLimitHitAt, siteRateLimitMessage, humanVerifyHitAt, humanVerifyMessage } =
  storeToRefs(runStore);

const REGIONS_CACHE_DIR = "playlist_ocr/regions_cache";
const DEFAULT_OCR_FOLDER = "playlist_ocr/images_in";
/** folder：扫描 ocrInputFolder；files：仅扫描 images 中已选路径 */
const ocrInputSource = ref<"folder" | "files">("folder");
const ocrInputFolder = ref(DEFAULT_OCR_FOLDER);
const stage = ref<"ocr" | "crawl">("ocr");
/** 阶段B 正式数据源：每首歌一条记录，含 status。 */
const songItems = ref<SongItem[]>([]);
/** 批量编辑对话框内部 buffer（textarea 文本），保存时再合并到 songItems。 */
const songsText = ref("");
const songs = computed(() => songItems.value.map((s) => songQuery(s)));
const successCount = computed(() => songItems.value.filter((s) => s.status === "success").length);
const failedCount = computed(() => songItems.value.filter((s) => s.status === "failed").length);
const pendingCount = computed(() => songItems.value.filter((s) => s.status === "pending").length);
/** 启动爬取时实际会处理的歌曲数（未爬取 + 失败）。 */
const runnableCount = computed(() => failedCount.value + pendingCount.value);
/** 「确认歌单并开始爬取」按钮文案：有失败项时改为「重新爬取」。
 * 实时响应 songItems 的变化（增/删/重试结束后状态变化都会重算）。 */
const crawlButtonLabel = computed(() => {
  if (running.value) return "运行中...";
  if (failedCount.value > 0) {
    if (pendingCount.value > 0) return `重新爬取（${failedCount.value} 失败 + ${pendingCount.value} 未爬取）`;
    return `重新爬取（${failedCount.value} 失败）`;
  }
  if (pendingCount.value > 0) return `确认歌单并开始爬取（${pendingCount.value}）`;
  return "确认歌单并开始爬取";
});
/** 阶段B 多选交互：选中集合 + 上次锚点（用于 Shift 区间选） */
const selectedSongIds = ref<Set<string>>(new Set());
const lastClickedSongId = ref("");
const songListEl = ref<HTMLElement | null>(null);
/** 单首正在重试的歌曲 id（按钮 loading 用）。批量爬取期间禁用所有重试。 */
const retryingSongId = ref("");
/** 批量编辑对话框开关 */
const showBulkEditor = ref(false);
/** Cookie 更新对话框（站点限制 / 人机验证 / 手动入口） */
const showCookieDialog = ref(false);
/** 对话框触发来源，文案略有不同。 */
const cookieDialogTrigger = ref<"auto" | "manual" | "human-verify">("manual");
/** 对话框 textarea 绑定的 Cookie 字符串。 */
const cookieDialogText = ref("");
/** 对话框内的临时提示（保存成功/失败等） */
const cookieDialogHint = ref("");
const cookieDialogSaving = ref(false);
/** 持久化防抖句柄 */
let persistSongsTimer: ReturnType<typeof setTimeout> | null = null;
const images = ref<MediaEntry[]>([]);
const selectedImage = ref("");
const infoMessage = ref("");
const infoVisible = ref(false);
let infoHideTimer: ReturnType<typeof setTimeout> | null = null;
let infoClearTimer: ReturnType<typeof setTimeout> | null = null;
const editableBoxes = ref<EditableBox[]>([]);
/** 每张图已识别/编辑的 OCR 框，切换图片时恢复，除非对该图重新「识别当前图」 */
const boxesByImage = ref<Record<string, EditableBox[]>>({});
const activeBoxId = ref("");
const previewImageEl = ref<HTMLImageElement | null>(null);
/** 大图滚动容器，用于把选中的 OCR 框滚进可视区域 */
const previewViewportEl = ref<HTMLElement | null>(null);
const ocrTerminalEl = ref<HTMLElement | null>(null);
const previewDataUrl = ref("");
const dropZoneActive = ref(false);
const recognizing = ref(false);
const detecting = ref(false);
const previewLoading = ref(false);
const pickingDialog = ref(false);
/** 仅当用户正在看「当前正在被批量扫描」的那张图时显示加载遮罩 */
const batchScanningSelected = computed(() => {
  if (!running.value || !selectedImage.value) return false;
  const key = imageCacheKey(selectedImage.value);
  return runStore.batchCurrentKey === key;
});
const previewBusy = computed(
  () => previewLoading.value || detecting.value || recognizing.value || batchScanningSelected.value,
);
const pendingRecognizeCount = computed(() => editableBoxes.value.filter((b) => b.pendingRecognize).length);
const canRecognizePendingBoxes = computed(() => pendingRecognizeCount.value > 0 && !recognizing.value);
/** 当前图中算法标为未配对的行（蓝框），便于手工改字或改角色 */
const unpairedBoxesOnImage = computed(() => editableBoxes.value.filter((b) => b.role === "unpaired"));
const canGotoNextUnpairedHere = computed(
  () => unpairedBoxesOnImage.value.length > 0 && !previewBusy.value && !!selectedImage.value,
);
const previewLoadingHint = computed(() => {
  if (batchScanningSelected.value) return "正在识别这张截图…";
  if (detecting.value) return "正在识别截图…";
  if (recognizing.value) return "正在识别新框…";
  if (previewLoading.value) return "正在加载图片…";
  return "";
});

function stripRunLogLine(raw: string) {
  const m = raw.match(/^\[(stdout|stderr)\]\s*(.*)$/);
  return m ? m[2] : raw;
}

const ocrTerminalText = computed(() => {
  const lines = logs.value
    .map(stripRunLogLine)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      const progressMatch = trimmed.match(/^\[OCR-PROGRESS\]\s*(\d+)\s+(.+)$/);
      if (progressMatch) {
        const percent = progressMatch[1].padStart(3, " ");
        return `[${percent}%] ${progressMatch[2]}`;
      }
      return trimmed;
    })
    .filter(Boolean);
  if (lines.length) return lines.join("\n");
  if (running.value && ocrBatchActive.value) {
    if (batchPhase.value === "warming") return "正在启动子进程，等待引擎加载输出…";
    return "等待子进程输出…";
  }
  return "就绪。开始扫描后，引擎加载与识别过程会实时显示在此。";
});

function scrollOcrTerminalToBottom() {
  void nextTick(() => {
    const el = ocrTerminalEl.value;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  });
}
let dragRafId = 0;
let pendingDragEvent: MouseEvent | null = null;

const imgRender = reactive({ displayW: 1, displayH: 1, naturalW: 1, naturalH: 1 });
/** OCR 框使用的原图像素宽高（按图缓存）；缩略图被下采样时不会再让框错位 */
const ocrSourceDimsByImage = ref<Record<string, { w: number; h: number }>>({});
const dragState = reactive({
  boxId: "",
  mode: "move" as "move" | "resize",
  startX: 0,
  startY: 0,
  originX: 0,
  originY: 0,
  originW: 0,
  originH: 0,
});

const ocrForm = reactive({
  output: "songs.txt",
  merge: "overwrite",
  device: "auto",
});
const crawlForm = reactive({
  input: "songs.txt",
  output: "quark_results.csv",
  downloadDir: "downloads",
  mode: "A",
  bMethod: "http",
  linksOnly: false,
  delay: 0.8,
  timeout: 40,
});

const selectedImageUrl = computed(() => previewDataUrl.value);
const activeBox = computed(() => editableBoxes.value.find((v) => v.id === activeBoxId.value));

function showInfoMessage(message: string, durationMs = 4500) {
  if (!message.trim()) return;
  if (infoHideTimer) clearTimeout(infoHideTimer);
  if (infoClearTimer) clearTimeout(infoClearTimer);
  infoMessage.value = message;
  infoVisible.value = true;
  infoHideTimer = setTimeout(() => {
    infoVisible.value = false;
    infoHideTimer = null;
    infoClearTimer = setTimeout(() => {
      infoMessage.value = "";
      infoClearTimer = null;
    }, 500);
  }, durationMs);
}
function hideInfoMessage() {
  if (infoHideTimer) clearTimeout(infoHideTimer);
  if (infoClearTimer) clearTimeout(infoClearTimer);
  infoHideTimer = null;
  infoClearTimer = null;
  infoVisible.value = false;
  infoMessage.value = "";
}
function basename(path: string) {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? path;
}
/**
 * 把 OCR 识别出的歌名/歌手清理成可用于搜索的字符串：
 *  1) 删除所有完整括号对（中英文圆/方括号）及内部内容
 *  2) 残留的左括号未闭合 → 视为被截断的注释，删除「(」到行尾（或下一个 `-` 之前）
 *  3) 删除播放量后缀：`125w+` / `1K+` / `200万+` / `1260w` 等
 *  4) 合并空白并 trim
 *
 *  注：孤立的「右括号」不处理（保留原样），避免误伤艺人名/歌名里作为正文的 `)`。
 */
function normalizeName(value: string) {
  let s = value;
  // 1) 完整括号对（迭代处理嵌套，最多 5 层）
  for (let i = 0; i < 5; i++) {
    const next = s.replace(/[(（[【][^()（）[\]【】]*[)）\]】]/g, " ");
    if (next === s) break;
    s = next;
  }
  // 2) 残留左括号（未闭合）：从「(」起到行尾或下一个分隔符 `-` 之前
  s = s.replace(/[(（[【][^-—–]*?(?=[-—–]|$)/g, " ");
  // 3) 播放量后缀：125w+ / 1K+ / 200万+ / 1.5亿 / 1260w
  s = s.replace(/\s*\d+(?:\.\d+)?\s*[wWkK万亿]\+?\s*/g, " ");
  // 4) 合并空白并 trim
  return s.replace(/\s+/g, " ").trim();
}
function parseSongArtist(line: string): { song: string; artist: string } | null {
  const clean = normalizeName(line).replace(/[—–－]/g, "-");
  const dashMatch = clean.match(/^(.+?)\s*-\s*(.+)$/);
  if (dashMatch) return { song: normalizeName(dashMatch[1]), artist: normalizeName(dashMatch[2]) };
  return null;
}
function structuredSongsFromLines(rawLines: string[]) {
  const pairs: Array<{ song: string; artist: string }> = [];
  const remains: string[] = [];
  for (const line of rawLines.map(normalizeName).filter(Boolean)) {
    const parsed = parseSongArtist(line);
    if (parsed) pairs.push(parsed);
    else remains.push(line);
  }
  for (let i = 0; i < remains.length - 1; i += 2) {
    pairs.push({ song: remains[i], artist: remains[i + 1] });
  }
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const pair of pairs) {
    if (!pair.song || !pair.artist) continue;
    const key = `${pair.song.toLowerCase().replace(/\s+/g, "")}|${pair.artist.toLowerCase().replace(/\s+/g, "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`${pair.song}-${pair.artist}`);
  }
  return lines;
}

function clampBox(box: EditableBox): EditableBox {
  const base = ocrCoordBase();
  const maxW = base.w;
  const maxH = base.h;
  const x = Math.max(0, Math.min(maxW - 1, box.x));
  const y = Math.max(0, Math.min(maxH - 1, box.y));
  const w = Math.max(10, Math.min(maxW - x, box.w));
  const h = Math.max(10, Math.min(maxH - y, box.h));
  return { ...box, x, y, w, h };
}
function updateImageRenderMetrics() {
  const el = previewImageEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  imgRender.displayW = Math.max(1, rect.width);
  imgRender.displayH = Math.max(1, rect.height);
  imgRender.naturalW = Math.max(1, el.naturalWidth);
  imgRender.naturalH = Math.max(1, el.naturalHeight);
}
/** 将指定框滚入预览区可视范围（纵向） */
function scrollBoxIntoPreviewViewport(box: EditableBox) {
  const vp = previewViewportEl.value;
  if (!vp || !previewImageEl.value) return;
  updateImageRenderMetrics();
  const dims = selectedImage.value
    ? ocrSourceDimsByImage.value[imageCacheKey(selectedImage.value)]
    : undefined;
  const baseH = dims?.h && dims.h > 0 ? dims.h : imgRender.naturalH;
  const sy = imgRender.displayH / baseH;
  const pad = 8;
  const top = pad + box.y * sy;
  const bottom = top + box.h * sy;
  const margin = 28;
  const st = vp.scrollTop;
  const vh = vp.clientHeight;
  const viewBottom = st + vh;
  if (top < st + margin) {
    vp.scrollTop = Math.max(0, top - margin);
  } else if (bottom > viewBottom - margin) {
    vp.scrollTop = Math.min(Math.max(0, vp.scrollHeight - vh), bottom - vh + margin);
  }
}
/** 本图内循环：选中下一处「未配对」行并滚动到可见 */
function gotoNextUnpairedOnCurrentImage() {
  const list = unpairedBoxesOnImage.value;
  if (!list.length) {
    showInfoMessage("当前图没有未配对行（可先「识别当前图」或载入批量缓存）");
    return;
  }
  const cur = list.findIndex((b) => b.id === activeBoxId.value);
  const next = cur >= 0 ? (cur + 1) % list.length : 0;
  const target = list[next]!;
  activeBoxId.value = target.id;
  void nextTick(() => scrollBoxIntoPreviewViewport(target));
}
/**
 * 按列表顺序跳到「下一张」在 regions 缓存中含未配对的截图。
 * 会尝试从磁盘载入尚未打开过的图的缓存 JSON。
 */
async function gotoNextImageWithUnpaired() {
  if (!images.value.length) {
    showInfoMessage("请先选择文件夹或图片");
    return;
  }
  if (previewBusy.value) return;
  const n = images.value.length;
  const startIdx = Math.max(
    0,
    images.value.findIndex((img) => img.path === selectedImage.value),
  );
  for (let step = 1; step <= n; step++) {
    const idx = (startIdx + step) % n;
    const path = images.value[idx]!.path;
    const key = imageCacheKey(path);
    let boxes = boxesByImage.value[key];
    if (!boxes?.length) {
      await importRegionsFromCache(path);
      boxes = boxesByImage.value[key];
    }
    const unpaired = boxes?.filter((b) => b.role === "unpaired") ?? [];
    if (!unpaired.length) continue;
    selectedImage.value = path;
    await nextTick();
    activeBoxId.value = unpaired[0]!.id;
    await nextTick();
    scrollBoxIntoPreviewViewport(unpaired[0]!);
    showInfoMessage(`已打开 ${basename(path)}（${unpaired.length} 处未配对，可点「下一未配对」逐条处理）`);
    return;
  }
  showInfoMessage("列表中其他截图均无未配对行（或尚无 regions 缓存，需先批量扫描/识别）");
}
/**
 * 框坐标的「原图像素」分母：优先用 OCR 返回的原图尺寸，否则回退到 <img>.natural*。
 * boxStyle / addBox / clampBox / 拖拽换算必须都用同一个分母，否则
 * 显示框对了、但发给后端的 x/y/w/h 仍是缩略图坐标，会导致「识别新框」裁错位置。
 */
function ocrCoordBase() {
  const dims = selectedImage.value
    ? ocrSourceDimsByImage.value[imageCacheKey(selectedImage.value)]
    : undefined;
  return {
    w: dims?.w && dims.w > 0 ? dims.w : imgRender.naturalW,
    h: dims?.h && dims.h > 0 ? dims.h : imgRender.naturalH,
  };
}
function boxStyle(box: EditableBox) {
  const base = ocrCoordBase();
  const sx = imgRender.displayW / base.w;
  const sy = imgRender.displayH / base.h;
  return { left: `${box.x * sx}px`, top: `${box.y * sy}px`, width: `${box.w * sx}px`, height: `${box.h * sy}px` };
}
function boxClass(box: EditableBox) {
  const pending = box.pendingRecognize ? "border-dashed" : "";
  if (box.id === activeBoxId.value) return `border-cyan-300 bg-transparent ring-2 ring-cyan-300/80 ${pending}`;
  if (box.role === "title") return `border-emerald-400 bg-emerald-500/15 ${pending}`;
  if (box.role === "artist") return `border-amber-400 bg-amber-500/15 ${pending}`;
  if (box.role === "unpaired") return `border-sky-400 bg-sky-500/15 ${pending}`;
  return `border-zinc-400 bg-zinc-500/10 ${pending}`;
}
function boxRoleLabel(box: EditableBox) {
  if (box.role === "title") return "歌名";
  if (box.role === "artist") return "歌手";
  if (box.role === "unpaired") return box.note ? `未配对·${box.note}` : "未配对";
  return "手动";
}
function boxTitle(box: EditableBox) {
  const text = box.text?.trim() || "(空文本)";
  const role = boxRoleLabel(box);
  return role ? `${role} ${text}` : text;
}
function cloneBoxes(boxes: EditableBox[]) {
  return boxes.map((b) => ({ ...b }));
}
/** 统一路径格式，避免 Windows 大小写/斜杠差异导致缓存 miss */
function imageCacheKey(imagePath: string) {
  return runStore.toImageCacheKey(imagePath);
}
function imageScanStatus(imagePath: string) {
  return runStore.getImageStatus(imagePath);
}
function imageListRowClass(imagePath: string) {
  const status = imageScanStatus(imagePath);
  if (status === "scanning") return "bg-accent/10 text-accent";
  if (status === "done") return "text-zinc-300";
  if (status === "error") return "text-red-400/90";
  return "";
}
function persistBoxesForImage(imagePath: string) {
  if (!imagePath) return;
  const key = imageCacheKey(imagePath);
  boxesByImage.value[key] = cloneBoxes(editableBoxes.value);
}
function restoreBoxesForImage(imagePath: string) {
  if (!imagePath) {
    editableBoxes.value = [];
    activeBoxId.value = "";
    return;
  }
  const cached = boxesByImage.value[imageCacheKey(imagePath)];
  editableBoxes.value = cached ? cloneBoxes(cached) : [];
  activeBoxId.value = editableBoxes.value[0]?.id ?? "";
}
function selectBox(id: string) {
  activeBoxId.value = id;
}
function onBoxMouseDown(event: MouseEvent, box: EditableBox, mode: "move" | "resize" = "move") {
  if (recognizing.value) return;
  event.preventDefault();
  event.stopPropagation();
  activeBoxId.value = box.id;
  dragState.boxId = box.id;
  dragState.mode = mode;
  dragState.startX = event.clientX;
  dragState.startY = event.clientY;
  dragState.originX = box.x;
  dragState.originY = box.y;
  dragState.originW = box.w;
  dragState.originH = box.h;
}
function addBox() {
  const base = ocrCoordBase();
  const newBox: EditableBox = {
    id: `box-${Date.now()}`,
    x: Math.max(0, base.w * 0.35),
    y: Math.max(0, base.h * 0.35),
    w: Math.max(80, base.w * 0.25),
    h: Math.max(28, base.h * 0.05),
    text: "",
    score: 0,
    role: "title",
    pendingRecognize: true,
  };
  editableBoxes.value = [...editableBoxes.value, clampBox(newBox)];
  activeBoxId.value = newBox.id;
  persistBoxesForImage(selectedImage.value);
  showInfoMessage("已添加「歌名」框：调整好后点「识别新框」");
}
function updateActiveBoxRole(raw: string) {
  if (!activeBox.value) return;
  const role = raw === "title" || raw === "artist" || raw === "unpaired" ? raw : undefined;
  editableBoxes.value = editableBoxes.value.map((box) =>
    box.id === activeBox.value?.id ? { ...box, role, note: role === "unpaired" ? box.note : undefined } : box,
  );
  persistBoxesForImage(selectedImage.value);
}
function removeActiveBox() {
  if (!activeBoxId.value) return;
  editableBoxes.value = editableBoxes.value.filter((box) => box.id !== activeBoxId.value);
  activeBoxId.value = editableBoxes.value[0]?.id ?? "";
  persistBoxesForImage(selectedImage.value);
}
function editActiveText() {
  if (!activeBox.value) return;
  const next = window.prompt("修改该框文本", activeBox.value.text);
  if (next === null) return;
  editableBoxes.value = editableBoxes.value.map((box) =>
    box.id === activeBox.value?.id ? { ...box, text: next.trim(), pendingRecognize: false } : box,
  );
  persistBoxesForImage(selectedImage.value);
}
function updateActiveBox(field: "x" | "y" | "w" | "h" | "text", raw: string) {
  if (!activeBox.value) return;
  editableBoxes.value = editableBoxes.value.map((box) => {
    if (box.id !== activeBox.value?.id) return box;
    if (field === "text") return { ...box, text: raw, pendingRecognize: false };
    const num = Number(raw);
    if (!Number.isFinite(num)) return box;
    return clampBox({ ...box, [field]: num });
  });
}
function applyDragUpdate() {
  dragRafId = 0;
  const event = pendingDragEvent;
  pendingDragEvent = null;
  if (!event || !dragState.boxId) return;

  const idx = editableBoxes.value.findIndex((box) => box.id === dragState.boxId);
  if (idx < 0) return;

  const base = ocrCoordBase();
  const sx = base.w / imgRender.displayW;
  const sy = base.h / imgRender.displayH;
  const dx = (event.clientX - dragState.startX) * sx;
  const dy = (event.clientY - dragState.startY) * sy;
  const box = editableBoxes.value[idx];
  const next =
    dragState.mode === "move"
      ? clampBox({ ...box, x: dragState.originX + dx, y: dragState.originY + dy })
      : clampBox({ ...box, w: dragState.originW + dx, h: dragState.originH + dy });
  if (next.x === box.x && next.y === box.y && next.w === box.w && next.h === box.h) return;

  const copy = editableBoxes.value.slice();
  copy[idx] = next;
  editableBoxes.value = copy;
}
function onGlobalMouseMove(event: MouseEvent) {
  if (!dragState.boxId) return;
  pendingDragEvent = event;
  if (dragRafId) return;
  dragRafId = requestAnimationFrame(applyDragUpdate);
}
function onGlobalMouseUp() {
  const wasDragging = !!dragState.boxId;
  if (dragRafId) {
    cancelAnimationFrame(dragRafId);
    dragRafId = 0;
  }
  pendingDragEvent = null;
  dragState.boxId = "";
  dragState.mode = "move";
  if (wasDragging && selectedImage.value) persistBoxesForImage(selectedImage.value);
}

async function refreshImages() {
  if (ocrInputSource.value === "files") {
    if (!images.value.length) {
      showInfoMessage("当前为自选图片模式，请用「选择图片」或拖入截图");
    }
    return;
  }
  try {
    images.value = await invoke<MediaEntry[]>("list_media_files", { relativeDir: ocrInputFolder.value });
    selectedImage.value = images.value[0]?.path ?? "";
    await loadPreviewImage();
  } catch (err) {
    showInfoMessage(`读取截图列表失败：${err instanceof Error ? err.message : String(err)}`, 6000);
  }
}
async function loadPreviewImage() {
  if (!selectedImage.value) {
    previewDataUrl.value = "";
    previewLoading.value = false;
    return;
  }
  previewLoading.value = true;
  try {
    previewDataUrl.value = await invoke<string>("read_image_preview_data_url", {
      path: selectedImage.value,
      maxWidth: 1600,
      maxHeight: 3200,
    });
  } catch (err) {
    previewDataUrl.value = "";
    showInfoMessage(`预览图加载失败：${err instanceof Error ? err.message : String(err)}`, 6000);
  } finally {
    previewLoading.value = false;
  }
}
async function pickFolder() {
  if (pickingDialog.value) return;
  pickingDialog.value = true;
  try {
    const folder = await invoke<string | null>("pick_folder");
    if (!folder) return;
    ocrInputSource.value = "folder";
    ocrInputFolder.value = folder;
    pushDebugLine("歌单OCR", "pick-folder", `选择文件夹：${folder}`);
    await refreshImages();
  } finally {
    pickingDialog.value = false;
  }
}
async function pickDownloadDir() {
  if (pickingDialog.value) return;
  pickingDialog.value = true;
  try {
    const folder = await invoke<string | null>("pick_folder");
    if (!folder) return;
    crawlForm.downloadDir = folder;
    showInfoMessage(`下载目录已设置为：${folder}`, 4000);
    pushDebugLine("音乐爬取", "pick-download-dir", `选择下载目录：${folder}`);
  } finally {
    pickingDialog.value = false;
  }
}
async function pickInputSongFile() {
  if (pickingDialog.value) return;
  pickingDialog.value = true;
  try {
    const file = await invoke<string | null>("pick_song_list_file");
    if (!file) return;
    crawlForm.input = file;
    showInfoMessage(`输入歌单文件：${file}`, 4000);
    pushDebugLine("音乐爬取", "pick-input-songs", `选择输入歌单：${file}`);
  } finally {
    pickingDialog.value = false;
  }
}
async function pickOutputCsvFile() {
  if (pickingDialog.value) return;
  pickingDialog.value = true;
  try {
    const file = await invoke<string | null>("pick_save_file", {
      defaultName: "quark_results.csv",
      filterLabel: "CSV",
      filterExts: ["csv"],
    });
    if (!file) return;
    crawlForm.output = file;
    showInfoMessage(`结果 CSV：${file}`, 4000);
    pushDebugLine("音乐爬取", "pick-output-csv", `选择结果 CSV：${file}`);
  } finally {
    pickingDialog.value = false;
  }
}
async function pickSingleImage() {
  if (pickingDialog.value) return;
  pickingDialog.value = true;
  try {
    const files = await invoke<string[]>("pick_image_files");
    if (!files.length) return;
    ocrInputSource.value = "files";
    images.value = files.map((path) => ({ name: basename(path), path }));
    selectedImage.value = files[0];
    pushDebugLine("歌单OCR", "pick-images", `选择 ${files.length} 张图片`, {
      names: files.map((p) => basename(p)),
    });
    await loadPreviewImage();
  } finally {
    pickingDialog.value = false;
  }
}
function onDropImage(event: DragEvent) {
  event.preventDefault();
  dropZoneActive.value = false;
  const file = event.dataTransfer?.files?.[0] as File & { path?: string };
  let path = file?.path ?? "";
  if (!path) {
    const uri = event.dataTransfer?.getData("text/uri-list") ?? "";
    if (uri.startsWith("file://")) {
      path = decodeURIComponent(uri.replace("file:///", "").replace(/\//g, "\\"));
    }
  }
  if (!path) {
    showInfoMessage("未读取到本地路径，请改用“选择单图”按钮");
    return;
  }
  if (!/\.(png|jpg|jpeg|webp)$/i.test(path)) {
    showInfoMessage("只支持图片文件拖入（png/jpg/jpeg/webp）");
    return;
  }
  ocrInputSource.value = "files";
  images.value = [{ name: basename(path), path }];
  selectedImage.value = path;
  pushDebugLine("歌单OCR", "drop-image", `拖入图片：${basename(path)}`, { path });
  void loadPreviewImage();
}

type DetectRegion = {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  score: number;
  role?: BoxRole;
  pairIndex?: number;
  note?: string;
  /** 原图像素宽高（来自 Python OCR），前端用它换算缩略图上的显示坐标 */
  imageWidth?: number;
  imageHeight?: number;
};

function mapDetectResultToBoxes(result: DetectRegion[], idPrefix: string): EditableBox[] {
  return result.map((box, index) => ({
    id: `${idPrefix}-${index}`,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    text: box.text ?? "",
    score: box.score ?? 0,
    role: box.role,
    pairIndex: box.pairIndex,
    note: box.note,
    pendingRecognize: false,
  }));
}

/** 从 OCR 返回的任一 region 提取原图宽高并按图缓存，供 boxStyle 使用 */
function captureOcrSourceDims(imagePath: string, regions: DetectRegion[]) {
  if (!imagePath || !regions.length) return;
  const first = regions.find((r) => r.imageWidth && r.imageHeight);
  if (!first || !first.imageWidth || !first.imageHeight) return;
  const key = imageCacheKey(imagePath);
  ocrSourceDimsByImage.value = {
    ...ocrSourceDimsByImage.value,
    [key]: { w: first.imageWidth, h: first.imageHeight },
  };
}

async function fetchDetectBoxesForImage(imagePath: string): Promise<EditableBox[]> {
  const t0 = performance.now();
  pushDebugLine("歌单OCR", "detect-start", `识别当前图：${basename(imagePath)}`, {
    path: imagePath,
    device: ocrForm.device,
  });
  try {
    const result = await invoke<DetectRegion[]>("detect_image_regions", {
      imagePath,
      device: ocrForm.device,
    });
    captureOcrSourceDims(imagePath, result);
    const ms = Math.round(performance.now() - t0);
    pushDebugLine("歌单OCR", "detect-done", `检测完成 ${result.length} 个框，耗时 ${ms}ms`, {
      roles: result.reduce(
        (acc, b) => {
          const r = b.role ?? "unknown";
          acc[r] = (acc[r] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
    });
    return mapDetectResultToBoxes(result, `d-${imageCacheKey(imagePath).slice(-12)}-${Date.now()}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    pushDebugLine("歌单OCR", "detect-error", msg, { path: imagePath });
    throw err;
  }
}

function regionsCachePath(imageFileName: string) {
  return `${REGIONS_CACHE_DIR}/${imageFileName}.regions.json`;
}

/** 从批量扫描导出的 JSON 加载 OCR 框（不启动 Python，无全屏 loading） */
async function importRegionsFromCache(imagePath: string, imageFileName?: string) {
  if (!imagePath) return false;
  const key = imageCacheKey(imagePath);
  if (boxesByImage.value[key]?.length) {
    if (selectedImage.value === imagePath) restoreBoxesForImage(imagePath);
    return true;
  }
  const fileName = imageFileName ?? basename(imagePath);
  try {
    const text = await invoke<string>("read_workspace_file", {
      relativePath: regionsCachePath(fileName),
    });
    const regions = JSON.parse(text) as DetectRegion[];
    captureOcrSourceDims(imagePath, regions);
    const boxes = mapDetectResultToBoxes(regions, `b-${key.slice(-10)}`);
    boxesByImage.value[key] = boxes;
    if (selectedImage.value === imagePath) {
      editableBoxes.value = cloneBoxes(boxes);
      activeBoxId.value = editableBoxes.value[0]?.id ?? "";
      await nextTick();
      updateImageRenderMetrics();
    }
    return true;
  } catch {
    return false;
  }
}

async function detectCurrentImage() {
  if (!selectedImage.value) {
    showInfoMessage("请先在左侧选择截图");
    return;
  }
  if (detecting.value) return;
  detecting.value = true;
  try {
    editableBoxes.value = await fetchDetectBoxesForImage(selectedImage.value);
    activeBoxId.value = editableBoxes.value[0]?.id ?? "";
    const pairCount = editableBoxes.value.filter((b) => b.role === "title").length;
    const unpairedCount = editableBoxes.value.filter((b) => b.role === "unpaired").length;
    persistBoxesForImage(selectedImage.value);
    showInfoMessage(`已识别 ${pairCount} 对歌曲（${editableBoxes.value.length} 个框${unpairedCount ? `，${unpairedCount} 个未配对` : ""}）`);
  } catch (err) {
    showInfoMessage(`检测图片失败：${err instanceof Error ? err.message : String(err)}`, 8000);
  } finally {
    detecting.value = false;
    await nextTick();
    updateImageRenderMetrics();
  }
}
async function recognizeCurrentBoxes() {
  if (!selectedImage.value || !canRecognizePendingBoxes.value) return;
  const pending = editableBoxes.value
    .map((box, index) => ({ box, index }))
    .filter((item) => item.box.pendingRecognize);
  if (!pending.length) return;

  recognizing.value = true;
  showInfoMessage(`正在识别 ${pending.length} 个新框…`, 12000);
  pushDebugLine("歌单OCR", "recognize-boxes-start", `按框重识别 ${pending.length} 个新框`, {
    image: basename(selectedImage.value),
    device: ocrForm.device,
  });
  try {
    const result = await invoke<Array<{ index: number; text: string; score: number }>>("recognize_regions", {
      imagePath: selectedImage.value,
      boxes: pending.map((item) => ({
        x: item.box.x,
        y: item.box.y,
        w: item.box.w,
        h: item.box.h,
        text: item.box.text,
      })),
      device: ocrForm.device,
    });
    const next = [...editableBoxes.value];
    for (const row of result) {
      const target = pending[row.index];
      if (!target) continue;
      const box = next[target.index];
      if (!box) continue;
      next[target.index] = {
        ...box,
        text: row.text ?? "",
        score: row.score ?? 0,
        pendingRecognize: false,
      };
    }
    editableBoxes.value = next;
    persistBoxesForImage(selectedImage.value);
    pushDebugLine("歌单OCR", "recognize-boxes-done", `新框识别完成：${result.length} 个`, {
      texts: result.map((r) => r.text),
    });
    showInfoMessage(`新框识别完成（${result.length} 个）`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    pushDebugLine("歌单OCR", "recognize-boxes-error", msg);
    showInfoMessage(`重识别失败：${msg}`, 8000);
  } finally {
    recognizing.value = false;
    await nextTick();
    updateImageRenderMetrics();
  }
}
/** 把规范化后的 `song-artist` 行数组转成 SongItem，去重时按 songKeyFromItem。
 * `oldMap` 提供「编辑前」每个 key 的状态，用于编辑后继承（批量编辑/导入文件场景）。 */
function songItemsFromLines(
  lines: string[],
  oldMap?: Map<string, { status: SongStatus; note?: string }>,
): SongItem[] {
  const seen = new Set<string>();
  const out: SongItem[] = [];
  for (const raw of structuredSongsFromLines(lines)) {
    const parsed = parseSongArtist(raw);
    if (!parsed) continue;
    const key = songKeyFromItem(parsed);
    if (seen.has(key)) continue;
    seen.add(key);
    const prev = oldMap?.get(key);
    out.push({
      id: makeSongId(),
      song: parsed.song,
      artist: parsed.artist,
      status: prev?.status ?? "pending",
      note: prev?.note,
    });
  }
  return out;
}
function songItemsToLines(items: SongItem[]): string[] {
  return items.map((s) => songQuery(s)).filter(Boolean);
}
function songItemsToText(items: SongItem[]): string {
  const lines = songItemsToLines(items);
  return lines.length ? `${lines.join("\n")}\n` : "";
}
function existingStatusMap(items: SongItem[]) {
  const m = new Map<string, { status: SongStatus; note?: string }>();
  for (const s of items) m.set(songKeyFromItem(s), { status: s.status, note: s.note });
  return m;
}
/** 把外部输入的歌单行合并进 songItems：新行 status=pending，老行（按 key 命中）保留原 status。
 * 顺序：以传入的 lines 为准（用户最新意图），未在新列表中的老歌会被丢弃。 */
function mergeSongsFromLines(lines: string[]) {
  const oldMap = existingStatusMap(songItems.value);
  songItems.value = songItemsFromLines(lines, oldMap);
  clearSongSelection();
}
/** 在尾部追加新歌，已存在则跳过。用于「导入文件」「阶段A 导入」时的「合并」语义。 */
function appendSongsFromLines(lines: string[]) {
  const oldMap = existingStatusMap(songItems.value);
  const incoming = songItemsFromLines(lines);
  const existingKeys = new Set(songItems.value.map((s) => songKeyFromItem(s)));
  const added: SongItem[] = [];
  for (const s of incoming) {
    const key = songKeyFromItem(s);
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    const prev = oldMap.get(key);
    added.push({ ...s, status: prev?.status ?? "pending", note: prev?.note });
  }
  if (!added.length) return 0;
  songItems.value = [...songItems.value, ...added];
  return added.length;
}

function importBoxesToSongs() {
  const lines: string[] = [];
  const byPair = new Map<number, { title?: string; artist?: string }>();
  for (const box of editableBoxes.value) {
    if (box.role === "title" || box.role === "artist") {
      const key = box.pairIndex ?? 0;
      const cur = byPair.get(key) ?? {};
      if (box.role === "title") cur.title = normalizeName(box.text);
      else cur.artist = normalizeName(box.text);
      byPair.set(key, cur);
    }
  }
  for (const pair of byPair.values()) {
    if (pair.title && pair.artist) lines.push(`${pair.title}-${pair.artist}`);
  }
  const fallback = structuredSongsFromLines(
    editableBoxes.value.filter((b) => b.role === "unpaired" || !b.role).map((b) => b.text),
  );
  const merged = structuredSongsFromLines([...lines, ...fallback]);
  if (!merged.length) {
    showInfoMessage("当前框无法整理出有效歌单");
    return;
  }
  const before = songItems.value.length;
  const added = appendSongsFromLines(merged);
  showInfoMessage(`已合并到歌曲列表：新增 ${added} 首，跳过 ${merged.length - added} 首重复（当前共 ${before + added} 首）`);
  stage.value = "crawl";
}
async function importPlaylistFile() {
  const file = await invoke<string | null>("pick_text_file");
  if (!file) return;
  try {
    const text = await invoke<string>("read_text_file", { path: file });
    const merged = structuredSongsFromLines(text.split(/\r?\n/));
    const added = appendSongsFromLines(merged);
    showInfoMessage(`已导入并合并：${basename(file)}（新增 ${added} 首，当前共 ${songItems.value.length} 首）`);
  } catch (err) {
    showInfoMessage(`导入歌单失败：${err instanceof Error ? err.message : String(err)}`, 6000);
  }
}

async function loadSongs() {
  try {
    const text = await invoke<string>("read_workspace_file", { relativePath: ocrForm.output });
    appendSongsFromLines(text.split(/\r?\n/));
  } catch {
    // 文件不存在时不动现有列表
  }
}
/** 把 songItems 中「未下载 / 失败」的歌曲写入 crawlForm.input，跳过已成功项。
 * 返回实际写入的歌曲数；为 0 时调用方应阻止启动。 */
async function saveSongs(): Promise<number> {
  try {
    const pending = songItems.value.filter((s) => s.status !== "success");
    const text = pending.map((s) => songQuery(s)).join("\n") + (pending.length ? "\n" : "");
    await invoke("write_workspace_file", { relativePath: crawlForm.input, content: text });
    if (pending.length) {
      const skipped = songItems.value.length - pending.length;
      const skipHint = skipped > 0 ? `（已自动跳过 ${skipped} 首成功）` : "";
      showInfoMessage(`已写入 ${crawlForm.input}：${pending.length} 首${skipHint}`);
    }
    return pending.length;
  } catch (err) {
    showInfoMessage(`写入 songs 失败：${err instanceof Error ? err.message : String(err)}`, 6000);
    return 0;
  }
}

// ----- 多选交互 -----
function clearSongSelection() {
  selectedSongIds.value = new Set();
  lastClickedSongId.value = "";
}
function onSongRowClick(item: SongItem, ev: MouseEvent) {
  if (ev.shiftKey && lastClickedSongId.value) {
    const ids = songItems.value.map((s) => s.id);
    const a = ids.indexOf(lastClickedSongId.value);
    const b = ids.indexOf(item.id);
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      const next = new Set(selectedSongIds.value);
      for (let i = lo; i <= hi; i++) next.add(ids[i]);
      selectedSongIds.value = next;
      return;
    }
  }
  if (ev.ctrlKey || ev.metaKey) {
    const next = new Set(selectedSongIds.value);
    if (next.has(item.id)) next.delete(item.id);
    else next.add(item.id);
    selectedSongIds.value = next;
    lastClickedSongId.value = item.id;
    return;
  }
  selectedSongIds.value = new Set([item.id]);
  lastClickedSongId.value = item.id;
}
function removeSelectedSongs() {
  if (!selectedSongIds.value.size) return;
  const ids = selectedSongIds.value;
  const kept = songItems.value.filter((s) => !ids.has(s.id));
  const removed = songItems.value.length - kept.length;
  songItems.value = kept;
  clearSongSelection();
  if (removed > 0) showInfoMessage(`已删除 ${removed} 首`);
}
function selectAllSongs() {
  selectedSongIds.value = new Set(songItems.value.map((s) => s.id));
  lastClickedSongId.value = songItems.value[songItems.value.length - 1]?.id ?? "";
}
function onSongListKeyDown(ev: KeyboardEvent) {
  if (ev.key === "Delete" || ev.key === "Backspace") {
    if (!selectedSongIds.value.size) return;
    ev.preventDefault();
    removeSelectedSongs();
    return;
  }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "a") {
    ev.preventDefault();
    selectAllSongs();
  }
}

// ----- 批量编辑对话框 -----
function openBulkEditor() {
  songsText.value = songItemsToText(songItems.value);
  showBulkEditor.value = true;
}
function closeBulkEditor() {
  showBulkEditor.value = false;
}
function applyBulkEditor() {
  const lines = songsText.value.split(/\r?\n/);
  mergeSongsFromLines(lines);
  showBulkEditor.value = false;
  showInfoMessage(`已应用：当前 ${songItems.value.length} 首（未改文本的状态已保留）`);
}

// ----- Cookie 更新对话框 -----
function openCookieDialog(trigger: "auto" | "manual" | "human-verify" = "manual") {
  cookieDialogTrigger.value = trigger;
  cookieDialogText.value = "";
  cookieDialogHint.value = "";
  showCookieDialog.value = true;
}
function closeCookieDialog() {
  if (cookieDialogSaving.value) return;
  showCookieDialog.value = false;
  runStore.ackSiteRateLimit();
  runStore.ackHumanVerify();
}
async function openExternalSite() {
  try {
    await openUrl("https://www.2t58.com/");
    pushDebugLine("音乐爬取", "open-2t58", "已打开 https://www.2t58.com/");
  } catch (err) {
    cookieDialogHint.value = `打开浏览器失败：${err instanceof Error ? err.message : String(err)}`;
  }
}
function cookieDialogTitle(): string {
  if (cookieDialogTrigger.value === "auto") return "2t58 下载受限，需要更新 Cookie";
  if (cookieDialogTrigger.value === "human-verify") return "2t58 人机验证失败，需要手动完成";
  return "更新 2t58 Cookie";
}
function cookieDialogBanner(): string {
  if (cookieDialogTrigger.value === "human-verify") {
    return humanVerifyMessage.value || "自动过人机验证失败，请在浏览器完成验证后更新 Cookie。";
  }
  if (cookieDialogTrigger.value === "auto") {
    return siteRateLimitMessage.value;
  }
  return "";
}
/** 内部：保存当前 textarea 的 cookie。成功返回解析到的条数，失败抛错。 */
async function saveCookieFromDialog(): Promise<number> {
  const text = cookieDialogText.value.trim();
  if (!text) throw new Error("请先粘贴 Cookie");
  cookieDialogSaving.value = true;
  try {
    const count = await invoke<number>("update_2t58_cookies", { cookieText: text });
    pushDebugLine("音乐爬取", "cookie-updated", `已写入 ${count} 条 2t58 Cookie`);
    return count;
  } finally {
    cookieDialogSaving.value = false;
  }
}
async function onlySaveCookie() {
  try {
    const n = await saveCookieFromDialog();
    cookieDialogHint.value = `已保存 ${n} 条 Cookie 到 2t58_cookies.json`;
    showInfoMessage(`Cookie 已更新（${n} 条）`);
    runStore.ackSiteRateLimit();
    runStore.ackHumanVerify();
    setTimeout(() => {
      showCookieDialog.value = false;
    }, 600);
  } catch (err) {
    cookieDialogHint.value = err instanceof Error ? err.message : String(err);
  }
}
async function saveCookieAndRetry() {
  try {
    const n = await saveCookieFromDialog();
    cookieDialogHint.value = `已保存 ${n} 条 Cookie，正在重试失败项…`;
    runStore.ackSiteRateLimit();
    runStore.ackHumanVerify();
    showCookieDialog.value = false;
    if (runnableCount.value === 0) {
      showInfoMessage(`Cookie 已更新（${n} 条），但目前没有失败/未爬取项可重试`);
      return;
    }
    if (running.value) {
      showInfoMessage(`Cookie 已更新（${n} 条）；当前还有任务在运行，请等结束后再点重新爬取`);
      return;
    }
    await runCrawl();
  } catch (err) {
    cookieDialogHint.value = err instanceof Error ? err.message : String(err);
  }
}

// ----- 持久化 -----
async function persistSongs(immediate = false) {
  const run = async () => {
    try {
      const payload = JSON.stringify(
        songItems.value.map((s) => ({
          song: s.song,
          artist: s.artist,
          status: s.status,
          note: s.note ?? "",
        })),
        null,
        2,
      );
      await invoke("write_workspace_file", { relativePath: SONGS_STATE_PATH, content: payload });
    } catch (err) {
      pushDebugLine("音乐爬取", "persist-songs-error", err instanceof Error ? err.message : String(err));
    }
  };
  if (immediate) {
    if (persistSongsTimer) {
      clearTimeout(persistSongsTimer);
      persistSongsTimer = null;
    }
    await run();
    return;
  }
  if (persistSongsTimer) clearTimeout(persistSongsTimer);
  persistSongsTimer = setTimeout(() => {
    persistSongsTimer = null;
    void run();
  }, 400);
}
async function loadSongsState() {
  try {
    const text = await invoke<string>("read_workspace_file", { relativePath: SONGS_STATE_PATH });
    const raw = JSON.parse(text) as Array<{ song?: string; artist?: string; status?: string; note?: string }>;
    if (!Array.isArray(raw)) return;
    const items: SongItem[] = [];
    const seen = new Set<string>();
    for (const r of raw) {
      // 应用最新清理规则（去括号/播放量后缀等），让历史脏数据也能自动洗干净
      const song = normalizeName(r.song ?? "");
      const artist = normalizeName(r.artist ?? "");
      if (!song) continue;
      const key = songKeyFromItem({ song, artist });
      if (seen.has(key)) continue;
      seen.add(key);
      const status: SongStatus = r.status === "success" || r.status === "failed" ? r.status : "pending";
      items.push({ id: makeSongId(), song, artist, status, note: r.note || undefined });
    }
    if (items.length) songItems.value = items;
  } catch {
    // 没有状态文件时不做任何事
  }
}

// ----- 单首失败重试 -----
/** 固定临时文件名，每次重试都覆盖，避免在 workspaces 目录里累积一堆 retry_*.txt。
 * 路径相对于 workspace_root（默认就是 workspaces/music_crawl），脚本 input 参数也是同样相对解析。 */
const SONGS_RETRY_RELATIVE = "songs_retry.txt";
async function retrySong(item: SongItem) {
  if (running.value || retryingSongId.value) return;
  if (item.status === "success") return;
  retryingSongId.value = item.id;
  const line = songQuery(item);
  try {
    await invoke("write_workspace_file", {
      relativePath: SONGS_RETRY_RELATIVE,
      content: `${line}\n`,
    });
  } catch (err) {
    retryingSongId.value = "";
    showInfoMessage(`生成临时清单失败：${err instanceof Error ? err.message : String(err)}`, 6000);
    return;
  }
  // 重试期间把这首歌标回 pending，等待日志更新
  patchSongStatus(item.id, "pending", "正在重试…");
  const params = { ...crawlForm, input: SONGS_RETRY_RELATIVE };
  hideInfoMessage();
  showInfoMessage(`正在重试：${line}`);
  pushDebugLine("音乐爬取", "song-retry", `单首重试：${line}`, { params });
  runStore.resetCrawl();
  try {
    await runStore.startTool("full_auto_download", params);
  } catch (err) {
    showInfoMessage(`重试启动失败：${err instanceof Error ? err.message : String(err)}`, 6000);
    retryingSongId.value = "";
  }
}
function patchSongStatus(id: string, status: SongStatus, note?: string) {
  songItems.value = songItems.value.map((s) =>
    s.id === id ? { ...s, status, note } : s,
  );
}
async function runOcr() {
  if (running.value) return;
  let imgs: MediaEntry[] = images.value.length ? [...images.value] : [];
  const useExplicitFiles = ocrInputSource.value === "files" && imgs.length > 0;

  if (!useExplicitFiles) {
    try {
      if (!imgs.length) {
        imgs = await invoke<MediaEntry[]>("list_media_files", { relativeDir: ocrInputFolder.value });
      }
      if (!imgs.length) {
        showInfoMessage(
          `截图目录为空或不存在：${ocrInputFolder.value}。请「选择文件夹」或「选择图片」`,
          8000,
        );
        return;
      }
      ocrInputSource.value = "folder";
      images.value = imgs;
    } catch (err) {
      showInfoMessage(`检查截图目录失败：${err instanceof Error ? err.message : String(err)}`, 6000);
      return;
    }
  }

  hideInfoMessage();
  detecting.value = false;
  recognizing.value = false;
  runStore.beginBatchScan(imgs);
  const first = imgs[0]?.path;
  if (first) selectedImage.value = first;
  const params: Record<string, unknown> = {
    ...ocrForm,
    review: "playlist_ocr/songs_review.txt",
    regionsDir: REGIONS_CACHE_DIR,
  };
  if (useExplicitFiles) {
    params.images = imgs.map((img) => img.path).join("|");
    pushDebugLine("歌单OCR", "scan-click", `开始批量扫描（自选 ${imgs.length} 张）`, {
      names: imgs.map((i) => i.name),
    });
  } else {
    params.input = ocrInputFolder.value;
    pushDebugLine("歌单OCR", "scan-click", `开始批量扫描（目录 ${ocrInputFolder.value}，${imgs.length} 张）`);
  }
  try {
    await runStore.startTool("playlist_ocr", params);
  } catch (err) {
    showInfoMessage(`启动 OCR 失败：${err instanceof Error ? err.message : String(err)}`, 6000);
  }
}
async function runCrawl() {
  if (running.value) return;
  const writtenCount = await saveSongs();
  if (writtenCount <= 0) {
    showInfoMessage("没有待下载的歌曲（全部已成功 / 列表为空）");
    return;
  }
  hideInfoMessage();
  runStore.resetBatch();
  runStore.resetCrawl();
  try {
    await runStore.startTool("full_auto_download", { ...crawlForm });
  } catch (err) {
    showInfoMessage(`启动爬取失败：${err instanceof Error ? err.message : String(err)}`, 6000);
  }
}
async function cancelRun() {
  await runStore.cancelRun();
}

watch(logs, () => {
  if (stage.value === "ocr") scrollOcrTerminalToBottom();
}, { deep: true });

watch(selectedImage, (path, prev) => {
  if (prev) persistBoxesForImage(prev);
  restoreBoxesForImage(path);
  void loadPreviewImage().then(async () => {
    await nextTick();
    updateImageRenderMetrics();
    if (path && !editableBoxes.value.length) await importRegionsFromCache(path);
  });
});

watch(lastRegionsReady, (item) => {
  if (!item) return;
  void importRegionsFromCache(item.path, item.name);
});

watch(
  () => runStore.lastExitCode,
  async (code) => {
    if (code === null) return;
    if (runStore.lastFinishedPlugin === "playlist_ocr") {
      if (code === 0) {
        await loadSongs();
        detecting.value = false;
        showInfoMessage(`批量识别完成，共 ${songs.value.length} 首，可点选图片查看 OCR 框`);
        if (selectedImage.value && !editableBoxes.value.length) {
          await importRegionsFromCache(selectedImage.value);
        }
      } else {
        const tail = logs.value.filter(Boolean).slice(-3).join("；");
        showInfoMessage(`批量识别失败（退出码 ${code}）${tail ? `：${tail}` : ""}`, 8000);
      }
      return;
    }
    if (runStore.lastFinishedPlugin === "full_auto_download") {
      // 重试结束后允许下一次重试；状态已经在 watch crawlStatuses 中实时同步
      if (retryingSongId.value) {
        retryingSongId.value = "";
      }
      const ok = songItems.value.filter((s) => s.status === "success").length;
      const failed = songItems.value.filter((s) => s.status === "failed").length;
      const pending = songItems.value.filter((s) => s.status === "pending").length;
      if (code === 0) {
        showInfoMessage(`下载结束：成功 ${ok}，失败 ${failed}，未处理 ${pending}`);
      } else {
        showInfoMessage(`爬取异常（退出码 ${code}）：成功 ${ok}，失败 ${failed}，未处理 ${pending}`, 8000);
      }
      void persistSongs(true);
    }
  },
);

/** 来自 store 的实时状态更新：把每首歌的最新成败写回 songItems。 */
watch(
  crawlStatuses,
  (next) => {
    if (!next || !songItems.value.length) return;
    let changed = false;
    const patched = songItems.value.map((s) => {
      const r: CrawlSongResult | undefined = next[songKeyFromItem(s)];
      if (!r) return s;
      if (s.status === r.status && (s.note ?? "") === (r.note ?? "")) return s;
      changed = true;
      return { ...s, status: r.status, note: r.note };
    });
    if (changed) songItems.value = patched;
  },
  { deep: true },
);

/** songItems 任何变动 → 防抖持久化到 workspaces/music_crawl/songs_state.json。 */
watch(
  songItems,
  () => {
    void persistSongs();
  },
  { deep: true },
);

/** 后端日志命中 [site-limit] 时自动弹出更新 Cookie 对话框。
 * 用 hitAt 时间戳触发，避免 store 同值二次写入时重复打开。 */
watch(siteRateLimitHitAt, (hitAt) => {
  if (!hitAt) return;
  openCookieDialog("auto");
});

/** 自动过人机验证失败：弹窗 + 自动打开网页，方便手动完成验证。 */
watch(humanVerifyHitAt, (hitAt) => {
  if (!hitAt) return;
  openCookieDialog("human-verify");
  void openExternalSite();
});

onMounted(async () => {
  window.addEventListener("mousemove", onGlobalMouseMove);
  window.addEventListener("mouseup", onGlobalMouseUp);
  void runStore.ensureListeners();
  void refreshImages();
  void loadPreviewImage();
  // 先恢复持久化状态，再合并 songs.txt 中新增的（未持久化过的）行
  await loadSongsState();
  await loadSongs();
});

onBeforeUnmount(() => {
  if (dragRafId) cancelAnimationFrame(dragRafId);
  if (infoHideTimer) clearTimeout(infoHideTimer);
  if (infoClearTimer) clearTimeout(infoClearTimer);
  if (persistSongsTimer) clearTimeout(persistSongsTimer);
  window.removeEventListener("mousemove", onGlobalMouseMove);
  window.removeEventListener("mouseup", onGlobalMouseUp);
});
</script>

<template>
  <div class="relative flex min-h-0 flex-1 flex-col p-6">
    <div class="mb-4 flex items-center gap-2">
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-zinc-400 transition hover:bg-white/5 hover:text-accent"
        @click="router.push('/')"
      >
        <Icon icon="mdi:arrow-left" />
        返回首页
      </button>

      <div class="ml-2 flex gap-1.5">
        <button
          type="button"
          class="rounded-lg px-3 py-1.5 text-sm transition"
          :class="stage === 'ocr' ? 'bg-accent text-black' : 'bg-black/30 text-zinc-300 hover:bg-black/40'"
          @click="stage = 'ocr'"
        >
          阶段A 识图校对
        </button>
        <button
          type="button"
          class="rounded-lg px-3 py-1.5 text-sm transition"
          :class="stage === 'crawl' ? 'bg-accent text-black' : 'bg-black/30 text-zinc-300 hover:bg-black/40'"
          @click="stage = 'crawl'"
        >
          阶段B 一键爬取
        </button>
      </div>

      <div class="ml-auto flex items-center gap-2 text-sm">
        <Icon icon="mdi:music" class="h-5 w-5 text-accent" />
        <span class="font-semibold text-zinc-100">一键爬取音乐</span>
        <span class="text-xs text-zinc-500">M2.5</span>
      </div>
    </div>

    <div v-motion :initial="{ opacity: 0, y: 12 }" :enter="{ opacity: 1, y: 0, transition: { duration: 0.4 } }" class="flex min-h-0 flex-1 flex-col gap-4">

      <div v-if="stage === 'ocr'" class="grid min-h-0 flex-1 grid-cols-12 items-stretch gap-4">
        <section class="col-span-3 min-h-0 rounded-xl border border-border bg-black/20 p-4">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-sm font-medium text-zinc-300">截图预览列表</h3>
            <button type="button" class="text-xs text-accent" @click="refreshImages">刷新</button>
          </div>
          <div class="max-h-[520px] space-y-1 overflow-y-auto pr-1 text-sm">
            <button
              v-for="img in images"
              :key="img.path"
              type="button"
              class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition"
              :class="[
                selectedImage === img.path ? 'bg-accent/20 text-accent ring-1 ring-accent/30' : 'text-zinc-400 hover:bg-white/5',
                imageListRowClass(img.path),
              ]"
              @click="selectedImage = img.path"
            >
              <Icon
                v-if="imageScanStatus(img.path) === 'scanning'"
                icon="mdi:loading"
                class="h-4 w-4 shrink-0 animate-spin text-accent"
              />
              <Icon
                v-else-if="imageScanStatus(img.path) === 'done'"
                icon="mdi:check-circle"
                class="h-4 w-4 shrink-0 text-emerald-400"
              />
              <Icon
                v-else-if="imageScanStatus(img.path) === 'error'"
                icon="mdi:alert-circle"
                class="h-4 w-4 shrink-0 text-red-400"
              />
              <span v-else class="h-4 w-4 shrink-0 rounded-full border border-zinc-600" />
              <span class="min-w-0 flex-1 truncate">{{ img.name }}</span>
            </button>
          </div>
        </section>

        <section class="col-span-4 flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-black/20 p-4">
          <h3 class="mb-3 shrink-0 text-sm font-medium text-zinc-300">OCR 参数</h3>
          <div class="shrink-0 space-y-3 text-sm">
            <div class="flex gap-2 text-xs">
              <button
                type="button"
                class="rounded border border-border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="pickingDialog"
                @click="pickFolder"
              >
                {{ pickingDialog ? "选择中…" : "选择文件夹" }}
              </button>
              <button
                type="button"
                class="rounded border border-border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="pickingDialog"
                @click="pickSingleImage"
              >
                选择图片（可多选）
              </button>
            </div>
            <div
              class="rounded border border-dashed px-2 py-2 text-xs transition"
              :class="dropZoneActive ? 'border-accent bg-accent/10 text-accent' : 'border-border text-zinc-500'"
              @dragover.prevent="dropZoneActive = true"
              @dragleave.prevent="dropZoneActive = false"
              @drop="onDropImage"
            >
              拖拽单张图片到此处可直接载入
            </div>
            <p v-if="images.length" class="text-xs text-zinc-500">
              已载入 {{ images.length }} 张截图
              <span v-if="ocrInputSource === 'files'">（自选图片）</span>
            </p>
            <label class="block">
              <span class="mb-1 block text-xs text-zinc-500">歌单输出文件</span>
              <input v-model="ocrForm.output" class="w-full rounded border border-border bg-black/40 px-2 py-1.5" placeholder="songs.txt" />
            </label>
            <div class="grid grid-cols-2 gap-2">
              <label class="block">
                <span class="mb-1 block text-xs text-zinc-500">写入方式</span>
                <select v-model="ocrForm.merge" class="w-full rounded border border-border bg-black/40 px-2 py-1.5">
                  <option value="append">追加到已有歌单</option>
                  <option value="overwrite">覆盖原歌单</option>
                </select>
              </label>
              <label class="block">
                <span class="mb-1 block text-xs text-zinc-500">识别速度</span>
                <select v-model="ocrForm.device" class="w-full rounded border border-border bg-black/40 px-2 py-1.5">
                  <option value="auto">自动</option>
                  <option value="cpu">仅 CPU</option>
                  <option value="gpu">GPU</option>
                  <option value="gpu:0">GPU 0</option>
                </select>
              </label>
            </div>
            <div v-if="ocrBatchActive" class="rounded-lg border border-border bg-black/30 p-3">
              <div class="mb-1.5 flex items-center justify-between text-xs text-zinc-400">
                <span>{{ batchStatusLabel }}</span>
                <span>{{ batchProgressPercent }}%</span>
              </div>
              <div class="h-2 overflow-hidden rounded-full bg-zinc-800">
                <div
                  class="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
                  :class="{ 'animate-pulse': batchPhase === 'warming' && engineLoadPercent === 0 }"
                  :style="{ width: `${batchProgressPercent}%` }"
                />
              </div>
            </div>
            <div class="flex gap-2">
              <button type="button" class="rounded bg-accent px-3 py-1.5 text-black" :disabled="running" @click="runOcr">
                {{ running && ocrBatchActive ? "正在扫描…" : running ? "运行中…" : "开始扫描" }}
              </button>
              <button type="button" class="rounded border border-border px-3 py-1.5 text-zinc-300" :disabled="!running" @click="cancelRun">
                取消
              </button>
            </div>
          </div>
          <div class="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-black/30">
            <div class="shrink-0 border-b border-border px-3 py-1.5 text-xs text-zinc-500">
              运行终端
            </div>
            <pre
              ref="ocrTerminalEl"
              class="ocr-terminal min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[11px] leading-5 text-zinc-300"
            >{{ ocrTerminalText }}</pre>
          </div>
        </section>

        <section class="col-span-5 flex min-h-0 flex-col rounded-xl border border-border bg-black/20 p-4">
          <div class="mb-2 flex shrink-0 items-center justify-between">
            <h3 class="text-sm font-medium text-zinc-300">大图预览 + OCR 框编辑</h3>
            <div class="flex gap-2 text-xs">
              <button type="button" class="rounded border border-border px-2 py-1" :disabled="detecting || previewLoading" @click="detectCurrentImage">
                {{ detecting ? "识别中…" : "识别当前图" }}
              </button>
              <button
                type="button"
                class="rounded border border-border px-2 py-1 disabled:opacity-40"
                :disabled="!canRecognizePendingBoxes"
                :title="canRecognizePendingBoxes ? '仅识别手动添加的新框' : '请先添加新框'"
                @click="recognizeCurrentBoxes()"
              >
                {{ recognizing ? "识别中…" : pendingRecognizeCount ? `识别新框(${pendingRecognizeCount})` : "识别新框" }}
              </button>
              <button type="button" class="rounded border border-border px-2 py-1" @click="addBox">加框</button>
              <button type="button" class="rounded border border-border px-2 py-1" @click="removeActiveBox">删框</button>
            </div>
          </div>
          <div class="mb-3 flex shrink-0 gap-2 text-xs">
            <button type="button" class="rounded border border-border px-2 py-1" @click="editActiveText">改字</button>
            <button
              type="button"
              class="rounded border border-sky-500/40 px-2 py-1 text-sky-300/95 disabled:opacity-40"
              :disabled="!canGotoNextUnpairedHere"
              title="在本张截图中按顺序跳到下一行未配对（蓝框），并自动滚到可见位置"
              @click="gotoNextUnpairedOnCurrentImage"
            >
              下一未配对{{ unpairedBoxesOnImage.length ? ` (${unpairedBoxesOnImage.length})` : "" }}
            </button>
            <button
              type="button"
              class="rounded border border-sky-500/40 px-2 py-1 text-sky-300/95 disabled:opacity-40"
              :disabled="!images.length || previewBusy"
              title="从 regions 缓存查找：打开下一张仍含未配对行的截图（需已批量扫描或存在 .regions.json）"
              @click="gotoNextImageWithUnpaired"
            >
              下一张含未配对
            </button>
            <button type="button" class="rounded border border-border px-2 py-1" @click="importBoxesToSongs">导入阶段B列表</button>
            <span class="text-zinc-500">加框后点「识别新框」· 虚线框=待识别 · 只 OCR 新框</span>
          </div>

          <div
            ref="previewViewportEl"
            class="preview-viewport relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain rounded border border-border bg-black/30 p-2"
            :class="{ 'is-dragging': !!dragState.boxId }"
          >
            <div
              v-if="previewBusy"
              class="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-black/20"
            >
              <Icon icon="mdi:loading" class="h-10 w-10 animate-spin text-accent" />
              <span class="text-sm text-zinc-200">{{ previewLoadingHint }}</span>
            </div>
            <div v-if="selectedImageUrl" class="relative mx-auto w-fit max-w-full">
              <img
                ref="previewImageEl"
                :key="selectedImage"
                :src="selectedImageUrl"
                class="block h-auto w-[min(100%,340px)] max-w-full select-none transition duration-300"
                :class="previewBusy ? 'scale-[0.99] opacity-35 blur-[3px]' : 'opacity-100'"
                draggable="false"
                @load="updateImageRenderMetrics"
              />
              <div class="pointer-events-none absolute inset-0">
                <div
                  v-for="box in editableBoxes"
                  :key="box.id"
                  class="pointer-events-auto absolute cursor-move overflow-hidden border-2"
                  :class="boxClass(box)"
                  :style="boxStyle(box)"
                  :title="boxTitle(box)"
                  @click.stop="selectBox(box.id)"
                  @dblclick.stop="selectBox(box.id); editActiveText()"
                  @mousedown="onBoxMouseDown($event, box, 'move')"
                >
                  <div class="pointer-events-none truncate bg-black/60 px-1 text-[10px] leading-4 text-white">
                    <span class="mr-1 opacity-70">{{ boxRoleLabel(box) }}</span>
                    {{ box.text || "(空文本)" }}
                  </div>
                  <span
                    v-if="box.id === activeBoxId"
                    class="absolute bottom-0 right-0 z-10 h-2.5 w-2.5 cursor-se-resize rounded-sm border border-white/70 bg-zinc-300/90 shadow"
                    title="拖动缩放"
                    @mousedown.stop="onBoxMouseDown($event, box, 'resize')"
                  />
                </div>
              </div>
            </div>
            <p v-else class="text-sm text-zinc-500">请先从左侧选择截图</p>
          </div>

          <div v-if="activeBox" class="mt-3 shrink-0 space-y-2 text-xs">
            <select
              :value="activeBox.role ?? ''"
              class="w-full rounded border border-border bg-black/40 px-2 py-1.5"
              @change="updateActiveBoxRole(($event.target as HTMLSelectElement).value)"
            >
              <option value="">手动（未分类·灰框）</option>
              <option value="title">歌名（绿框）</option>
              <option value="artist">歌手（橙框）</option>
              <option value="unpaired">未配对（蓝框）</option>
            </select>
            <div class="grid grid-cols-5 gap-2">
            <input :value="activeBox.x" type="number" class="rounded border border-border bg-black/40 px-2 py-1" placeholder="x" @input="updateActiveBox('x', ($event.target as HTMLInputElement).value)" />
            <input :value="activeBox.y" type="number" class="rounded border border-border bg-black/40 px-2 py-1" placeholder="y" @input="updateActiveBox('y', ($event.target as HTMLInputElement).value)" />
            <input :value="activeBox.w" type="number" class="rounded border border-border bg-black/40 px-2 py-1" placeholder="w" @input="updateActiveBox('w', ($event.target as HTMLInputElement).value)" />
            <input :value="activeBox.h" type="number" class="rounded border border-border bg-black/40 px-2 py-1" placeholder="h" @input="updateActiveBox('h', ($event.target as HTMLInputElement).value)" />
            <input :value="activeBox.text" type="text" class="rounded border border-border bg-black/40 px-2 py-1" placeholder="text" @input="updateActiveBox('text', ($event.target as HTMLInputElement).value)" />
            </div>
          </div>
        </section>
      </div>

      <div v-else class="grid min-h-0 flex-1 grid-cols-12 gap-4">
        <section class="col-span-5 flex min-h-0 flex-col rounded-xl border border-border bg-black/20 p-4">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-sm font-medium text-zinc-300">歌曲列表</h3>
            <span class="text-xs text-zinc-500">
              共 {{ songItems.length }} 首
              · <span class="text-emerald-400">成功 {{ successCount }}</span>
              · <span class="text-red-400">失败 {{ failedCount }}</span>
              · <span class="text-zinc-400">未下载 {{ pendingCount }}</span>
            </span>
          </div>
          <div class="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border bg-black/40">
            <div
              ref="songListEl"
              tabindex="0"
              class="song-list flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2 text-sm outline-none focus:ring-1 focus:ring-inset focus:ring-accent/40"
              @keydown="onSongListKeyDown"
              @click.self="clearSongSelection"
            >
              <p v-if="!songItems.length" class="px-2 py-6 text-center text-xs text-zinc-500">
                暂无歌曲，点「批量编辑」粘贴歌单，或从「导入已有歌单」读入文件。
              </p>
              <div
                v-for="item in songItems"
                :key="item.id"
                class="song-row group flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 transition"
                :class="[
                  selectedSongIds.has(item.id)
                    ? 'bg-accent/20 ring-1 ring-accent/40'
                    : 'hover:bg-white/5',
                  crawlCurrentQuery && songQueryKey(crawlCurrentQuery) === songQueryKey(`${item.song}-${item.artist}`)
                    ? 'ring-1 ring-cyan-300/60'
                    : '',
                ]"
                @click="onSongRowClick(item, $event)"
              >
                <span class="min-w-0 flex-1 truncate">
                  <span class="text-zinc-200">{{ item.song }}</span>
                  <span v-if="item.artist" class="text-zinc-500"> - {{ item.artist }}</span>
                </span>
                <button
                  v-if="item.status === 'failed'"
                  type="button"
                  class="shrink-0 rounded p-0.5 text-red-400 hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                  :title="`失败：${item.note ?? ''}（点击重试这一首）`"
                  :disabled="running || !!retryingSongId"
                  @click.stop="retrySong(item)"
                >
                  <Icon
                    :icon="retryingSongId === item.id ? 'mdi:loading' : 'mdi:close-circle'"
                    :class="['h-5 w-5', retryingSongId === item.id ? 'animate-spin' : '']"
                  />
                </button>
                <Icon
                  v-else-if="item.status === 'success'"
                  icon="mdi:check-circle"
                  class="h-5 w-5 shrink-0 text-emerald-400"
                  :title="item.note ? `成功：${item.note}` : '已下载'"
                />
                <Icon
                  v-else
                  icon="mdi:circle-outline"
                  class="h-5 w-5 shrink-0 text-zinc-500"
                  :title="item.note || '未下载'"
                />
              </div>
            </div>
            <div
              class="song-toolbar flex shrink-0 flex-wrap items-center gap-2 border-t border-border/80 bg-black/55 px-2 py-2"
              title="批量操作：单选 · Ctrl/⌘ 切换 · Shift 区间 · Delete 删除 · Ctrl/⌘+A 全选"
            >
              <button
                type="button"
                class="song-icon-btn"
                title="批量编辑（在弹窗里粘贴/修改一大段歌单，保存时按文本匹配保留状态）"
                @click="openBulkEditor"
              >
                <Icon icon="mdi:pencil" class="h-5 w-5" />
              </button>
              <button
                type="button"
                class="song-icon-btn"
                title="导入已有歌单（从 .txt / .csv 合并进来）"
                @click="importPlaylistFile"
              >
                <Icon icon="mdi:tray-arrow-down" class="h-5 w-5" />
              </button>
              <button
                type="button"
                class="song-icon-btn relative"
                :title="selectedSongIds.size ? `删除选中（${selectedSongIds.size}）` : '删除选中（也可按 Delete）'"
                :disabled="!selectedSongIds.size"
                @click="removeSelectedSongs"
              >
                <Icon icon="mdi:delete" class="h-5 w-5" />
                <span
                  v-if="selectedSongIds.size"
                  class="absolute -right-1 -top-1 min-w-[16px] rounded-full bg-red-500/90 px-1 text-[10px] font-semibold leading-4 text-white"
                >
                  {{ selectedSongIds.size }}
                </span>
              </button>
              <button
                type="button"
                class="song-icon-btn"
                title="全选（也可按 Ctrl/⌘+A）"
                :disabled="!songItems.length"
                @click="selectAllSongs"
              >
                <Icon icon="mdi:check-all" class="h-5 w-5" />
              </button>
              <button
                type="button"
                class="song-icon-btn"
                title="取消选中"
                :disabled="!selectedSongIds.size"
                @click="clearSongSelection"
              >
                <Icon icon="mdi:close" class="h-5 w-5" />
              </button>
            </div>
          </div>
        </section>

        <section class="col-span-7 rounded-xl border border-border bg-black/20 p-4">
          <h3 class="mb-3 text-sm font-medium text-zinc-300">一键爬取参数</h3>
          <div class="grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
            <label class="block">
              <span class="mb-1 block text-xs text-zinc-500">输入歌单文件（每行 歌名-歌手）</span>
              <div class="flex gap-2">
                <input
                  v-model="crawlForm.input"
                  class="min-w-0 flex-1 rounded border border-border bg-black/40 px-2 py-1.5"
                  placeholder="songs.txt"
                />
                <button
                  type="button"
                  class="song-icon-btn shrink-0"
                  :disabled="pickingDialog"
                  title="打开资源管理器选择歌单文件（.txt / .csv）"
                  @click="pickInputSongFile"
                >
                  <Icon icon="mdi:file-document-outline" class="h-5 w-5" />
                </button>
              </div>
            </label>
            <label class="block">
              <span class="mb-1 block text-xs text-zinc-500">结果 CSV（含夸克链接/状态）</span>
              <div class="flex gap-2">
                <input
                  v-model="crawlForm.output"
                  class="min-w-0 flex-1 rounded border border-border bg-black/40 px-2 py-1.5"
                  placeholder="quark_results.csv"
                />
                <button
                  type="button"
                  class="song-icon-btn shrink-0"
                  :disabled="pickingDialog"
                  title="选择结果 CSV 保存位置"
                  @click="pickOutputCsvFile"
                >
                  <Icon icon="mdi:file-document-outline" class="h-5 w-5" />
                </button>
              </div>
            </label>
            <label class="block col-span-2">
              <span class="mb-1 block text-xs text-zinc-500">下载目录（音乐文件落地位置）</span>
              <div class="flex gap-2">
                <input
                  v-model="crawlForm.downloadDir"
                  class="min-w-0 flex-1 rounded border border-border bg-black/40 px-2 py-1.5"
                  placeholder="downloads"
                />
                <button
                  type="button"
                  class="song-icon-btn shrink-0"
                  :disabled="pickingDialog"
                  title="打开资源管理器选择下载目录"
                  @click="pickDownloadDir"
                >
                  <Icon icon="mdi:folder-outline" class="h-5 w-5" />
                </button>
              </div>
            </label>
            <label class="block">
              <span class="mb-1 block text-xs text-zinc-500">下载来源</span>
              <select v-model="crawlForm.mode" class="w-full rounded border border-border bg-black/40 px-2 py-1.5">
                <option value="A">A · 网盘（夸克，默认）</option>
                <option value="B">B · 网站本地 MP3</option>
              </select>
            </label>
            <label class="block" :class="{ 'opacity-50': crawlForm.mode !== 'B' }">
              <span class="mb-1 block text-xs text-zinc-500">B 模式下载方式（仅 B 生效）</span>
              <select
                v-model="crawlForm.bMethod"
                :disabled="crawlForm.mode !== 'B'"
                class="w-full rounded border border-border bg-black/40 px-2 py-1.5"
              >
                <option value="http">http（HTTP 直下，推荐）</option>
                <option value="browser">browser（浏览器点击下载）</option>
              </select>
            </label>
            <label class="block">
              <span class="mb-1 block text-xs text-zinc-500">请求间隔（秒）·防反爬，建议 0.5–2</span>
              <input v-model.number="crawlForm.delay" type="number" step="0.1" min="0" class="w-full rounded border border-border bg-black/40 px-2 py-1.5" placeholder="0.8" />
            </label>
            <label class="block">
              <span class="mb-1 block text-xs text-zinc-500">页面超时（秒）·网络慢可调大</span>
              <input v-model.number="crawlForm.timeout" type="number" min="5" class="w-full rounded border border-border bg-black/40 px-2 py-1.5" placeholder="40" />
            </label>
            <div class="col-span-2 flex flex-wrap items-start gap-x-5 gap-y-2 rounded border border-border/60 bg-black/20 px-3 py-2 text-zinc-300">
              <label class="flex items-start gap-2">
                <input v-model="crawlForm.linksOnly" type="checkbox" class="mt-1" />
                <span class="text-xs">
                  <span class="block text-zinc-200">仅收集链接，不下载</span>
                  <span class="text-zinc-500">两种模式都可用：只写 CSV 链接，不真正下载文件</span>
                </span>
              </label>
              <button
                type="button"
                class="flex items-center gap-1.5 rounded border border-border bg-black/30 px-2.5 py-1 text-xs text-zinc-200 hover:border-accent/60 hover:text-accent"
                title="B 模式遇到 2t58「今日下载次数已达上限」时，去网站完成口令后回到这里更新 Cookie"
                @click="openCookieDialog('manual')"
              >
                <Icon icon="mdi:cookie-edit-outline" class="h-4 w-4" />
                更新 2t58 Cookie
              </button>
            </div>
          </div>
          <div class="mt-3 flex gap-2">
            <button
              type="button"
              class="rounded bg-accent px-3 py-1.5 text-sm text-black disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="running || runnableCount === 0"
              :title="runnableCount === 0 ? '全部歌曲都已成功 / 列表为空' : ''"
              @click="runCrawl"
            >
              {{ crawlButtonLabel }}
            </button>
            <button type="button" class="rounded border border-border px-3 py-1.5 text-sm" :disabled="!running" @click="cancelRun">取消</button>
          </div>
          <div class="mt-4 rounded-lg border border-border bg-black/30">
            <div class="border-b border-border px-3 py-2 text-xs text-zinc-500">实时日志</div>
            <pre class="max-h-64 overflow-auto px-3 py-2 text-xs leading-5 text-zinc-300">{{ logs.join("\n") }}</pre>
          </div>
        </section>
      </div>

    </div>

    <Transition name="info-toast">
      <div v-if="infoMessage && infoVisible" class="info-toast" :title="infoMessage">
        {{ infoMessage }}
      </div>
    </Transition>

    <Transition name="bulk-modal">
      <div v-if="showCookieDialog" class="bulk-modal-backdrop" @click.self="closeCookieDialog">
        <div class="bulk-modal" role="dialog" aria-modal="true">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="flex items-center gap-2 text-base font-semibold text-zinc-100">
              <Icon
                :icon="cookieDialogTrigger === 'manual' ? 'mdi:cookie-edit-outline' : 'mdi:alert-circle-outline'"
                :class="cookieDialogTrigger === 'manual' ? 'h-5 w-5 text-accent' : 'h-5 w-5 text-amber-400'"
              />
              {{ cookieDialogTitle() }}
            </h3>
            <button
              type="button"
              class="rounded p-1 text-zinc-400 hover:bg-white/5 hover:text-zinc-100 disabled:opacity-50"
              :disabled="cookieDialogSaving"
              title="关闭"
              @click="closeCookieDialog"
            >
              <Icon icon="mdi:close" class="h-5 w-5" />
            </button>
          </div>
          <p
            v-if="cookieDialogBanner()"
            class="mb-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-100"
          >
            {{ cookieDialogBanner() }}
          </p>
          <ol class="mb-3 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-zinc-300">
            <li>
              点
              <button type="button" class="mx-1 inline-flex items-center gap-1 rounded border border-border bg-black/30 px-2 py-0.5 text-zinc-200 hover:border-accent/60 hover:text-accent" @click="openExternalSite">
                <Icon icon="mdi:open-in-new" class="h-3.5 w-3.5" />
                打开 2t58.com
              </button>
              <template v-if="cookieDialogTrigger === 'human-verify'">
                在浏览器完成人机验证（勾选 / 滑动 / 拼图等，以页面提示为准）。
              </template>
              <template v-else>
                在浏览器完成口令验证（必要时按提示输入数字 / 滑动等）。
              </template>
            </li>
            <li>
              按 <kbd class="rounded bg-black/40 px-1.5">F12</kbd> 打开开发者工具 → <span class="text-zinc-100">Network</span> 选项卡 → 刷新页面 → 任选一条 2t58 请求 → 在 <span class="text-zinc-100">Request Headers</span> 中复制整行 <code class="rounded bg-black/40 px-1">Cookie:</code> 之后的内容。
            </li>
            <li>粘贴到下方输入框，点「保存并重试」即可继续下载。</li>
          </ol>
          <label class="mb-1 block text-xs text-zinc-400">从浏览器粘贴 Cookie：</label>
          <textarea
            v-model="cookieDialogText"
            class="h-[180px] w-full rounded border border-border bg-black/40 p-2 text-xs"
            placeholder="例如：PHPSESSID=xxxx; cf_clearance=yyyy; token=zzzz; ..."
            spellcheck="false"
          />
          <p
            v-if="cookieDialogHint"
            class="mt-2 rounded border border-border/60 bg-black/30 px-2 py-1.5 text-xs text-zinc-300"
          >
            {{ cookieDialogHint }}
          </p>
          <div class="mt-3 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              class="rounded border border-border px-3 py-1.5 text-sm disabled:opacity-50"
              :disabled="cookieDialogSaving"
              @click="closeCookieDialog"
            >
              取消
            </button>
            <button
              type="button"
              class="rounded border border-border px-3 py-1.5 text-sm disabled:opacity-50"
              :disabled="cookieDialogSaving || !cookieDialogText.trim()"
              @click="onlySaveCookie"
            >
              {{ cookieDialogSaving ? "保存中…" : "仅保存 Cookie" }}
            </button>
            <button
              type="button"
              class="rounded bg-accent px-3 py-1.5 text-sm text-black disabled:opacity-50"
              :disabled="cookieDialogSaving || !cookieDialogText.trim() || running || runnableCount === 0"
              :title="runnableCount === 0 ? '当前没有失败 / 未爬取项可重试' : ''"
              @click="saveCookieAndRetry"
            >
              {{ cookieDialogSaving ? "保存中…" : "保存并重试失败项" }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="bulk-modal">
      <div v-if="showBulkEditor" class="bulk-modal-backdrop" @click.self="closeBulkEditor">
        <div class="bulk-modal" role="dialog" aria-modal="true">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-base font-semibold text-zinc-100">批量编辑歌单</h3>
            <button
              type="button"
              class="rounded p-1 text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
              title="关闭"
              @click="closeBulkEditor"
            >
              <Icon icon="mdi:close" class="h-5 w-5" />
            </button>
          </div>
          <p class="mb-2 text-xs leading-relaxed text-zinc-400">
            每行一首，格式 <span class="text-zinc-200">歌名-歌手</span>。保存时以「歌名-歌手」匹配原状态：
            未改的行保留下载结果，改了文本的视为新歌（状态重置），删掉的行连同状态一起丢失。
          </p>
          <textarea
            v-model="songsText"
            class="h-[360px] w-full rounded border border-border bg-black/40 p-2 text-sm"
            placeholder="每行一首：歌名-歌手"
          />
          <div class="mt-3 flex justify-end gap-2">
            <button
              type="button"
              class="rounded border border-border px-3 py-1.5 text-sm"
              @click="closeBulkEditor"
            >
              取消
            </button>
            <button
              type="button"
              class="rounded bg-accent px-3 py-1.5 text-sm text-black"
              @click="applyBulkEditor"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
button {
  cursor: pointer;
  transition:
    transform 0.12s ease,
    filter 0.2s ease,
    background-color 0.2s ease,
    color 0.2s ease,
    opacity 0.2s ease,
    box-shadow 0.2s ease;
}

button:hover:not(:disabled) {
  filter: brightness(1.08);
  transform: translateY(-1px);
  box-shadow: 0 0 0 1px rgb(34 211 238 / 0.25);
}

button:active:not(:disabled) {
  transform: scale(0.98);
}

button:disabled {
  opacity: 0.55;
}

.preview-viewport {
  min-height: 420px;
  touch-action: pan-y;
}

.preview-viewport.is-dragging {
  cursor: move;
  user-select: none;
}

.info-toast {
  position: fixed;
  right: 1.25rem;
  bottom: 1.25rem;
  z-index: 100;
  max-width: min(22rem, calc(100vw - 2.5rem));
  padding: 0.5rem 0.875rem;
  border-radius: 0.5rem;
  border: 1px solid rgb(63 63 70 / 0.9);
  background: rgb(24 24 27 / 0.92);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.45);
  font-size: 0.75rem;
  line-height: 1.35;
  color: rgb(212 212 216);
  pointer-events: none;
  backdrop-filter: blur(8px);
}

.info-toast-enter-active,
.info-toast-leave-active {
  transition:
    opacity 0.35s ease,
    transform 0.35s ease;
}

.info-toast-enter-from,
.info-toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.song-list {
  min-height: 0;
}

.song-row {
  user-select: none;
}

/* icon 按钮：背景半透明（透出页面背景），但图标保持完全不透明、高对比度。
 * 用比全局 `button:disabled { opacity }` 更高优先级的选择器，避免 icon 图案被整体淡掉。 */
button.song-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.375rem;
  border-radius: 0.375rem;
  border: 1px solid rgb(63 63 70 / 0.9);
  background: rgb(0 0 0 / 0.45);
  color: rgb(244 244 245);
  opacity: 1;
  transition:
    background-color 0.2s ease,
    color 0.2s ease,
    border-color 0.2s ease,
    transform 0.12s ease,
    box-shadow 0.2s ease;
}

button.song-icon-btn:hover:not(:disabled) {
  background: rgb(0 0 0 / 0.6);
  color: rgb(34 211 238);
  border-color: rgb(34 211 238 / 0.6);
  box-shadow: 0 0 0 1px rgb(34 211 238 / 0.3);
}

button.song-icon-btn:active:not(:disabled) {
  transform: scale(0.95);
}

/* disabled 状态：背景更淡、图标降色，但都保持完全不透明，确保图案可见。 */
button.song-icon-btn:disabled {
  opacity: 1;
  cursor: not-allowed;
  background: rgb(0 0 0 / 0.25);
  border-color: rgb(63 63 70 / 0.5);
  color: rgb(161 161 170);
}

.bulk-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 0.55);
  backdrop-filter: blur(4px);
  padding: 1.5rem;
}

.bulk-modal {
  width: min(640px, 100%);
  max-height: calc(100vh - 6rem);
  display: flex;
  flex-direction: column;
  border-radius: 0.75rem;
  border: 1px solid rgb(63 63 70 / 0.95);
  background: rgb(24 24 27 / 0.96);
  padding: 1.25rem;
  box-shadow: 0 24px 48px rgb(0 0 0 / 0.55);
}

.bulk-modal textarea {
  flex: 1 1 auto;
}

.bulk-modal-enter-active,
.bulk-modal-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.bulk-modal-enter-from,
.bulk-modal-leave-to {
  opacity: 0;
  transform: scale(0.96);
}

.ocr-terminal {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  background: rgb(9 9 11 / 0.55);
}
</style>
