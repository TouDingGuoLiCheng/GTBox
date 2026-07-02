import type { GroupParams, RuleGraph } from "../../types/ruleGraph";

/** 折叠 GROUP 节点时需隐藏的上游节点 ID */
export function getCollapsedHiddenNodeIds(graph: RuleGraph): Set<string> {
  const hidden = new Set<string>();

  for (const group of graph.nodes) {
    if (group.type !== "group") continue;
    const params = group.params as GroupParams;
    if (!params.collapsed) continue;

    const inEdge = graph.edges.find(
      (e) => e.target === group.id && e.targetHandle === "in",
    );
    if (!inEdge) continue;

    const queue = [inEdge.source];
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (nodeId === group.id || hidden.has(nodeId)) continue;
      hidden.add(nodeId);

      for (const edge of graph.edges) {
        if (edge.target === nodeId) queue.push(edge.source);
      }
    }
  }

  return hidden;
}
