import { describe, expect, it } from "vitest";
import type { RuleGraph } from "../../types/ruleGraph";
import g01 from "../../../../regex-test-data/01-default-non-empty-line.json";
import { createDefaultRuleGraph, createNode, resetRuleGraphIdCounter } from "./defaultGraph";
import { compileToPython } from "./compileToPython";
import { isGraphExportable, validateGraphForBuilder } from "./validateGraphForBuilder";

describe("validateGraphForBuilder", () => {
  it("regex-test-data 默认图可导出且试跑一致", () => {
    const issues = validateGraphForBuilder(g01 as RuleGraph);
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
    expect(isGraphExportable(g01 as RuleGraph)).toBe(true);
  });

  it("默认模板通过导出可行性校验", () => {
    expect(isGraphExportable(createDefaultRuleGraph())).toBe(true);
  });

  it("结构无效时沿用 validateGraph 错误", () => {
    resetRuleGraphIdCounter();
    const root = createNode("root", { x: 0, y: 0 });
    const graph: RuleGraph = { version: 1, nodes: [root], edges: [] };
    const codes = validateGraphForBuilder(graph).map((i) => i.code);
    expect(codes).toContain("root_unconnected");
  });

  it("行级匹配次数：能试跑但无法完整导出", () => {
    resetRuleGraphIdCounter();
    const regex = createNode("regex", { x: 0, y: 0 }, { pattern: "\\d+", ignoreCase: false });
    const count = createNode("count", { x: 200, y: 0 }, { mode: "at_least", n: 2 });
    const scope = createNode("scope", { x: 400, y: 0 }, { mode: "line" });
    const root = createNode("root", { x: 560, y: 0 });
    const graph: RuleGraph = {
      version: 1,
      nodes: [regex, count, scope, root],
      edges: [
        { id: "e1", source: regex.id, sourceHandle: "out", target: count.id, targetHandle: "predicate" },
        { id: "e2", source: count.id, sourceHandle: "out", target: scope.id, targetHandle: "predicate" },
        { id: "e3", source: scope.id, sourceHandle: "bool", target: root.id, targetHandle: "in" },
      ],
    };
    const py = compileToPython(graph);
    expect(py.complete).toBe(false);

    const issue = validateGraphForBuilder(graph).find((i) => i.code === "export_incomplete");
    expect(issue?.severity).toBe("error");
    expect(isGraphExportable(graph)).toBe(false);
  });

  it("B 类文档级计数：导出辅助脚本并通过校验", () => {
    resetRuleGraphIdCounter();
    const regex = createNode("regex", { x: 0, y: 0 }, { pattern: "\\d+", ignoreCase: false });
    const count = createNode("count", { x: 200, y: 0 }, { mode: "at_least", n: 2 });
    const root = createNode("root", { x: 400, y: 0 });
    const graph: RuleGraph = {
      version: 1,
      nodes: [regex, count, root],
      edges: [
        { id: "e1", source: regex.id, sourceHandle: "out", target: count.id, targetHandle: "predicate" },
        { id: "e2", source: count.id, sourceHandle: "bool", target: root.id, targetHandle: "in" },
      ],
    };
    const issues = validateGraphForBuilder(graph);
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
    expect(issues.some((i) => i.code === "export_document")).toBe(true);
    expect(isGraphExportable(graph)).toBe(true);
  });
});
