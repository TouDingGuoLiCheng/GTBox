import type { Edge, Node } from "@vue-flow/core";
import type {
  CountMode,
  CharRunParams,
  CharClassSegParams,
  PositionCharParams,
  GroupParams,
  NodeType,
  RuleGraph,
  RuleNode,
  SegmentQuantifierMode,
  SpaceParams,
} from "../../types/ruleGraph";
import { withAdaptiveEdgeOffsets } from "./edgeOffsets";
import { getCollapsedHiddenNodeIds } from "./groupCollapse";
import { getNodeDef, NODE_DEFS, resolveFlowPorts } from "./nodeDefs";
import {
  isInSegmentChain,
  normalizeSegmentEdges,
  shouldShowSegmentBadge,
  shouldUseSegmentPorts,
} from "./segmentChain";

function flowNodePorts(graph: RuleGraph, node: RuleNode) {
  const inChain = isInSegmentChain(graph, node.id);
  const useSegmentPorts = shouldUseSegmentPorts(graph, node);
  const showSegmentBadge = shouldShowSegmentBadge(graph, node);
  return {
    inChain,
    useSegmentPorts: showSegmentBadge,
    ports: resolveFlowPorts(node.type, useSegmentPorts),
  };
}

export interface RuleFlowNodeData {
  ruleType: NodeType;
  label: string;
  category: "structure" | "constraint" | "count" | "segment";
  params: RuleNode["params"];
  inputs: { id: string; kind: string }[];
  outputs: { id: string; kind: string }[];
  hint?: string;
  inSegmentChain?: boolean;
  useSegmentPorts?: boolean;
}

let idCounter = 0;

export function newRuleId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now()}_${idCounter}`;
}

export function resetFlowIdCounter(): void {
  idCounter = 0;
}

function countModeHint(mode: CountMode | string | undefined, n: number): string {
  switch (mode) {
    case "at_least":
      return `至少 ${n} 次`;
    case "at_most":
      return `至多 ${n} 次`;
    case "exactly":
      return `恰好 ${n} 次`;
    case "all":
      return "全部满足";
    case "global":
      return `全文至少 ${n} 次`;
    default:
      return countModeHint("all", n);
  }
}

function spaceModeHint(mode: SegmentQuantifierMode | string | undefined, n: number): string {
  switch (mode) {
    case "at_least":
      return `至少 ${n} 个`;
    case "at_most":
      return `至多 ${n} 个`;
    case "exactly":
      return n === 1 ? "1 个空格" : `恰好 ${n} 个`;
    default:
      return n === 1 ? "1 个空格" : `恰好 ${n} 个`;
  }
}

function paramHint(type: NodeType, params: RuleNode["params"]): string | undefined {
  switch (type) {
    case "contains":
    case "not_contains":
    case "matches_text": {
      const t = (params as { text?: string }).text;
      return t ? `「${t}」` : undefined;
    }
    case "split_parts": {
      const p = params as { separator?: string; parts?: number };
      return p.separator ? `${p.parts ?? 0} 段 · ${p.separator}` : undefined;
    }
    case "split_pattern": {
      const p = params as { separator?: string; parts?: number };
      return p.separator ? `拆段 ${p.parts ?? 0} · ${p.separator}` : undefined;
    }
    case "position_char": {
      const p = params as Partial<PositionCharParams>;
      if (p.mode === "literal") return p.literal ? `「${p.literal}」` : undefined;
      return `[${p.rangeFrom ?? ""}-${p.rangeTo ?? ""}]`;
    }
    case "scope": {
      const m = (params as { mode?: string }).mode;
      if (m === "full") return "全文";
      if (m === "non_empty_line") return "非空行";
      return "每一行";
    }
    case "count": {
      const p = params as { mode?: CountMode; n?: number };
      return countModeHint(p.mode, p.n ?? 0);
    }
    case "space": {
      const p = params as Partial<SpaceParams>;
      return spaceModeHint(p.mode, typeof p.n === "number" ? p.n : 1);
    }
    case "char_run": {
      const p = params as Partial<CharRunParams>;
      const n = typeof p.n === "number" ? p.n : 1;
      const kind = p.kind ?? "digit";
      return `${n}×${kind}`;
    }
    case "char_class_seg": {
      const p = params as Partial<CharClassSegParams>;
      return p.preset === "custom" ? `[${p.customClass ?? ""}]` : (p.preset ?? "digit");
    }
    case "optional_seg":
      return "可选";
    case "regex": {
      const p = (params as { pattern?: string }).pattern;
      return p ? `/${p}/` : undefined;
    }
    case "group": {
      const p = params as GroupParams;
      const name = p.label?.trim();
      if (p.collapsed) {
        return name ? `${name} · 已折叠` : "已折叠";
      }
      return name || undefined;
    }
    default:
      return undefined;
  }
}

export function createFlowNode(
  type: NodeType,
  position: { x: number; y: number },
  params?: RuleNode["params"],
  id?: string,
  graph?: RuleGraph,
): Node<RuleFlowNodeData> {
  const def = getNodeDef(type);
  const nodeId = id ?? newRuleId(type);
  const nodeParams = params ?? structuredClone(def.defaultParams);
  const ruleNode: RuleNode = { id: nodeId, type, position, params: nodeParams };
  const { inChain, useSegmentPorts, ports } = graph
    ? flowNodePorts(graph, ruleNode)
    : {
        inChain: false,
        useSegmentPorts: false,
        ports: resolveFlowPorts(type, false),
      };
  return {
    id: nodeId,
    type: "rule",
    position,
    data: {
      ruleType: type,
      label: def.label,
      category: def.category,
      params: nodeParams,
      inputs: ports.inputs,
      outputs: ports.outputs,
      hint: paramHint(type, nodeParams),
      inSegmentChain: inChain,
      useSegmentPorts,
    },
  };
}

export function ruleGraphToFlow(graph: RuleGraph): { nodes: Node<RuleFlowNodeData>[]; edges: Edge[] } {
  const nodes = graph.nodes.map((n) => {
    const { inChain, useSegmentPorts, ports } = flowNodePorts(graph, n);
    const flowNode = createFlowNode(n.type, n.position, n.params, n.id);
    if (flowNode.data) {
      flowNode.data.inSegmentChain = inChain;
      flowNode.data.useSegmentPorts = useSegmentPorts;
      flowNode.data.inputs = ports.inputs;
      flowNode.data.outputs = ports.outputs;
    }
    return flowNode;
  });
  const edges: Edge[] = withAdaptiveEdgeOffsets(
    graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      animated: false,
    })),
  );
  return { nodes, edges };
}

export function flowToRuleGraph(
  nodes: Node[],
  edges: Edge[],
  fallback?: RuleGraph,
): RuleGraph {
  const fallbackMap = fallback
    ? new Map(fallback.nodes.map((n) => [n.id, n]))
    : undefined;

  // 折叠分组仅影响画布显示，不得从持久化图里删除节点/边
  const ruleNodes = nodes.map((n) => {
    const data = (n.data ?? {}) as Partial<RuleFlowNodeData>;
    const fb = fallbackMap?.get(n.id);
    const type = data.ruleType ?? fb?.type;
    if (!type) {
      throw new Error(`节点 ${n.id} 缺少类型信息`);
    }
    return {
      id: n.id,
      type,
      position: { x: n.position.x, y: n.position.y },
      params: JSON.parse(JSON.stringify(data.params ?? fb?.params ?? {})),
    };
  });

  const flowIds = new Set(ruleNodes.map((n) => n.id));
  if (fallback) {
    const hiddenIds = getCollapsedHiddenNodeIds(fallback);
    for (const node of fallback.nodes) {
      if (!flowIds.has(node.id) && hiddenIds.has(node.id)) {
        ruleNodes.push(structuredClone(node));
        flowIds.add(node.id);
      }
    }
  }

  const nodeIds = new Set(ruleNodes.map((n) => n.id));
  const ruleEdges = edges
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle ?? "out",
      target: e.target,
      targetHandle: e.targetHandle ?? "in",
    }));

  if (fallback) {
    const edgeIds = new Set(ruleEdges.map((e) => e.id));
    for (const edge of fallback.edges) {
      if (edgeIds.has(edge.id)) continue;
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
      ruleEdges.push(structuredClone(edge));
      edgeIds.add(edge.id);
    }
  }

  return normalizeSegmentEdges({
    version: 1 as const,
    nodes: ruleNodes,
    edges: ruleEdges,
  });
}

export function cloneRuleGraph(graph: RuleGraph): RuleGraph {
  return structuredClone(graph);
}

export function refreshFlowNodeData(
  node: Node<RuleFlowNodeData>,
  graph?: RuleGraph,
): Node<RuleFlowNodeData> {
  const data = node.data as RuleFlowNodeData;
  if (!graph) {
    return {
      ...node,
      data: {
        ...data,
        hint: paramHint(data.ruleType, data.params),
      },
    };
  }
  const ruleNode = graph.nodes.find((n) => n.id === node.id);
  if (!ruleNode) return node;
  const { inChain, useSegmentPorts, ports } = flowNodePorts(graph, ruleNode);
  return {
    ...node,
    data: {
      ...data,
      hint: paramHint(data.ruleType, data.params),
      inSegmentChain: inChain,
      useSegmentPorts,
      inputs: ports.inputs,
      outputs: ports.outputs,
    },
  };
}

export function getPortKind(
  nodeType: NodeType,
  handleId: string,
  direction: "source" | "target",
): string | null {
  const def = NODE_DEFS[nodeType];
  if (direction === "source") {
    return def.outputs.find((p) => p.id === handleId)?.kind ?? null;
  }
  return def.inputs.find((p) => p.id === handleId)?.kind ?? null;
}
