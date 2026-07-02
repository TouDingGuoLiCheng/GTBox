import type { NodeBuilderMode, NodeType, RuleEdge, RuleGraph, RuleNode } from "../../types/ruleGraph";
import { getNodeDef } from "./nodeDefs";

/** 允许出现在 segment 链上的节点类型 */
export const SEGMENT_NODE_TYPES: ReadonlySet<NodeType> = new Set([
  "non_empty",
  "matches_text",
  "count",
  "space",
  "char_run",
  "char_class_seg",
  "optional_seg",
  "position_char",
]);

export const PURE_SEGMENT_TYPES: ReadonlySet<NodeType> = new Set([
  "space",
  "char_run",
  "char_class_seg",
  "optional_seg",
  "position_char",
]);

const DUAL_MODE_TYPES: ReadonlySet<NodeType> = new Set(["non_empty", "matches_text", "count"]);

const SEGMENT_CHAIN_TAIL_TYPES: ReadonlySet<NodeType> = new Set([
  "char_run",
  "char_class_seg",
  "position_char",
]);

export function isSegmentChainTailNode(node: RuleNode): boolean {
  if (SEGMENT_CHAIN_TAIL_TYPES.has(node.type)) return true;
  return DUAL_MODE_TYPES.has(node.type) && getNodeBuilderMode(node) === "segment";
}

export function getNodeBuilderMode(node: RuleNode): NodeBuilderMode {
  if (!DUAL_MODE_TYPES.has(node.type)) return "line";
  const mode = (node.params as { builderMode?: NodeBuilderMode }).builderMode;
  return mode === "segment" ? "segment" : "line";
}

export function getHandlePortKind(
  nodeType: NodeType,
  handleId: string,
  direction: "source" | "target",
): string | null {
  const def = getNodeDef(nodeType);
  if (direction === "source") {
    return def.outputs.find((p) => p.id === handleId)?.kind ?? null;
  }
  return def.inputs.find((p) => p.id === handleId)?.kind ?? null;
}

export function isSegmentEdge(graph: RuleGraph, edge: RuleEdge): boolean {
  const source = graph.nodes.find((n) => n.id === edge.source);
  if (!source) return false;
  return getHandlePortKind(source.type, edge.sourceHandle, "source") === "segment";
}

function segmentInSources(graph: RuleGraph, nodeId: string): string[] {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return [];
  return graph.edges
    .filter((e) => {
      if (e.target !== nodeId) return false;
      return getHandlePortKind(node.type, e.targetHandle, "target") === "segment";
    })
    .map((e) => e.source);
}

function segmentNextTarget(graph: RuleGraph, nodeId: string): string | null {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const edge = graph.edges.find((e) => {
    if (e.source !== nodeId) return false;
    return getHandlePortKind(node.type, e.sourceHandle, "source") === "segment";
  });
  return edge?.target ?? null;
}

function collectChainNodeIdsFromTail(graph: RuleGraph, tailId: string): Set<string> {
  const ids = new Set<string>();
  function walkBack(id: string) {
    if (ids.has(id)) return;
    ids.add(id);
    for (const src of segmentInSources(graph, id)) {
      walkBack(src);
    }
  }
  walkBack(tailId);
  return ids;
}

function findChainHead(graph: RuleGraph, chainIds: Set<string>): string | null {
  let head: string | null = null;
  for (const id of chainIds) {
    const incoming = segmentInSources(graph, id).filter((src) => chainIds.has(src));
    if (incoming.length === 0) {
      if (head !== null) return null;
      head = id;
    }
  }
  return head;
}

function buildSegmentChainOrder(graph: RuleGraph, tailId: string): RuleNode[] | null {
  const map = new Map(graph.nodes.map((n) => [n.id, n]));
  const tailNode = map.get(tailId);
  if (!tailNode || !SEGMENT_NODE_TYPES.has(tailNode.type)) return null;

  const chainIds = collectChainNodeIdsFromTail(graph, tailId);
  const headId = findChainHead(graph, chainIds);
  if (!headId) return null;

  const order: RuleNode[] = [];
  const visited = new Set<string>();
  let current: string | null = headId;

  while (current) {
    if (visited.has(current)) return null;
    visited.add(current);
    const node = map.get(current);
    if (!node || !chainIds.has(current)) return null;
    order.push(node);

    if (current === tailId) break;
    const nextId = segmentNextTarget(graph, current);
    if (!nextId || !chainIds.has(nextId)) return null;
    current = nextId;
  }

  if (order.length === 0 || order[order.length - 1]?.id !== tailId) return null;
  if (visited.size !== chainIds.size) return null;
  return order;
}

/**
 * 兼容旧图：从顺序节点的 segment_in 入口收集段链，按链头→链尾返回稳定顺序。
 */
export function collectSegmentChainOrder(graph: RuleGraph, sequenceId: string): RuleNode[] | null {
  const tailEdge = graph.edges.find(
    (e) => e.target === sequenceId && e.targetHandle === "segment_in",
  );
  if (!tailEdge) return null;
  return buildSegmentChainOrder(graph, tailEdge.source);
}

/** 新模式：从段链尾节点收集完整段链顺序 */
export function collectSegmentChainEndingAt(graph: RuleGraph, tailNodeId: string): RuleNode[] | null {
  return buildSegmentChainOrder(graph, tailNodeId);
}

/** 收集图中所有段链上的节点 ID（含旧 sequence 链、以及新模式尾节点） */
export function collectAllSegmentChainNodeIds(graph: RuleGraph): Set<string> {
  const ids = new Set<string>();
  const legacyIds = new Set<string>();
  const map = new Map(graph.nodes.map((n) => [n.id, n]));

  for (const node of graph.nodes) {
    if (node.type === "sequence") {
      const order = collectSegmentChainOrder(graph, node.id);
      if (!order) continue;
      for (const n of order) {
        ids.add(n.id);
        legacyIds.add(n.id);
      }
      continue;
    }
    if (!SEGMENT_NODE_TYPES.has(node.type)) continue;
    const hasPredicateOut = graph.edges.some(
      (e) => e.source === node.id && getHandlePortKind(node.type, e.sourceHandle, "source") === "predicate",
    );
    if (!hasPredicateOut) continue;
    const order = collectSegmentChainEndingAt(graph, node.id);
    if (!order) continue;
    for (const n of order) ids.add(n.id);
  }

  for (const nodeId of ids) {
    if (legacyIds.has(nodeId)) continue;
    const node = map.get(nodeId);
    if (!node) continue;
    if (PURE_SEGMENT_TYPES.has(node.type)) continue;
    if (DUAL_MODE_TYPES.has(node.type) && getNodeBuilderMode(node) !== "segment") {
      ids.delete(nodeId);
    }
  }
  return ids;
}

export function isInSegmentChain(graph: RuleGraph, nodeId: string): boolean {
  return collectAllSegmentChainNodeIds(graph).has(nodeId);
}

/** 节点是否参与任意 segment 边（含未汇入主链的悬空段链） */
export function participatesInSegmentEdge(graph: RuleGraph, nodeId: string): boolean {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return false;
  return graph.edges.some((e) => {
    if (e.source === nodeId && isSegmentEdge(graph, e)) return true;
    if (e.target !== nodeId) return false;
    return getHandlePortKind(node.type, e.targetHandle, "target") === "segment";
  });
}

/** 仅在 segment 边上检测环路 */
export function detectSegmentCycle(graph: RuleGraph): string[] | null {
  const segmentNodeIds = graph.nodes
    .filter((n) => SEGMENT_NODE_TYPES.has(n.type))
    .map((n) => n.id);

  const adj = new Map<string, string[]>();
  for (const id of segmentNodeIds) adj.set(id, []);

  for (const edge of graph.edges) {
    if (!isSegmentEdge(graph, edge)) continue;
    if (!adj.has(edge.source) || !adj.has(edge.target)) continue;
    adj.get(edge.source)?.push(edge.target);
  }

  const visited = new Set<string>();
  const stack = new Set<string>();

  function dfs(id: string): string[] | null {
    if (stack.has(id)) return [id];
    if (visited.has(id)) return null;
    visited.add(id);
    stack.add(id);
    for (const next of adj.get(id) ?? []) {
      const cycle = dfs(next);
      if (cycle) return cycle;
    }
    stack.delete(id);
    return null;
  }

  for (const id of segmentNodeIds) {
    const cycle = dfs(id);
    if (cycle) return cycle;
  }
  return null;
}

export function graphHasSequence(graph: RuleGraph): boolean {
  return graph.nodes.some((n) => n.type === "sequence");
}

/** 兼容旧图：非空/等于文本 → 匹配次数 误接整行端口时，按段链修正 */
export function isSegmentQuantifierPairEdge(graph: RuleGraph, edge: RuleEdge): boolean {
  if (!graphHasSequence(graph)) return false;
  if (edge.targetHandle !== "predicate" || edge.sourceHandle !== "out") return false;
  const source = graph.nodes.find((n) => n.id === edge.source);
  const target = graph.nodes.find((n) => n.id === edge.target);
  if (target?.type !== "count") return false;
  return source?.type === "non_empty" || source?.type === "matches_text";
}

export function migrateSegmentBuilderEdges(graph: RuleGraph): RuleGraph {
  if (!graphHasSequence(graph)) return graph;
  let changed = false;
  const edges = graph.edges.map((edge) => {
    if (!isSegmentQuantifierPairEdge(graph, edge)) return edge;
    changed = true;
    return {
      ...edge,
      sourceHandle: "next",
      targetHandle: "segment_in",
    };
  });
  return changed ? { ...graph, edges } : graph;
}

export function demigrateSegmentBuilderEdges(graph: RuleGraph): RuleGraph {
  return graph;
}

export function normalizeSegmentEdges(graph: RuleGraph): RuleGraph {
  return migrateSegmentBuilderEdges(graph);
}

/** 节点属性是否切到段内模式（绿角标/段链语义） */
export function shouldUseSegmentPorts(_graph: RuleGraph, node: RuleNode): boolean {
  if (!DUAL_MODE_TYPES.has(node.type)) return false;
  return getNodeBuilderMode(node) === "segment";
}

export function shouldShowSegmentBadge(graph: RuleGraph, node: RuleNode): boolean {
  if (PURE_SEGMENT_TYPES.has(node.type)) return participatesInSegmentEdge(graph, node.id);
  return shouldUseSegmentPorts(graph, node) || isInSegmentChain(graph, node.id);
}
