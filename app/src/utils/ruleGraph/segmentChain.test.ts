import { describe, expect, it } from "vitest";
import type { RuleGraph, RuleNode } from "../../types/ruleGraph";
import { createNode, resetRuleGraphIdCounter } from "./defaultGraph";
import {
  collectSegmentChainEndingAt,
  collectSegmentChainOrder,
  detectSegmentCycle,
  getNodeBuilderMode,
  isInSegmentChain,
  migrateSegmentBuilderEdges,
  normalizeSegmentEdges,
  shouldUseSegmentPorts,
} from "./segmentChain";
import { validateGraph } from "./validateGraph";

function edge(
  source: RuleNode,
  sourceHandle: string,
  target: RuleNode,
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

function buildChainGraph(): {
  graph: RuleGraph;
  a: RuleNode;
  b: RuleNode;
  c: RuleNode;
  sequence: RuleNode;
} {
  resetRuleGraphIdCounter();
  const a = createNode("non_empty", { x: 0, y: 0 }, { builderMode: "segment" });
  const b = createNode("space", { x: 80, y: 0 });
  const c = createNode("matches_text", { x: 160, y: 0 }, { text: "-", builderMode: "segment" });
  const scope = createNode("scope", { x: 300, y: 0 }, { mode: "line" });
  const root = createNode("root", { x: 440, y: 0 });

  const graph: RuleGraph = {
    version: 1,
    nodes: [a, b, c, scope, root],
    edges: [
      edge(a, "next", b, "segment_in"),
      edge(b, "next", c, "segment_in"),
      edge(c, "out", scope, "predicate"),
      edge(scope, "bool", root, "in"),
    ],
  };

  return { graph, a, b, c, sequence: c };
}

describe("collectSegmentChainOrder", () => {
  it("按链头→链尾返回稳定顺序 A→B→C（新模式）", () => {
    const { graph, a, b, c } = buildChainGraph();
    const order = collectSegmentChainEndingAt(graph, c.id);
    expect(order?.map((n) => n.id)).toEqual([a.id, b.id, c.id]);
  });

  it("兼容旧 sequence 图", () => {
    resetRuleGraphIdCounter();
    const a = createNode("non_empty", { x: 0, y: 0 });
    const sequence = createNode("sequence", { x: 80, y: 0 });
    const graph: RuleGraph = {
      version: 1,
      nodes: [a, sequence],
      edges: [edge(a, "next", sequence, "segment_in")],
    };
    expect(collectSegmentChainOrder(graph, sequence.id)?.map((n) => n.id)).toEqual([a.id]);
  });

  it("无 segment 连接时返回 null", () => {
    resetRuleGraphIdCounter();
    const sequence = createNode("sequence", { x: 0, y: 0 });
    const graph: RuleGraph = { version: 1, nodes: [sequence], edges: [] };
    expect(collectSegmentChainOrder(graph, sequence.id)).toBeNull();
  });

  it("段链成环时返回 null", () => {
    resetRuleGraphIdCounter();
    const a = createNode("non_empty", { x: 0, y: 0 });
    const b = createNode("space", { x: 80, y: 0 });
    const sequence = createNode("sequence", { x: 160, y: 0 });
    const graph: RuleGraph = {
      version: 1,
      nodes: [a, b, sequence],
      edges: [
        edge(a, "next", b, "segment_in"),
        edge(b, "next", a, "segment_in"),
        edge(b, "next", sequence, "segment_in"),
      ],
    };
    expect(collectSegmentChainOrder(graph, sequence.id)).toBeNull();
    expect(detectSegmentCycle(graph)).not.toBeNull();
  });
});

describe("isInSegmentChain", () => {
  it("标记段链内节点", () => {
    const { graph, a, b } = buildChainGraph();
    expect(isInSegmentChain(graph, a.id)).toBe(true);
    expect(isInSegmentChain(graph, b.id)).toBe(true);
  });
});

describe("validateGraph segment 规则", () => {
  it("顺序节点未连接段链时报错", () => {
    resetRuleGraphIdCounter();
    const sequence = createNode("sequence", { x: 0, y: 0 });
    const scope = createNode("scope", { x: 100, y: 0 });
    const root = createNode("root", { x: 200, y: 0 });
    const graph: RuleGraph = {
      version: 1,
      nodes: [sequence, scope, root],
      edges: [
        edge(sequence, "predicate_out", scope, "predicate"),
        edge(scope, "bool", root, "in"),
      ],
    };
    const codes = validateGraph(graph).map((i) => i.code);
    expect(codes).toContain("sequence_empty_chain");
  });

  it("段链节点未汇入顺序节点时报错", () => {
    resetRuleGraphIdCounter();
    const a = createNode("non_empty", { x: 0, y: 0 });
    const b = createNode("space", { x: 80, y: 0 });
    const graph: RuleGraph = {
      version: 1,
      nodes: [a, b],
      edges: [edge(a, "next", b, "segment_in")],
    };
    const issue = validateGraph(graph).find((i) => i.code === "segment_orphan");
    expect(issue).toBeDefined();
    expect(issue?.message).toMatch(/未连接到有效链尾输出/);
  });

  it("段链绕过顺序直连作用范围时报错", () => {
    resetRuleGraphIdCounter();
    const a = createNode("non_empty", { x: 0, y: 0 });
    const scope = createNode("scope", { x: 100, y: 0 });
    const root = createNode("root", { x: 200, y: 0 });
    const graph: RuleGraph = {
      version: 1,
      nodes: [a, scope, root],
      edges: [
        edge(a, "out", scope, "predicate"),
        edge(scope, "bool", root, "in"),
      ],
    };
    expect(validateGraph(graph).some((i) => i.code === "segment_direct_scope")).toBe(false);

    const b = createNode("space", { x: 80, y: 0 });
    const linked: RuleGraph = {
      version: 1,
      nodes: [a, b, scope, root],
      edges: [
        edge(a, "next", b, "segment_in"),
        edge(b, "next", a, "segment_in"),
        edge(a, "out", scope, "predicate"),
        edge(scope, "bool", root, "in"),
      ],
    };
    const codes = validateGraph(linked).map((i) => i.code);
    expect(codes).toContain("segment_cycle");
  });

  it("合法段链图无 segment 相关错误", () => {
    const { graph } = buildChainGraph();
    const segmentCodes = new Set([
      "segment_cycle",
      "segment_orphan",
      "sequence_empty_chain",
      "sequence_invalid_chain",
      "segment_node_not_allowed",
      "too_many_segment_next",
      "segment_direct_scope",
      "segment_predicate_bypass",
      "sequence_direct_root",
      "segment_count_bool_output",
    ]);
    const issues = validateGraph(graph).filter((i) => segmentCodes.has(i.code));
    expect(issues).toHaveLength(0);
  });
});

describe("migrateSegmentBuilderEdges", () => {
  it("将非空→匹配次数 的整行连线纠正为 segment", () => {
    resetRuleGraphIdCounter();
    const nonEmpty = createNode("non_empty", { x: 0, y: 0 });
    const count = createNode("count", { x: 80, y: 0 }, { mode: "at_least", n: 1 });
    const sequence = createNode("sequence", { x: 160, y: 0 });
    const graph = {
      version: 1 as const,
      nodes: [nonEmpty, count, sequence],
      edges: [
        {
          id: "e1",
          source: nonEmpty.id,
          sourceHandle: "out",
          target: count.id,
          targetHandle: "predicate",
        },
      ],
    };
    const migrated = migrateSegmentBuilderEdges(graph);
    expect(migrated.edges[0]).toMatchObject({
      sourceHandle: "next",
      targetHandle: "segment_in",
    });
  });
});

describe("normalizeSegmentEdges", () => {
  it("无顺序节点时不改动段链边", () => {
    resetRuleGraphIdCounter();
    const nonEmpty = createNode("non_empty", { x: 0, y: 0 });
    const count = createNode("count", { x: 80, y: 0 }, { mode: "at_least", n: 1 });
    const graph = {
      version: 1 as const,
      nodes: [nonEmpty, count],
      edges: [edge(nonEmpty, "next", count, "segment_in")],
    };
    const normalized = normalizeSegmentEdges(graph);
    expect(normalized.edges[0]?.targetHandle).toBe("segment_in");
  });

  it("节点可通过参数切换段内语义", () => {
    resetRuleGraphIdCounter();
    const nonEmpty = createNode("non_empty", { x: 0, y: 0 }, { builderMode: "segment" });
    expect(getNodeBuilderMode(nonEmpty)).toBe("segment");
    const graph = { version: 1 as const, nodes: [nonEmpty], edges: [] };
    expect(shouldUseSegmentPorts(graph, nonEmpty)).toBe(true);
  });
});
