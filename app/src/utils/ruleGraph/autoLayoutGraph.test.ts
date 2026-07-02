import { describe, expect, it } from "vitest";
import { autoLayoutRuleGraph } from "./autoLayoutGraph";
import {
  createDefaultRuleGraph,
  createNode,
  createNumberedListRuleGraph,
  createPlaylistRuleGraph,
  createPlaylistSequenceRuleGraph,
  resetRuleGraphIdCounter,
} from "./defaultGraph";
import { createFormatTemplateGraph } from "./formatTemplates";

function edge(
  source: { id: string },
  sourceHandle: string,
  target: { id: string },
  targetHandle: string,
) {
  return {
    id: `edge_${source.id}_${target.id}`,
    source: source.id,
    sourceHandle,
    target: target.id,
    targetHandle,
  };
}

describe("autoLayoutRuleGraph", () => {
  it("主链单路径节点 Y 对齐", () => {
    const graph = createDefaultRuleGraph();
    const laid = autoLayoutRuleGraph(graph);
    const byType = Object.fromEntries(laid.nodes.map((n) => [n.type, n.position]));

    expect(byType.non_empty.y).toBe(byType.and.y);
    expect(byType.and.y).toBe(byType.scope.y);
    expect(byType.scope.y).toBe(byType.root.y);
    expect(byType.and.x).toBeLessThan(byType.scope.x);
  });

  it("多分支汇入 AND 时各分支与 AND 同 Y、分列排列", () => {
    const graph = createPlaylistRuleGraph();
    const laid = autoLayoutRuleGraph(graph);
    const map = new Map(laid.nodes.map((n) => [n.type, n.position]));

    const andY = map.get("and")!.y;
    expect(map.get("non_empty")!.y).toBe(andY);
    expect(map.get("contains")!.y).toBe(andY);
    expect(map.get("split_parts")!.y).toBe(andY);

    const branchTypes = ["non_empty", "contains", "split_parts"] as const;
    const xs = branchTypes.map((t) => map.get(t)!.x);
    expect(new Set(xs).size).toBe(3);
    expect(Math.max(...xs)).toBeLessThan(map.get("and")!.x);
  });

  it("段链节点在同一水平行", () => {
    resetRuleGraphIdCounter();
    const a = createNode("non_empty", { x: 0, y: 0 });
    const b = createNode("space", { x: 0, y: 0 });
    const c = createNode("matches_text", { x: 0, y: 0 }, { text: "-" });
    const sequence = createNode("sequence", { x: 0, y: 0 });
    const scope = createNode("scope", { x: 0, y: 0 }, { mode: "line" });
    const root = createNode("root", { x: 0, y: 0 });

    const graph = {
      version: 1 as const,
      nodes: [a, b, c, sequence, scope, root],
      edges: [
        edge(a, "next", b, "segment_in"),
        edge(b, "next", c, "segment_in"),
        edge(c, "next", sequence, "segment_in"),
        edge(sequence, "predicate_out", scope, "predicate"),
        edge(scope, "bool", root, "in"),
      ],
    };

    const laid = autoLayoutRuleGraph(graph);
    const pos = new Map(laid.nodes.map((n) => [n.id, n.position]));
    expect(pos.get(a.id)!.y).toBe(pos.get(b.id)!.y);
    expect(pos.get(b.id)!.y).toBe(pos.get(c.id)!.y);
    expect(pos.get(a.id)!.x).toBeLessThan(pos.get(b.id)!.x);
    expect(pos.get(c.id)!.x).toBeLessThan(pos.get(sequence.id)!.x);
  });

  it("编号列表模板主链水平对齐", () => {
    const graph = createNumberedListRuleGraph();
    const laid = autoLayoutRuleGraph(graph);
    const map = new Map(laid.nodes.map((n) => [n.type, n.position]));
    expect(map.get("non_empty")!.y).toBe(map.get("and")!.y);
    expect(map.get("starts_with")!.y).toBe(map.get("and")!.y);
  });

  it("未接入主链的积木保持原位置", () => {
    resetRuleGraphIdCounter();
    const graph = createDefaultRuleGraph();
    const orphan = createNode("starts_with", { x: 320, y: 400 }, { preset: "text", text: "x" });
    graph.nodes.push(orphan);

    const laid = autoLayoutRuleGraph(graph);
    const orphanLaid = laid.nodes.find((n) => n.id === orphan.id)!;
    expect(orphanLaid.position).toEqual({ x: 320, y: 400 });
  });

  it("无 sequence 的段链（手机号积木模板）节点不重叠", () => {
    const graph = createFormatTemplateGraph("phone_cn", "blocks");
    const laid = autoLayoutRuleGraph(graph);
    const segmentTypes = new Set(["matches_text", "position_char", "char_run"]);
    const segmentNodes = laid.nodes.filter((n) => segmentTypes.has(n.type));
    expect(segmentNodes).toHaveLength(3);

    const xs = segmentNodes.map((n) => n.position.x);
    expect(new Set(xs).size).toBe(3);
    expect(segmentNodes.every((n) => n.position.y === segmentNodes[0]!.position.y)).toBe(true);
    expect(Math.max(...xs)).toBeLessThan(
      laid.nodes.find((n) => n.type === "scope")!.position.x,
    );
  });

  it("无 sequence 的段链（身份证积木模板）节点不重叠", () => {
    const graph = createFormatTemplateGraph("id_card_cn", "blocks");
    const laid = autoLayoutRuleGraph(graph);
    const segmentTypes = new Set(["position_char", "char_run", "char_class_seg"]);
    const segmentNodes = laid.nodes.filter((n) => segmentTypes.has(n.type));
    expect(segmentNodes).toHaveLength(4);

    const xs = segmentNodes.map((n) => n.position.x);
    expect(new Set(xs).size).toBe(4);
  });

  it("歌单段链模板（尾节点直连 AND）段链水平展开", () => {
    const graph = createPlaylistSequenceRuleGraph();
    const laid = autoLayoutRuleGraph(graph);
    const segmentNodes = laid.nodes.filter((n) =>
      ["non_empty", "count", "space", "matches_text"].includes(n.type),
    );
    expect(segmentNodes.length).toBeGreaterThan(3);

    const xs = segmentNodes.map((n) => n.position.x);
    expect(new Set(xs).size).toBe(xs.length);
    const andX = laid.nodes.find((n) => n.type === "and")!.position.x;
    expect(Math.max(...xs)).toBeLessThan(andX);
  });
});
