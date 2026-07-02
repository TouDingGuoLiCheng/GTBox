import type { RuleEdge, RuleGraph } from "../../types/ruleGraph";
import {
  collectSegmentChainEndingAt,
  collectSegmentChainOrder,
  getHandlePortKind,
  isSegmentEdge,
  SEGMENT_NODE_TYPES,
} from "./segmentChain";

const X_GAP = 200;
const Y_START = 80;
const SEGMENT_ROW_OFFSET = -88;

function isLayoutEdge(graph: RuleGraph, edge: RuleEdge): boolean {
  return !isSegmentEdge(graph, edge);
}

/** 与输出节点连通的所有节点（含 segment 边）；未接入主链的积木不参与布局 */
export function getLayoutParticipantIds(graph: RuleGraph): Set<string> {
  const root = graph.nodes.find((n) => n.type === "root");
  if (!root) return new Set();

  const adj = new Map<string, string[]>();
  for (const node of graph.nodes) adj.set(node.id, []);

  for (const edge of graph.edges) {
    adj.get(edge.source)?.push(edge.target);
    adj.get(edge.target)?.push(edge.source);
  }

  const visited = new Set<string>();
  const queue = [root.id];
  visited.add(root.id);

  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const next of adj.get(id) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }

  return visited;
}

function computeBaseRanks(graph: RuleGraph, participants: Set<string>): Map<string, number> {
  const incomingCount = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const id of participants) {
    incomingCount.set(id, 0);
    outgoing.set(id, []);
  }

  for (const edge of graph.edges) {
    if (!isLayoutEdge(graph, edge)) continue;
    if (!participants.has(edge.source) || !participants.has(edge.target)) continue;
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }

  const rank = new Map<string, number>();
  const pending = new Map(incomingCount);
  const queue = [...participants].filter((id) => (pending.get(id) ?? 0) === 0);

  for (const id of queue) rank.set(id, 0);

  while (queue.length > 0) {
    const id = queue.shift()!;
    const layer = rank.get(id) ?? 0;
    for (const targetId of outgoing.get(id) ?? []) {
      rank.set(targetId, Math.max(rank.get(targetId) ?? 0, layer + 1));
      pending.set(targetId, (pending.get(targetId) ?? 1) - 1);
      if (pending.get(targetId) === 0) queue.push(targetId);
    }
  }

  for (const id of participants) {
    if (!rank.has(id)) rank.set(id, 0);
  }

  return rank;
}

function spreadParallelInputRanks(
  graph: RuleGraph,
  rank: Map<string, number>,
  participants: Set<string>,
): void {
  const multiInputNodes = graph.nodes.filter((node) => {
    if (!participants.has(node.id)) return false;
    const count = graph.edges.filter(
      (e) => e.target === node.id && isLayoutEdge(graph, e) && participants.has(e.source),
    ).length;
    return count > 1;
  });

  for (const node of multiInputNodes) {
    const sources = graph.edges
      .filter(
        (e) =>
          e.target === node.id &&
          isLayoutEdge(graph, e) &&
          participants.has(e.source),
      )
      .map((e) => e.source)
      .sort();

    const nodeRank = rank.get(node.id) ?? 0;
    sources.forEach((src, i) => {
      rank.set(src, nodeRank - sources.length + i);
    });
  }

  const ranks = [...rank.values()];
  if (ranks.length === 0) return;
  const minRank = Math.min(...ranks);
  if (minRank !== 0) {
    for (const [id, r] of rank) {
      rank.set(id, r - minRank);
    }
  }
}

function applySegmentChainLayout(
  graph: RuleGraph,
  rank: Map<string, number>,
  yPos: Map<string, number>,
  participants: Set<string>,
): void {
  const laidChainNodeIds = new Set<string>();

  for (const seq of graph.nodes.filter((n) => n.type === "sequence" && participants.has(n.id))) {
    const chain = collectSegmentChainOrder(graph, seq.id);
    if (!chain || chain.length === 0) continue;

    const seqRank = rank.get(seq.id) ?? 0;
    const seqY = yPos.get(seq.id) ?? Y_START;
    const rowY = seqY + SEGMENT_ROW_OFFSET;

    chain.forEach((node, index) => {
      if (!participants.has(node.id)) return;
      rank.set(node.id, seqRank - chain.length + index);
      yPos.set(node.id, rowY);
      laidChainNodeIds.add(node.id);
    });
  }

  for (const node of graph.nodes) {
    if (laidChainNodeIds.has(node.id)) continue;
    if (!SEGMENT_NODE_TYPES.has(node.type)) continue;
    if (!participants.has(node.id)) continue;

    const predicateEdge = graph.edges.find(
      (e) =>
        e.source === node.id &&
        participants.has(e.target) &&
        getHandlePortKind(node.type, e.sourceHandle, "source") === "predicate",
    );
    if (!predicateEdge) continue;

    const chain = collectSegmentChainEndingAt(graph, node.id);
    if (!chain || chain.length <= 1) continue;
    if (chain.some((n) => laidChainNodeIds.has(n.id))) continue;

    const targetRank = rank.get(predicateEdge.target) ?? 0;
    const rowY = (yPos.get(predicateEdge.target) ?? Y_START) + SEGMENT_ROW_OFFSET;

    chain.forEach((chainNode, index) => {
      if (!participants.has(chainNode.id)) return;
      rank.set(chainNode.id, targetRank - chain.length + index);
      yPos.set(chainNode.id, rowY);
      laidChainNodeIds.add(chainNode.id);
    });
  }

  const ranks = [...rank.values()];
  if (ranks.length === 0) return;
  const minRank = Math.min(...ranks);
  if (minRank !== 0) {
    for (const [id, r] of rank) {
      rank.set(id, r - minRank);
    }
  }
}

/** 按拓扑层级从左到右自动排列；未接入输出主链的积木保持原位 */
export function autoLayoutRuleGraph(graph: RuleGraph): RuleGraph {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, { ...n, position: { ...n.position } }]));
  const participants = getLayoutParticipantIds(graph);

  if (participants.size === 0) {
    return { ...graph, nodes: graph.nodes.map((n) => nodeMap.get(n.id)!) };
  }

  const rank = computeBaseRanks(graph, participants);
  spreadParallelInputRanks(graph, rank, participants);

  const yPos = new Map<string, number>();
  for (const id of participants) {
    yPos.set(id, Y_START);
  }

  applySegmentChainLayout(graph, rank, yPos, participants);

  for (const node of graph.nodes) {
    const mapped = nodeMap.get(node.id)!;
    if (!participants.has(node.id)) continue;
    mapped.position = {
      x: (rank.get(node.id) ?? 0) * X_GAP,
      y: yPos.get(node.id) ?? Y_START,
    };
  }

  return {
    ...graph,
    nodes: graph.nodes.map((n) => nodeMap.get(n.id)!),
  };
}

export { X_GAP, Y_START, SEGMENT_ROW_OFFSET };
