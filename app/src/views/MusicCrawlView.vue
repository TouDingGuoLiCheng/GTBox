<script setup lang="ts">
import { Icon } from "@iconify/vue";
import { invoke } from "@tauri-apps/api/core";
import { useMusicCrawlRunStore } from "../stores/musicCrawlRun";
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

const router = useRouter();
const runStore = useMusicCrawlRunStore();
const { running, logs, ocrBatchActive, batchProgressPercent, batchStatusLabel, lastRegionsReady } =
  storeToRefs(runStore);

const REGIONS_CACHE_DIR = "playlist_ocr/regions_cache";
const stage = ref<"ocr" | "crawl">("ocr");
const songsText = ref("");
const songs = computed(() => songsText.value.split(/\r?\n/).map((v) => v.trim()).filter(Boolean));
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
let dragRafId = 0;
let pendingDragEvent: MouseEvent | null = null;

const imgRender = reactive({ displayW: 1, displayH: 1, naturalW: 1, naturalH: 1 });
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
  input: "playlist_ocr/images_in",
  output: "songs.txt",
  merge: "overwrite",
  device: "auto",
});
const crawlForm = reactive({
  input: "songs.txt",
  output: "quark_results.csv",
  downloadDir: "downloads",
  mode: "B",
  bMethod: "http",
  linksOnly: false,
  manualLoginOnce: false,
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
function normalizeName(value: string) {
  return value.replace(/\s+/g, " ").trim();
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
  const maxW = imgRender.naturalW;
  const maxH = imgRender.naturalH;
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
  const sy = imgRender.displayH / imgRender.naturalH;
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
    showInfoMessage("请先刷新或指定截图文件夹");
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
function boxStyle(box: EditableBox) {
  const sx = imgRender.displayW / imgRender.naturalW;
  const sy = imgRender.displayH / imgRender.naturalH;
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
  const newBox: EditableBox = {
    id: `box-${Date.now()}`,
    x: Math.max(0, imgRender.naturalW * 0.35),
    y: Math.max(0, imgRender.naturalH * 0.35),
    w: Math.max(80, imgRender.naturalW * 0.25),
    h: Math.max(28, imgRender.naturalH * 0.05),
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

  const sx = imgRender.naturalW / imgRender.displayW;
  const sy = imgRender.naturalH / imgRender.displayH;
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
  try {
    images.value = await invoke<MediaEntry[]>("list_media_files", { relativeDir: ocrForm.input });
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
    ocrForm.input = folder;
    await refreshImages();
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
    images.value = files.map((path) => ({ name: basename(path), path }));
    selectedImage.value = files[0];
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
  images.value = [{ name: basename(path), path }];
  selectedImage.value = path;
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

async function fetchDetectBoxesForImage(imagePath: string): Promise<EditableBox[]> {
  const result = await invoke<DetectRegion[]>("detect_image_regions", {
    imagePath,
    device: ocrForm.device,
  });
  return mapDetectResultToBoxes(result, `d-${imageCacheKey(imagePath).slice(-12)}-${Date.now()}`);
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
    showInfoMessage(`新框识别完成（${result.length} 个）`);
  } catch (err) {
    showInfoMessage(`重识别失败：${err instanceof Error ? err.message : String(err)}`, 8000);
  } finally {
    recognizing.value = false;
    await nextTick();
    updateImageRenderMetrics();
  }
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
  songsText.value = `${merged.join("\n")}\n`;
  stage.value = "crawl";
}
function normalizeSongsText() {
  const lines = structuredSongsFromLines(songsText.value.split(/\r?\n/));
  songsText.value = `${lines.join("\n")}${lines.length ? "\n" : ""}`;
  showInfoMessage(`已结构化并去重，共 ${lines.length} 首`);
}
async function importPlaylistFile() {
  const file = await invoke<string | null>("pick_text_file");
  if (!file) return;
  try {
    const text = await invoke<string>("read_text_file", { path: file });
    const merged = structuredSongsFromLines([...songsText.value.split(/\r?\n/), ...text.split(/\r?\n/)]);
    songsText.value = `${merged.join("\n")}${merged.length ? "\n" : ""}`;
    showInfoMessage(`已导入并去重：${basename(file)}（共 ${merged.length} 首）`);
  } catch (err) {
    showInfoMessage(`导入歌单失败：${err instanceof Error ? err.message : String(err)}`, 6000);
  }
}

async function loadSongs() {
  try {
    songsText.value = await invoke<string>("read_workspace_file", { relativePath: ocrForm.output });
  } catch {
    songsText.value = "";
  }
}
async function saveSongs() {
  try {
    normalizeSongsText();
    const output = songsText.value;
    await invoke("write_workspace_file", { relativePath: crawlForm.input, content: output });
    showInfoMessage(`已写入 ${crawlForm.input}（${songs.value.length} 首）`);
  } catch (err) {
    showInfoMessage(`写入 songs 失败：${err instanceof Error ? err.message : String(err)}`, 6000);
  }
}
async function runOcr() {
  if (running.value) return;
  let imgs: MediaEntry[] = [];
  try {
    imgs = await invoke<MediaEntry[]>("list_media_files", { relativeDir: ocrForm.input });
    if (!imgs.length) {
      showInfoMessage(
        `截图目录为空或不存在：${ocrForm.input}。请使用 playlist_ocr/images_in 或通过「选择文件夹」指定`,
        8000,
      );
      return;
    }
  } catch (err) {
    showInfoMessage(`检查截图目录失败：${err instanceof Error ? err.message : String(err)}`, 6000);
    return;
  }
  hideInfoMessage();
  detecting.value = false;
  recognizing.value = false;
  runStore.beginBatchScan(imgs);
  const first = imgs[0]?.path;
  if (first) selectedImage.value = first;
  try {
    await runStore.startTool("playlist_ocr", {
      ...ocrForm,
      review: "playlist_ocr/songs_review.txt",
      regionsDir: REGIONS_CACHE_DIR,
    });
  } catch (err) {
    showInfoMessage(`启动 OCR 失败：${err instanceof Error ? err.message : String(err)}`, 6000);
  }
}
async function runCrawl() {
  if (running.value) return;
  await saveSongs();
  hideInfoMessage();
  runStore.resetBatch();
  try {
    await runStore.startTool("full_auto_download", { ...crawlForm });
  } catch (err) {
    showInfoMessage(`启动爬取失败：${err instanceof Error ? err.message : String(err)}`, 6000);
  }
}
async function cancelRun() {
  await runStore.cancelRun();
}

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
    if (code === null || runStore.lastFinishedPlugin !== "playlist_ocr") return;
    if (code === 0) {
      await loadSongs();
      normalizeSongsText();
      detecting.value = false;
      showInfoMessage(`批量识别完成，共 ${songs.value.length} 首，可点选图片查看 OCR 框`);
      if (selectedImage.value && !editableBoxes.value.length) {
        await importRegionsFromCache(selectedImage.value);
      }
    } else {
      const tail = logs.value.filter(Boolean).slice(-3).join("；");
      showInfoMessage(`批量识别失败（退出码 ${code}）${tail ? `：${tail}` : ""}`, 8000);
    }
  },
);

onMounted(() => {
  window.addEventListener("mousemove", onGlobalMouseMove);
  window.addEventListener("mouseup", onGlobalMouseUp);
  void runStore.ensureListeners();
  void refreshImages();
  void loadPreviewImage();
  void loadSongs();
});

onBeforeUnmount(() => {
  if (dragRafId) cancelAnimationFrame(dragRafId);
  if (infoHideTimer) clearTimeout(infoHideTimer);
  if (infoClearTimer) clearTimeout(infoClearTimer);
  window.removeEventListener("mousemove", onGlobalMouseMove);
  window.removeEventListener("mouseup", onGlobalMouseUp);
});
</script>

<template>
  <div class="relative flex min-h-0 flex-1 flex-col p-6">
    <button
      type="button"
      class="mb-6 flex w-fit items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-zinc-400 transition hover:bg-white/5 hover:text-accent"
      @click="router.push('/')"
    >
      <Icon icon="mdi:arrow-left" />
      返回首页
    </button>

    <div v-motion :initial="{ opacity: 0, y: 12 }" :enter="{ opacity: 1, y: 0, transition: { duration: 0.4 } }" class="flex min-h-0 flex-1 flex-col gap-4">
      <div class="flex items-center justify-between rounded-xl border border-border bg-surface-elevated/50 px-4 py-3">
        <h2 class="text-xl font-semibold">一键爬取音乐（M2.5）</h2>
        <div class="flex gap-2">
          <button
            type="button"
            class="rounded-lg px-3 py-1.5 text-sm"
            :class="stage === 'ocr' ? 'bg-accent text-black' : 'bg-black/30 text-zinc-300'"
            @click="stage = 'ocr'"
          >
            阶段A 识图校对
          </button>
          <button
            type="button"
            class="rounded-lg px-3 py-1.5 text-sm"
            :class="stage === 'crawl' ? 'bg-accent text-black' : 'bg-black/30 text-zinc-300'"
            @click="stage = 'crawl'"
          >
            阶段B 一键爬取
          </button>
        </div>
      </div>

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

        <section class="col-span-4 min-h-0 rounded-xl border border-border bg-black/20 p-4">
          <h3 class="mb-3 text-sm font-medium text-zinc-300">OCR 参数</h3>
          <div class="mb-3 flex gap-2 text-xs">
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
            class="mb-3 rounded border border-dashed px-2 py-2 text-xs transition"
            :class="dropZoneActive ? 'border-accent bg-accent/10 text-accent' : 'border-border text-zinc-500'"
            @dragover.prevent="dropZoneActive = true"
            @dragleave.prevent="dropZoneActive = false"
            @drop="onDropImage"
          >
            拖拽单张图片到此处可直接载入
          </div>
          <div class="space-y-3 text-sm">
            <label class="block">
              <span class="mb-1 block text-xs text-zinc-500">截图文件夹</span>
              <input v-model="ocrForm.input" class="w-full rounded border border-border bg-black/40 px-2 py-1.5" placeholder="playlist_ocr/images_in" />
            </label>
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
                  :class="{ 'animate-pulse': batchProgressPercent <= 8 }"
                  :style="{ width: `${batchProgressPercent}%` }"
                />
              </div>
            </div>
            <div class="flex gap-2 pt-2">
              <button type="button" class="rounded bg-accent px-3 py-1.5 text-black" :disabled="running" @click="runOcr">
                {{ running && ocrBatchActive ? "正在扫描…" : running ? "运行中…" : "开始扫描" }}
              </button>
              <button type="button" class="rounded border border-border px-3 py-1.5 text-zinc-300" :disabled="!running" @click="cancelRun">
                取消
              </button>
            </div>
            <p v-if="ocrBatchActive" class="text-xs text-zinc-500">将识别文件夹内全部截图，左侧可查看每张进度</p>
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
        <section class="col-span-5 rounded-xl border border-border bg-black/20 p-4">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-sm font-medium text-zinc-300">歌曲列表（OCR 汇总）</h3>
            <span class="text-xs text-zinc-500">{{ songs.length }} 首</span>
          </div>
          <textarea
            v-model="songsText"
            class="h-[420px] w-full rounded border border-border bg-black/40 p-2 text-sm"
            placeholder="每行一首：歌名-歌手"
          />
          <div class="mt-2 flex gap-2">
            <button type="button" class="rounded border border-border px-3 py-1.5 text-sm" @click="loadSongs">重新读取</button>
            <button type="button" class="rounded border border-border px-3 py-1.5 text-sm" @click="saveSongs">写入 songs</button>
            <button type="button" class="rounded border border-border px-3 py-1.5 text-sm" @click="normalizeSongsText">结构化去重</button>
            <button type="button" class="rounded border border-border px-3 py-1.5 text-sm" @click="importPlaylistFile">导入已有歌单</button>
          </div>
          <p class="mt-2 text-xs text-zinc-500">会自动整理为“歌名-歌手”格式并去重</p>
        </section>

        <section class="col-span-7 rounded-xl border border-border bg-black/20 p-4">
          <h3 class="mb-3 text-sm font-medium text-zinc-300">一键爬取参数</h3>
          <div class="grid grid-cols-2 gap-2 text-sm">
            <input v-model="crawlForm.input" class="rounded border border-border bg-black/40 px-2 py-1.5" placeholder="--input" />
            <input v-model="crawlForm.output" class="rounded border border-border bg-black/40 px-2 py-1.5" placeholder="--output" />
            <input v-model="crawlForm.downloadDir" class="rounded border border-border bg-black/40 px-2 py-1.5" placeholder="--download-dir" />
            <select v-model="crawlForm.mode" class="rounded border border-border bg-black/40 px-2 py-1.5">
              <option value="A">A</option>
              <option value="B">B</option>
            </select>
            <select v-model="crawlForm.bMethod" class="rounded border border-border bg-black/40 px-2 py-1.5">
              <option value="http">http</option>
              <option value="browser">browser</option>
            </select>
            <input v-model.number="crawlForm.delay" type="number" step="0.1" class="rounded border border-border bg-black/40 px-2 py-1.5" placeholder="--delay" />
            <input v-model.number="crawlForm.timeout" type="number" class="rounded border border-border bg-black/40 px-2 py-1.5" placeholder="--timeout" />
            <div class="flex items-center gap-3 text-zinc-300">
              <label class="flex items-center gap-1"><input v-model="crawlForm.linksOnly" type="checkbox" /> links-only</label>
              <label class="flex items-center gap-1"><input v-model="crawlForm.manualLoginOnce" type="checkbox" /> manual-login-once</label>
            </div>
          </div>
          <div class="mt-3 flex gap-2">
            <button type="button" class="rounded bg-accent px-3 py-1.5 text-sm text-black" :disabled="running || songs.length === 0" @click="runCrawl">
              {{ running ? "运行中..." : "确认歌单并开始爬取" }}
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
</style>
