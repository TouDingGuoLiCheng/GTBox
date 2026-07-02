import type {
  GraphValidationIssue,
  RuleGraph,
  RuleNode,
} from "../../types/ruleGraph";
import { getNodeDef } from "./nodeDefs";
import {
  collectAllSegmentChainNodeIds,
  collectSegmentChainEndingAt,
  collectSegmentChainOrder,
  detectSegmentCycle,
  getNodeBuilderMode,
  getHandlePortKind,
  isInSegmentChain,
  isSegmentChainTailNode,
  isSegmentEdge,
  participatesInSegmentEdge,
  PURE_SEGMENT_TYPES,
  SEGMENT_NODE_TYPES,
} from "./segmentChain";

function nodeMap(graph: RuleGraph): Map<string, RuleNode> {
  return new Map(graph.nodes.map((n) => [n.id, n]));
}

function incomingEdges(graph: RuleGraph, nodeId: string) {
  return graph.edges.filter((e) => e.target === nodeId);
}

function detectCycle(graph: RuleGraph): string[] | null {
  const nodes = graph.nodes;
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of graph.edges) {
    adj.get(e.source)?.push(e.target);
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

  for (const n of nodes) {
    const cycle = dfs(n.id);
    if (cycle) return cycle;
  }
  return null;
}

function validateSegmentChains(
  graph: RuleGraph,
  map: Map<string, RuleNode>,
  issues: GraphValidationIssue[],
): void {
  const segmentCycle = detectSegmentCycle(graph);
  if (segmentCycle) {
    issues.push({
      severity: "error",
      code: "segment_cycle",
      message: "段链存在环路，请断开循环连接",
      nodeId: segmentCycle[0],
    });
  }

  for (const node of graph.nodes) {
    if (node.type === "sequence") {
      const chainOrder = collectSegmentChainOrder(graph, node.id);
      if (!chainOrder) {
        const hasSegmentIn = graph.edges.some(
          (e) => e.target === node.id && e.targetHandle === "segment_in",
        );
        issues.push({
          severity: "error",
          code: hasSegmentIn ? "sequence_invalid_chain" : "sequence_empty_chain",
          message: hasSegmentIn
            ? "顺序节点的段链结构无效（需从链头到链尾完整串联）"
            : "顺序节点未连接段链",
          nodeId: node.id,
        });
      }
      continue;
    }
    if (!SEGMENT_NODE_TYPES.has(node.type)) continue;
    if (!PURE_SEGMENT_TYPES.has(node.type) && getNodeBuilderMode(node) !== "segment") continue;
    const hasSegmentEdge = graph.edges.some(
      (e) =>
        (e.source === node.id && getHandlePortKind(node.type, e.sourceHandle, "source") === "segment") ||
        (e.target === node.id && getHandlePortKind(node.type, e.targetHandle, "target") === "segment"),
    );
    if (!hasSegmentEdge) continue;

    const hasPredicateOut = graph.edges.some(
      (e) => e.source === node.id && getHandlePortKind(node.type, e.sourceHandle, "source") === "predicate",
    );
    if (hasPredicateOut) {
      const chainOrder = collectSegmentChainEndingAt(graph, node.id);
      if (!chainOrder) {
        issues.push({
          severity: "error",
          code: "segment_invalid_chain",
          message: "段链结构无效（需从链头到链尾完整串联）",
          nodeId: node.id,
        });
      }
    }
  }

  const inChainIds = collectAllSegmentChainNodeIds(graph);
  for (const node of graph.nodes) {
    if (!SEGMENT_NODE_TYPES.has(node.type)) continue;
    if (!participatesInSegmentEdge(graph, node.id)) continue;
    if (!inChainIds.has(node.id)) {
      issues.push({
        severity: "error",
        code: "segment_orphan",
        message: `段链节点「${getNodeDef(node.type).label}」未连接到有效链尾输出`,
        nodeId: node.id,
      });
    }
  }

  for (const node of graph.nodes) {
    if (!SEGMENT_NODE_TYPES.has(node.type)) continue;
    const segmentOutEdges = graph.edges.filter(
      (e) => e.source === node.id && isSegmentEdge(graph, e),
    );
    if (segmentOutEdges.length > 1) {
      issues.push({
        severity: "error",
        code: "too_many_segment_next",
        message: `节点「${getNodeDef(node.type).label}」的段链 next 只能连接一个下游`,
        nodeId: node.id,
      });
    }
  }

  for (const edge of graph.edges) {
    const source = map.get(edge.source);
    const target = map.get(edge.target);
    if (!source || !target) continue;

    const sourceKind = getHandlePortKind(source.type, edge.sourceHandle, "source");

    if (target.type === "scope" && edge.targetHandle === "predicate") {
      if (sourceKind === "segment") {
        issues.push({
          severity: "error",
          code: "segment_direct_scope",
          message: "段链端口（绿）不能直连作用范围，请使用条件端口（蓝）",
          edgeId: edge.id,
          nodeId: source.id,
        });
      }
    }

    if (
      sourceKind === "predicate" &&
      isInSegmentChain(graph, source.id) &&
      !isSegmentChainTailNode(source)
    ) {
      issues.push({
        severity: "error",
        code: "segment_predicate_bypass",
        message: "段链上的积木不能同时作为整行判定输出（请经顺序节点汇总）",
        edgeId: edge.id,
        nodeId: source.id,
      });
    }
  }

  for (const node of graph.nodes) {
    if (node.type !== "count") continue;
    if (getNodeBuilderMode(node) !== "segment") continue;
    const boolOutEdges = graph.edges.filter(
      (e) => e.source === node.id && e.sourceHandle === "bool",
    );
    if (boolOutEdges.length > 0) {
      issues.push({
        severity: "error",
        code: "segment_count_bool_output",
        message: "段内模式的匹配次数不能使用 bool 输出，请改用条件输出 out",
        nodeId: node.id,
      });
    }
  }
}

export function validateGraph(graph: RuleGraph): GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = [];
  const map = nodeMap(graph);

  if (graph.version !== 1) {
    issues.push({
      severity: "error",
      code: "unsupported_version",
      message: `不支持的规则图版本：${graph.version}`,
    });
  }

  const roots = graph.nodes.filter((n) => n.type === "root");
  if (roots.length === 0) {
    issues.push({
      severity: "error",
      code: "missing_root",
      message: "规则图缺少输出节点（ROOT）",
    });
  } else if (roots.length > 1) {
    issues.push({
      severity: "error",
      code: "multiple_root",
      message: "规则图只能有一个输出节点（ROOT）",
    });
  }

  const scopes = graph.nodes.filter((n) => n.type === "scope");
  if (scopes.length === 0) {
    issues.push({
      severity: "warning",
      code: "missing_scope",
      message: "建议添加「作用范围」节点，以明确对全文还是每一行进行检验",
    });
  } else if (scopes.length > 1) {
    issues.push({
      severity: "error",
      code: "multiple_scope",
      message: "首版仅支持一个「作用范围」节点",
      nodeId: scopes[1]?.id,
    });
  }

  for (const node of graph.nodes) {
    if (!getNodeDef(node.type)) {
      issues.push({
        severity: "error",
        code: "unknown_node",
        message: `未知节点类型：${node.type}`,
        nodeId: node.id,
      });
    }
  }

  for (const edge of graph.edges) {
    const source = map.get(edge.source);
    const target = map.get(edge.target);
    if (!source || !target) {
      issues.push({
        severity: "error",
        code: "dangling_edge",
        message: "存在连接到已删除节点的边",
        edgeId: edge.id,
      });
      continue;
    }

    const sourceDef = getNodeDef(source.type);
    const targetDef = getNodeDef(target.type);
    const outPort = sourceDef.outputs.find((p) => p.id === edge.sourceHandle);
    const inPort = targetDef.inputs.find((p) => p.id === edge.targetHandle);

    if (!outPort) {
      issues.push({
        severity: "error",
        code: "invalid_source_handle",
        message: `节点「${sourceDef.label}」不存在输出端口 ${edge.sourceHandle}`,
        edgeId: edge.id,
        nodeId: source.id,
      });
    }
    if (!inPort) {
      issues.push({
        severity: "error",
        code: "invalid_target_handle",
        message: `节点「${targetDef.label}」不存在输入端口 ${edge.targetHandle}`,
        edgeId: edge.id,
        nodeId: target.id,
      });
    }
    if (outPort && inPort && outPort.kind !== inPort.kind) {
      issues.push({
        severity: "error",
        code: "port_kind_mismatch",
        message: `端口类型不匹配：${outPort.kind} → ${inPort.kind}`,
        edgeId: edge.id,
      });
    }
  }

  for (const node of graph.nodes) {
    const def = getNodeDef(node.type);
    for (const port of def.inputs) {
      const edges = incomingEdges(graph, node.id).filter((e) => e.targetHandle === port.id);
      if (port.max === 1 && edges.length > 1) {
        issues.push({
          severity: "error",
          code: "too_many_inputs",
          message: `节点「${def.label}」的端口 ${port.id} 只能连接一条边`,
          nodeId: node.id,
        });
      }
      if (port.max === 1 && edges.length === 0 && node.type === "root") {
        issues.push({
          severity: "error",
          code: "root_unconnected",
          message: "输出节点尚未连接判定条件",
          nodeId: node.id,
        });
      }
    }
  }

  const cycle = detectCycle(graph);
  if (cycle) {
    issues.push({
      severity: "error",
      code: "cycle_detected",
      message: "规则图存在环路，请断开循环连接",
      nodeId: cycle[0],
    });
  }

  const root = roots[0];
  if (root) {
    const rootIncoming = incomingEdges(graph, root.id);
    if (rootIncoming.length === 0) {
      issues.push({
        severity: "error",
        code: "root_unconnected",
        message: "输出节点尚未连接判定条件",
        nodeId: root.id,
      });
    }
  }

  validateSegmentChains(graph, map, issues);

  return issues;
}

export function isGraphValid(graph: RuleGraph): boolean {
  return !validateGraph(graph).some((i) => i.severity === "error");
}
