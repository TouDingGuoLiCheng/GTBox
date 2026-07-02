import { describe, expect, it } from "vitest";
import type { RuleGraph } from "../../types/ruleGraph";
import { flowToRuleGraph, ruleGraphToFlow } from "./flowAdapter";
import { getCollapsedHiddenNodeIds } from "./groupCollapse";

function edge(
  id: string,
  source: string,
  target: string,
  sourceHandle = "out",
  targetHandle = "in",
) {
  return { id, source, sourceHandle, target, targetHandle };
}

describe("flowToRuleGraph collapse", () => {
  it("折叠时保留上游节点，取消折叠后可恢复", () => {
    const graph: RuleGraph = {
      version: 1,
      nodes: [
        { id: "a", type: "contains", position: { x: 0, y: 0 }, params: { text: "test" } },
        { id: "g", type: "group", position: { x: 100, y: 0 }, params: { label: "组", collapsed: true } },
        { id: "s", type: "scope", position: { x: 200, y: 0 }, params: { mode: "line" } },
        { id: "r", type: "root", position: { x: 300, y: 0 }, params: {} },
      ],
      edges: [
        edge("e1", "a", "g"),
        edge("e2", "g", "s", "out", "predicate"),
        edge("e3", "s", "r", "bool", "in"),
      ],
    };

    const hiddenIds = getCollapsedHiddenNodeIds(graph);
    expect(hiddenIds.has("a")).toBe(true);

    const { nodes, edges } = ruleGraphToFlow(graph);
    const flowNodes = nodes.map((n) => ({
      ...n,
      hidden: hiddenIds.has(n.id),
    }));
    const flowEdges = edges.map((e) => ({
      ...e,
      hidden: hiddenIds.has(e.source) || hiddenIds.has(e.target),
    }));

    const persisted = flowToRuleGraph(flowNodes, flowEdges, graph);
    expect(persisted.nodes.map((n) => n.id).sort()).toEqual(["a", "g", "r", "s"]);
    expect(persisted.edges).toHaveLength(3);

    const expanded: RuleGraph = {
      ...persisted,
      nodes: persisted.nodes.map((n) =>
        n.id === "g" ? { ...n, params: { label: "组", collapsed: false } } : n,
      ),
    };
    expect(getCollapsedHiddenNodeIds(expanded).size).toBe(0);
  });
});
