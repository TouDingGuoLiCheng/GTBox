<script setup lang="ts">
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import {
  VueFlow,
  addEdge,
  type Connection,
  type ValidConnectionFunc,
} from "@vue-flow/core";
import { MiniMap } from "@vue-flow/minimap";
import { Icon } from "@iconify/vue";
import { invoke } from "@tauri-apps/api/core";
import { computed, markRaw, nextTick, onUnmounted, ref, watch } from "vue";
import { useRuleGraphHistory } from "../../../composables/useRuleGraphHistory";
import type { NodeType, RuleGraph, RuleNode } from "../../../types/ruleGraph";
import {
  autoLayoutRuleGraph,
  createBlankRuleGraph,
  createDefaultRuleGraph,
  createPlaylistSequenceRuleGraph,
  createNumberedListRuleGraph,
  getCollapsedHiddenNodeIds,
  normalizeSegmentEdges,
  shouldShowSegmentBadge,
} from "../../../utils/ruleGraph";
import {
  createFlowNode,
  flowToRuleGraph,
  getPortKind,
  newRuleId,
  refreshFlowNodeData,
  ruleGraphToFlow,
  type RuleFlowNodeData,
} from "../../../utils/ruleGraph/flowAdapter";
import { graphFingerprint, withAdaptiveEdgeOffsets } from "../../../utils/ruleGraph/edgeOffsets";
import { getNodeDef } from "../../../utils/ruleGraph/nodeDefs";
import { previewRuleGraph } from "../../../utils/ruleGraph/previewGraph";
import { parseRuleGraphJson, serializeRuleGraph } from "../../../utils/ruleGraph/ruleGraphIo";
import { pseudoPatternGraph } from "../../../utils/ruleGraph/pseudoPatternGraph";
import { summarizeGraph } from "../../../utils/ruleGraph/summarizeGraph";
import { validateGraph } from "../../../utils/ruleGraph/validateGraph";
import { pushDebugLine } from "../../../utils/mediaDebug";
import RuleFlowNode from "./RuleFlowNode.vue";
import RuleGraphPropsPanel from "./RuleGraphPropsPanel.vue";
import RuleNodePalette from "./RuleNodePalette.vue";

import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/controls/dist/style.css";
import "@vue-flow/minimap/dist/style.css";

type TemplateKind = "playlist" | "numbered" | "default";

const props = withDefaults(
  defineProps<{
    modelValue: RuleGraph;
    previewText?: string;
    /** compare：文本比对；builder：正则生成（隐藏侧栏试跑与顶部摘要） */
    variant?: "compare" | "builder";
  }>(),
  { variant: "compare" },
);

const isBuilder = computed(() => props.variant === "builder");

const emit = defineEmits<{
  "update:modelValue": [value: RuleGraph];
}>();

const nodeTypes = { rule: markRaw(RuleFlowNode) };
const { canUndo, canRedo, pushState, undo, redo, isApplying } = useRuleGraphHistory();

const flowNodes = ref<any[]>([]);
const flowEdges = ref<any[]>([]);
const selectedNodeId = ref<string | null>(null);
const syncing = ref(false);
const ioBusy = ref(false);
const ioMessage = ref<string | null>(null);
const ioError = ref<string | null>(null);
const vueFlowRef = ref<InstanceType<typeof VueFlow> | null>(null);
const canvasHostRef = ref<HTMLElement | null>(null);
const dragSnapshotTaken = ref(false);
const showMinimap = ref(false);
const connectionHint = ref<string | null>(null);

const palettePickType = ref<NodeType | null>(null);
const palettePickActive = ref(false);
const canvasDragOver = ref(false);
const ghostPos = ref<{ x: number; y: number } | null>(null);

let localFingerprint = "";
/** 连线校验提示：勿在 isValidConnection 内写 ref，否则会打断 Vue Flow 拖拽连线 */
let pendingConnectionHint: string | null = null;

const compareToolbarIds = ["playlist", "default", "numbered"] as const;

const toolbarActions = computed(() => {
  const all = [
    { id: "playlist", icon: "mdi:music-note-outline", title: "歌单教学模板" },
    { id: "default", icon: "mdi:file-restore-outline", title: "最小模板" },
    { id: "numbered", icon: "mdi:format-list-numbered", title: "编号列表模板" },
    { id: "layout", icon: "mdi:auto-fix", title: "自动布局" },
    { id: "undo", icon: "mdi:undo", title: "撤销 (Ctrl+Z)" },
    { id: "redo", icon: "mdi:redo", title: "重做 (Ctrl+Shift+Z)" },
    { id: "export", icon: "mdi:export", title: "导出 JSON" },
    { id: "import", icon: "mdi:import", title: "导入 JSON" },
    { id: "delete", icon: "mdi:delete-outline", title: "删除选中节点", danger: true },
    { id: "clear", icon: "mdi:delete-sweep", title: "清除全部积木", danger: true },
  ] as const;
  if (isBuilder.value) {
    return all.filter((a) => !(compareToolbarIds as readonly string[]).includes(a.id));
  }
  return all;
});

type ToolbarActionId = (typeof toolbarActions.value)[number]["id"];

const liveGraph = computed((): RuleGraph => {
  try {
    return flowToRuleGraph(flowNodes.value as any, flowEdges.value as any, props.modelValue);
  } catch {
    return props.modelValue;
  }
});

const summary = computed(() => summarizeGraph(liveGraph.value));
const pseudoPattern = computed(() => pseudoPatternGraph(liveGraph.value));
const validationErrors = computed(() =>
  validateGraph(liveGraph.value).filter((i) => i.severity === "error"),
);

const selectedRuleNode = computed((): RuleNode | null => {
  if (!selectedNodeId.value) return null;
  return liveGraph.value.nodes.find((n) => n.id === selectedNodeId.value) ?? null;
});

const preview = computed(() => previewRuleGraph(liveGraph.value, props.previewText ?? ""));

const paletteGhostLabel = computed(() => {
  if (!palettePickType.value) return "";
  return getNodeDef(palettePickType.value).label;
});

function applyEdgeLayout() {
  flowEdges.value = withAdaptiveEdgeOffsets(flowEdges.value as any) as any;
}

function refreshAllFlowNodes(graph: RuleGraph) {
  const hiddenIds = getCollapsedHiddenNodeIds(graph);
  const positions = new Map(
    flowNodes.value.map((n) => [n.id, { x: n.position.x, y: n.position.y }]),
  );
  const selected = selectedNodeId.value;
  const { nodes } = ruleGraphToFlow(graph);
  flowNodes.value = nodes.map((n) => ({
    ...n,
    position: positions.get(n.id) ?? n.position,
    hidden: hiddenIds.has(n.id),
    selected: n.id === selected,
  })) as any;
}

function syncFlowEdgesFromGraph(graph: RuleGraph) {
  const hiddenIds = getCollapsedHiddenNodeIds(graph);
  flowEdges.value = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    type: "straight",
    hidden: hiddenIds.has(e.source) || hiddenIds.has(e.target),
  })) as any;
  applyEdgeLayout();
}

function syncFlowFromGraph(g: RuleGraph) {
  const graph = normalizeSegmentEdges(g);
  syncing.value = true;
  const hiddenIds = getCollapsedHiddenNodeIds(graph);
  const { nodes, edges } = ruleGraphToFlow(graph);
  flowNodes.value = nodes.map((n) => ({
    ...n,
    hidden: hiddenIds.has(n.id),
  })) as any[];
  flowEdges.value = edges.map((e) => ({
    ...e,
    hidden: hiddenIds.has(e.source) || hiddenIds.has(e.target),
  }));
  syncing.value = false;
}

function commitFlowToModel() {
  if (syncing.value || isApplying()) return;
  try {
    const raw = flowToRuleGraph(flowNodes.value as any, flowEdges.value as any, props.modelValue);
    const next = normalizeSegmentEdges(raw);
    syncFlowEdgesFromGraph(next);
    refreshAllFlowNodes(next);
    const fp = graphFingerprint(next);
    if (fp === localFingerprint) return;
    localFingerprint = fp;
    syncing.value = true;
    emit("update:modelValue", next);
  } catch {
    // 画布暂不完整
  } finally {
    nextTick(() => {
      syncing.value = false;
    });
  }
}

function applyGraph(graph: RuleGraph) {
  const migrated = normalizeSegmentEdges(graph);
  localFingerprint = graphFingerprint(migrated);
  syncing.value = true;
  emit("update:modelValue", migrated);
  syncFlowFromGraph(migrated);
  syncing.value = false;
}

function recordBeforeChange() {
  pushState(liveGraph.value);
}

watch(
  () => props.modelValue,
  (g) => {
    if (syncing.value || isApplying()) return;
    const fp = graphFingerprint(g);
    if (fp === localFingerprint) return;
    localFingerprint = fp;
    syncFlowFromGraph(g);
  },
  { deep: true, immediate: true },
);

function portKindLabel(kind: string | null): string {
  if (kind === "predicate") return "条件";
  if (kind === "bool") return "判定";
  if (kind === "segment") return "段链";
  return kind ?? "未知";
}

function connectionHintForInvalid(
  srcKind: string | null,
  tgtKind: string | null,
  targetData: RuleFlowNodeData,
  _sourceData: RuleFlowNodeData,
): string {
  if (srcKind === "predicate" && tgtKind === "segment") {
    return "整行端口（蓝）不能接段链（绿）。顺序搭建请使用绿色 next 串联。";
  }
  if (srcKind === "segment" && targetData.ruleType === "scope") {
    return "段链积木不能用绿色端口直连作用范围，请从链尾用蓝色条件端口连接。";
  }
  return (
    `端口类型不匹配（${portKindLabel(srcKind)} → ${portKindLabel(tgtKind)}）。` +
    "段链：绿色 next 串联，链尾用蓝色条件口接且/或/作用范围。"
  );
}

function normalizeSegmentConnection(connection: Connection): Connection {
  const sourceNode = flowNodes.value.find((n) => n.id === connection.source);
  const targetNode = flowNodes.value.find((n) => n.id === connection.target);
  if (!sourceNode?.data || !targetNode?.data) return connection;

  const sd = sourceNode.data as RuleFlowNodeData;
  const td = targetNode.data as RuleFlowNodeData;
  const sourceMode = ((sd.params as { builderMode?: string }).builderMode ?? "line");
  const targetMode = ((td.params as { builderMode?: string }).builderMode ?? "line");

  if (
    sourceMode === "segment" &&
    targetMode === "segment" &&
    (sd.ruleType === "non_empty" || sd.ruleType === "matches_text") &&
    td.ruleType === "count"
  ) {
    return { ...connection, sourceHandle: "next", targetHandle: "segment_in" };
  }

  if (td.ruleType === "sequence" && connection.targetHandle === "segment_in") {
    return { ...connection, sourceHandle: "next", targetHandle: "segment_in" };
  }

  return connection;
}

const isValidConnection: ValidConnectionFunc = (connection) => {
  const sourceNode = flowNodes.value.find((n) => n.id === connection.source);
  const targetNode = flowNodes.value.find((n) => n.id === connection.target);
  if (!sourceNode?.data || !targetNode?.data || !connection.sourceHandle || !connection.targetHandle) {
    return false;
  }
  const sourceData = sourceNode.data as RuleFlowNodeData;
  const targetData = targetNode.data as RuleFlowNodeData;
  const srcKind = getPortKind(sourceData.ruleType, connection.sourceHandle, "source");
  const tgtKind = getPortKind(targetData.ruleType, connection.targetHandle, "target");

  const valid = srcKind !== null && srcKind === tgtKind;
  if (!valid && connection.target) {
    pendingConnectionHint = connectionHintForInvalid(srcKind, tgtKind, targetData, sourceData);
  } else if (valid) {
    pendingConnectionHint = null;
  }
  return valid;
};

function onConnectStart() {
  pendingConnectionHint = null;
  connectionHint.value = null;
}

function onConnectEnd() {
  if (pendingConnectionHint) {
    connectionHint.value = pendingConnectionHint;
    window.setTimeout(() => {
      connectionHint.value = null;
      pendingConnectionHint = null;
    }, 2800);
    return;
  }
  connectionHint.value = null;
}

function focusCanvas() {
  canvasHostRef.value?.focus({ preventScroll: true });
}

function isPointInCanvas(clientX: number, clientY: number): boolean {
  const host = canvasHostRef.value;
  if (!host) return false;
  const rect = host.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function addNodeAtScreen(type: NodeType, clientX: number, clientY: number) {
  recordBeforeChange();
  const position =
    vueFlowRef.value?.screenToFlowCoordinate({ x: clientX, y: clientY }) ?? { x: 80, y: 80 };
  flowNodes.value = [
    ...flowNodes.value,
    createFlowNode(type, position, undefined, undefined, liveGraph.value) as any,
  ];
  commitFlowToModel();
  focusCanvas();
}

function onConnect(connection: Connection) {
  pendingConnectionHint = null;
  connectionHint.value = null;
  recordBeforeChange();
  const normalized = normalizeSegmentConnection(connection);
  flowEdges.value = addEdge(
    {
      ...normalized,
      id: newRuleId("edge"),
      type: "straight",
    },
    flowEdges.value,
  ) as any;
  applyEdgeLayout();
  commitFlowToModel();
}

function onNodeClick(event: { node: { id: string } }) {
  selectedNodeId.value = event.node.id;
  focusCanvas();
}

function onPaneClick() {
  selectedNodeId.value = null;
  focusCanvas();
}

function onNodeDragStart() {
  if (dragSnapshotTaken.value) return;
  recordBeforeChange();
  dragSnapshotTaken.value = true;
}

function onNodeDragStop() {
  dragSnapshotTaken.value = false;
  commitFlowToModel();
}

function onPalettePickStart(type: NodeType, event: PointerEvent) {
  palettePickType.value = type;
  palettePickActive.value = true;
  ghostPos.value = { x: event.clientX, y: event.clientY };
  window.addEventListener("pointermove", onPalettePointerMove);
  window.addEventListener("pointerup", onPalettePointerUp);
  window.addEventListener("pointercancel", onPalettePointerUp);
}

function onPalettePointerMove(event: PointerEvent) {
  if (!palettePickActive.value) return;
  ghostPos.value = { x: event.clientX, y: event.clientY };
  canvasDragOver.value = isPointInCanvas(event.clientX, event.clientY);
}

function cleanupPalettePick() {
  palettePickType.value = null;
  palettePickActive.value = false;
  ghostPos.value = null;
  canvasDragOver.value = false;
  window.removeEventListener("pointermove", onPalettePointerMove);
  window.removeEventListener("pointerup", onPalettePointerUp);
  window.removeEventListener("pointercancel", onPalettePointerUp);
}

function onPalettePointerUp(event: PointerEvent) {
  if (!palettePickActive.value || !palettePickType.value) {
    cleanupPalettePick();
    return;
  }
  const type = palettePickType.value;
  if (isPointInCanvas(event.clientX, event.clientY)) {
    addNodeAtScreen(type, event.clientX, event.clientY);
  }
  cleanupPalettePick();
}

function removeSelectedNode() {
  if (!selectedNodeId.value) return;
  const node = flowNodes.value.find((n) => n.id === selectedNodeId.value);
  const data = node?.data as RuleFlowNodeData | undefined;
  if (!node || data?.ruleType === "root") return;

  recordBeforeChange();

  const id = selectedNodeId.value;
  flowNodes.value = flowNodes.value.filter((n) => n.id !== id);
  flowEdges.value = flowEdges.value.filter((e) => e.source !== id && e.target !== id);
  selectedNodeId.value = null;
  applyEdgeLayout();
  commitFlowToModel();
}

function onCanvasKeyDown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) doRedo();
    else doUndo();
    return;
  }

  if (event.key !== "Delete" && event.key !== "Backspace") return;
  if (!selectedNodeId.value) return;
  event.preventDefault();
  removeSelectedNode();
}

function doUndo() {
  const prev = undo(liveGraph.value);
  if (!prev) return;
  selectedNodeId.value = null;
  applyGraph(prev);
}

function doRedo() {
  const next = redo(liveGraph.value);
  if (!next) return;
  selectedNodeId.value = null;
  applyGraph(next);
}

function createTemplate(kind: TemplateKind): RuleGraph {
  if (kind === "playlist") return createPlaylistSequenceRuleGraph();
  if (kind === "numbered") return createNumberedListRuleGraph();
  return createDefaultRuleGraph();
}

function loadTemplate(kind: TemplateKind) {
  recordBeforeChange();
  applyGraph(createTemplate(kind));
  selectedNodeId.value = null;
  nextTick(() => vueFlowRef.value?.fitView({ padding: 0.2, duration: 250 }));
}

function runAutoLayout() {
  recordBeforeChange();
  const next = autoLayoutRuleGraph(liveGraph.value);
  applyGraph(next);
  nextTick(() => vueFlowRef.value?.fitView({ padding: 0.2, duration: 300 }));
}

function updateSelectedParams(params: RuleNode["params"]) {
  if (!selectedNodeId.value) return;
  recordBeforeChange();
  flowNodes.value = flowNodes.value.map((n) => {
    if (n.id !== selectedNodeId.value) return n;
    const data = n.data as RuleFlowNodeData;
    return refreshFlowNodeData({
      ...n,
      data: { ...data, params: structuredClone(params) },
    }, liveGraph.value);
  });
  const hiddenIds = getCollapsedHiddenNodeIds(
    flowToRuleGraph(flowNodes.value as any, flowEdges.value as any, props.modelValue),
  );
  flowNodes.value = flowNodes.value.map((n) => ({
    ...n,
    hidden: hiddenIds.has(n.id),
  }));
  flowEdges.value = flowEdges.value.map((e) => ({
    ...e,
    hidden: hiddenIds.has(e.source) || hiddenIds.has(e.target),
  }));
  commitFlowToModel();
}

function clearAllBlocks() {
  recordBeforeChange();
  applyGraph(createBlankRuleGraph());
  selectedNodeId.value = null;
  ioMessage.value = "已清除全部积木";
  ioError.value = null;
  nextTick(() => vueFlowRef.value?.fitView({ padding: 0.2, duration: 250 }));
}

async function exportRuleGraph() {
  if (ioBusy.value) return;
  ioBusy.value = true;
  ioMessage.value = null;
  ioError.value = null;
  try {
    const content = serializeRuleGraph(liveGraph.value);
    const path = await invoke<string | null>("pick_save_file", {
      defaultName: "rule-graph.json",
      filterLabel: "JSON",
      filterExts: ["json"],
    });
    if (!path) return;
    await invoke("write_text_file", { path, content });
    ioMessage.value = "规则图已导出";
    if (isBuilder.value) {
      pushDebugLine("正则生成", "graph-export", path.replace(/^.*[/\\]/, ""), { path });
    }
  } catch (err) {
    ioError.value = err instanceof Error ? err.message : String(err);
  } finally {
    ioBusy.value = false;
  }
}

async function importRuleGraph() {
  if (ioBusy.value) return;
  ioBusy.value = true;
  ioMessage.value = null;
  ioError.value = null;
  try {
    const path = await invoke<string | null>("pick_open_file", {
      filterLabel: "JSON",
      filterExts: ["json"],
    });
    if (!path) return;
    recordBeforeChange();
    const raw = await invoke<string>("read_text_file", { path });
    const graph = parseRuleGraphJson(raw);
    applyGraph(graph);
    selectedNodeId.value = null;
    ioMessage.value = "规则图已导入";
    if (isBuilder.value) {
      pushDebugLine("正则生成", "graph-import", path.replace(/^.*[/\\]/, ""), {
        path,
        nodes: graph.nodes.length,
      });
    }
    nextTick(() => vueFlowRef.value?.fitView({ padding: 0.2, duration: 250 }));
  } catch (err) {
    ioError.value = err instanceof Error ? err.message : String(err);
  } finally {
    ioBusy.value = false;
  }
}

function onToolbarAction(id: ToolbarActionId) {
  switch (id) {
    case "default":
      loadTemplate("default");
      break;
    case "playlist":
      loadTemplate("playlist");
      break;
    case "numbered":
      loadTemplate("numbered");
      break;
    case "layout":
      runAutoLayout();
      break;
    case "undo":
      doUndo();
      break;
    case "redo":
      doRedo();
      break;
    case "export":
      void exportRuleGraph();
      break;
    case "import":
      void importRuleGraph();
      break;
    case "delete":
      removeSelectedNode();
      break;
    case "clear":
      clearAllBlocks();
      break;
  }
}

function isToolbarDisabled(id: ToolbarActionId): boolean {
  if (id === "undo") return !canUndo.value;
  if (id === "redo") return !canRedo.value;
  if (id === "delete") return !selectedNodeId.value;
  if (id === "export" || id === "import") return ioBusy.value;
  return false;
}

onUnmounted(() => cleanupPalettePick());
</script>

<template>
  <div
    class="rule-graph-editor flex min-h-0 flex-col gap-2"
    :class="isBuilder ? 'min-h-[28rem]' : ''"
  >
    <div class="ui-matte-panel flex flex-wrap items-start justify-between gap-2 rounded-xl px-3 py-2.5">
      <div class="min-w-0 flex-1">
        <p v-if="!isBuilder" class="text-xs leading-relaxed text-zinc-300/90">
          <span class="text-zinc-500">规则说明：</span>{{ summary }}
        </p>
        <p v-for="issue in validationErrors" :key="issue.code + (issue.nodeId ?? '')" class="mt-1 text-xs text-rose-400">
          {{ issue.message }}
        </p>
        <p v-if="ioMessage" class="mt-1 text-xs text-emerald-400/90">{{ ioMessage }}</p>
        <p v-if="ioError" class="mt-1 text-xs text-rose-400">{{ ioError }}</p>
        <p v-if="connectionHint" class="mt-1 text-xs text-amber-400/90">{{ connectionHint }}</p>
      </div>
      <div class="flex shrink-0 flex-wrap gap-0.5">
        <slot v-if="isBuilder" name="toolbar-extra" />
        <button
          type="button"
          class="icon-btn ui-matte-chip"
          :class="{ 'icon-btn--active': showMinimap }"
          title="小地图"
          @click="showMinimap = !showMinimap"
        >
          <Icon icon="mdi:map-outline" class="h-4 w-4" />
        </button>
        <button
          v-for="action in toolbarActions"
          :key="action.id"
          type="button"
          class="icon-btn ui-matte-chip"
          :class="{ 'icon-btn--danger': 'danger' in action && action.danger }"
          :title="action.title"
          :disabled="isToolbarDisabled(action.id)"
          @click="onToolbarAction(action.id)"
        >
          <Icon :icon="action.icon" class="h-4 w-4" />
        </button>
      </div>
    </div>

    <div
      class="grid flex-1 grid-cols-1 gap-2 lg:grid-cols-[9.5rem_minmax(0,1fr)_8rem]"
      :class="isBuilder ? 'min-h-[24rem]' : 'min-h-[22rem]'"
    >
      <div class="ui-matte-panel hidden min-h-0 overflow-hidden rounded-xl lg:flex lg:flex-col">
        <div class="ui-matte-panel-header shrink-0 px-1.5 py-1 text-[10px] text-zinc-500">积木库</div>
        <RuleNodePalette @pick-start="onPalettePickStart" />
      </div>

      <div
        ref="canvasHostRef"
        tabindex="0"
        class="ui-matte-canvas rule-graph-canvas relative min-h-[18rem] overflow-hidden rounded-xl outline-none"
        :class="{
          'is-palette-dragging': palettePickActive,
          'is-drag-over': canvasDragOver,
        }"
        @keydown="onCanvasKeyDown"
        @mousedown="focusCanvas"
      >
        <VueFlow
          ref="vueFlowRef"
          v-model:nodes="flowNodes"
          v-model:edges="flowEdges"
          :node-types="nodeTypes"
          :fit-view-on-init="true"
          :min-zoom="0.35"
          :max-zoom="1.5"
          :is-valid-connection="isValidConnection"
          :connection-radius="48"
          class="h-full min-h-[18rem]"
          @connect="onConnect"
          @connect-start="onConnectStart"
          @connect-end="onConnectEnd"
          @node-click="onNodeClick"
          @pane-click="onPaneClick"
          @node-drag-start="onNodeDragStart"
          @node-drag-stop="onNodeDragStop"
        >
          <Background pattern-color="rgb(255 255 255 / 0.06)" :gap="20" />
          <Controls position="bottom-right" />
          <MiniMap
            v-if="showMinimap"
            pannable
            zoomable
            class="rule-graph-minimap"
            node-color="#3f3f46"
            mask-color="rgb(0 0 0 / 0.55)"
          />
        </VueFlow>

        <div
          v-if="palettePickActive && ghostPos"
          class="palette-ghost pointer-events-none fixed z-[9999]"
          :style="{ left: `${ghostPos.x + 12}px`, top: `${ghostPos.y + 12}px` }"
        >
          {{ paletteGhostLabel }}
        </div>
      </div>

      <div class="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-black/25">
        <div class="border-b border-border px-2 py-1.5 text-[10px] text-zinc-500">属性</div>
        <RuleGraphPropsPanel
          :node="selectedRuleNode"
          :in-segment-chain="
            selectedRuleNode ? shouldShowSegmentBadge(liveGraph, selectedRuleNode) : false
          "
          @update:params="updateSelectedParams"
        />
        <div v-if="!isBuilder" class="border-t border-border">
          <div class="border-b border-border px-2 py-1.5 text-[10px] text-zinc-500">模式预览</div>
          <p class="break-all px-2 py-1.5 font-mono text-xs leading-relaxed text-sky-300/90">
            {{ pseudoPattern }}
          </p>
          <div class="border-b border-t border-border px-2 py-1.5 text-[10px] text-zinc-500">
            试跑预览
          </div>
          <div class="max-h-36 space-y-1 overflow-y-auto p-2">
            <p v-if="preview.error" class="text-xs text-amber-400/90">{{ preview.error }}</p>
            <div
              v-for="(row, idx) in preview.rows"
              :key="idx"
              class="flex items-start gap-1.5 text-xs"
            >
              <Icon
                :icon="row.pass ? 'mdi:check-circle' : 'mdi:close-circle'"
                :class="row.pass ? 'text-emerald-400' : 'text-rose-400'"
                class="mt-0.5 shrink-0"
              />
              <span class="min-w-0 text-zinc-400">
                <span v-if="row.lineNumber" class="text-zinc-600">L{{ row.lineNumber }} </span>
                <span class="break-all">{{ row.text }}</span>
                <span v-if="row.reason" class="block text-rose-300/80">{{ row.reason }}</span>
              </span>
            </div>
            <p v-if="!preview.error && preview.rows.length === 0" class="text-xs text-zinc-600">
              填写待比对项后可预览前几条
            </p>
          </div>
        </div>
      </div>
    </div>

    <details class="rounded-lg border border-border bg-black/20 lg:hidden">
      <summary class="cursor-pointer px-3 py-2 text-xs text-zinc-400">积木库（点击展开）</summary>
      <RuleNodePalette @pick-start="onPalettePickStart" />
    </details>
  </div>
</template>

<style scoped>
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 0.375rem;
  border: 1px solid var(--color-border);
  background: rgb(0 0 0 / 0.25);
  color: rgb(212 212 216);
  transition: background 0.15s, color 0.15s;
}
.icon-btn:hover:not(:disabled) {
  background: rgb(255 255 255 / 0.06);
}
.icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.icon-btn--danger:not(:disabled) {
  color: rgb(252 165 165 / 0.9);
}
.icon-btn--active {
  border-color: color-mix(in srgb, var(--color-accent) 55%, rgb(39 39 42));
  background: color-mix(in srgb, var(--color-accent) 12%, rgb(0 0 0 / 0.25));
  color: var(--color-accent);
}
.rule-graph-canvas.is-palette-dragging {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 25%, transparent);
}
.rule-graph-canvas.is-drag-over {
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--color-accent) 55%, transparent);
  background: color-mix(in srgb, var(--color-accent) 6%, transparent);
}
.rule-graph-canvas:focus-visible {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 35%, transparent);
}
.palette-ghost {
  border-radius: 0.5rem;
  border: 1px dashed color-mix(in srgb, var(--color-accent) 60%, rgb(63 63 70));
  background: rgb(24 24 27 / 0.92);
  padding: 0.35rem 0.6rem;
  font-size: 0.75rem;
  color: rgb(228 228 231);
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.4);
}
:deep(.vue-flow__controls) {
  overflow: hidden;
  border-radius: 0.5rem;
  border: 1px solid rgb(39 39 42);
  background: rgb(24 24 27 / 0.9);
}
:deep(.vue-flow__controls-button) {
  border: none;
  background: transparent;
  color: rgb(161 161 170);
}
:deep(.vue-flow__controls-button:hover) {
  background: rgb(255 255 255 / 0.06);
}
:deep(.rule-graph-minimap) {
  overflow: hidden;
  border-radius: 0.5rem;
  border: 1px solid rgb(39 39 42);
  background: rgb(24 24 27 / 0.92);
}
:deep(.vue-flow__minimap-mask) {
  fill: rgb(0 0 0 / 0.55);
}
</style>
