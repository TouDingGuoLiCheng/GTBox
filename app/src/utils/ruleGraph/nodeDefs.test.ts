import { describe, expect, it } from "vitest";
import { resolveFlowPorts } from "./nodeDefs";
import { shouldShowSegmentBadge, shouldUseSegmentPorts } from "./segmentChain";
import { createNode, resetRuleGraphIdCounter } from "./defaultGraph";

describe("resolveFlowPorts", () => {
  it("non_empty 同时显示蓝/绿端口", () => {
    const ports = resolveFlowPorts("non_empty", false);
    expect(ports.inputs).toEqual([{ id: "segment_in", kind: "segment" }]);
    expect(ports.outputs).toEqual([
      { id: "out", kind: "predicate" },
      { id: "next", kind: "segment" },
    ]);
  });

  it("count 段内模式仅显示 out/next 端口", () => {
    const ports = resolveFlowPorts("count", true);
    expect(ports.inputs).toEqual([{ id: "segment_in", kind: "segment" }]);
    expect(ports.outputs).toEqual([
      { id: "out", kind: "predicate" },
      { id: "next", kind: "segment" },
    ]);
  });

  it("count 整行模式仅显示 bool/predicate 端口", () => {
    const ports = resolveFlowPorts("count", false);
    expect(ports.inputs).toEqual([{ id: "predicate", kind: "predicate" }]);
    expect(ports.outputs).toEqual([{ id: "bool", kind: "bool" }]);
  });
});

describe("shouldUseSegmentPorts", () => {
  it("non_empty 设置为段内模式后启用段内语义", () => {
    resetRuleGraphIdCounter();
    const nonEmpty = createNode("non_empty", { x: 0, y: 0 }, { builderMode: "segment" });
    const graph = { version: 1 as const, nodes: [nonEmpty], edges: [] };
    expect(shouldUseSegmentPorts(graph, nonEmpty)).toBe(true);
  });

  it("默认模式不启用段内语义", () => {
    resetRuleGraphIdCounter();
    const nonEmpty = createNode("non_empty", { x: 0, y: 0 });
    const graph = { version: 1 as const, nodes: [nonEmpty], edges: [] };
    expect(shouldUseSegmentPorts(graph, nonEmpty)).toBe(false);
  });

  it("count 段内模式也启用段内语义", () => {
    resetRuleGraphIdCounter();
    const count = createNode("count", { x: 80, y: 0 }, { builderMode: "segment", mode: "at_least", n: 1 });
    const graph = { version: 1 as const, nodes: [count], edges: [] };
    expect(shouldUseSegmentPorts(graph, count)).toBe(true);
  });

  it("空格占位参与段链时显示段内角标", () => {
    resetRuleGraphIdCounter();
    const nonEmpty = createNode("non_empty", { x: -80, y: 0 }, { builderMode: "segment" });
    const space = createNode("space", { x: 0, y: 0 });
    const graph = {
      version: 1 as const,
      nodes: [nonEmpty, space],
      edges: [
        {
          id: "e1",
          source: nonEmpty.id,
          sourceHandle: "next",
          target: space.id,
          targetHandle: "segment_in",
        },
      ],
    };
    expect(shouldShowSegmentBadge(graph, space)).toBe(true);
  });
});
