import { describe, expect, it } from "vitest";
import { compileToPython, compileToPythonSnippet } from "./compileToPython";
import { createFormatTemplateBlocksGraph } from "./formatTemplates";
import {
  createDefaultRuleGraph,
  createNode,
  createNumberedListRuleGraph,
  createPlaylistRuleGraph,
  createPlaylistSequenceRuleGraph,
  resetRuleGraphIdCounter,
} from "./defaultGraph";

describe("compileToPython", () => {
  it("默认模板：非空行", () => {
    const result = compileToPython(createDefaultRuleGraph());
    expect(result.error).toBeUndefined();
    expect(result.code).toContain("re.compile");
    expect(result.code).toContain("re.MULTILINE");
    expect(result.pattern).toMatch(/^\^/);
    expect(result.complete).toBe(true);
  });

  it("编号列表：数字开头 + 非空", () => {
    const result = compileToPython(createNumberedListRuleGraph());
    expect(result.code).toContain("re.MULTILINE");
    expect(result.pattern).toContain("\\d");
    expect(result.complete).toBe(true);
  });

  it("歌单段链模板：完整编译", () => {
    const graph = createPlaylistSequenceRuleGraph();
    const result = compileToPython(graph);
    expect(result.error).toBeUndefined();
    expect(result.pattern).toContain("[^-\\s]+ - [^-\\s]+");
    expect(result.code).toMatch(/re\.compile\(r"[^"]+", re\.IGNORECASE \| re\.MULTILINE\)/);
    expect(result.complete).toBe(true);
  });

  it("旧歌单模板含 split_parts：完整编译", () => {
    const result = compileToPython(createPlaylistRuleGraph());
    expect(result.error).toBeUndefined();
    expect(result.code).not.toBeNull();
    expect(result.pattern).toContain("[^-]+ - [^-]+");
    expect(result.complete).toBe(true);
  });

  it("孤立正则积木", () => {
    resetRuleGraphIdCounter();
    const scope = createNode("scope", { x: 0, y: 0 }, { mode: "line" });
    const regex = createNode("regex", { x: 0, y: 0 }, { pattern: "\\d{3}", ignoreCase: true });
    const root = createNode("root", { x: 0, y: 0 });
    const graph = {
      version: 1 as const,
      nodes: [regex, scope, root],
      edges: [
        {
          id: "e1",
          source: regex.id,
          sourceHandle: "out",
          target: scope.id,
          targetHandle: "predicate",
        },
        {
          id: "e2",
          source: scope.id,
          sourceHandle: "bool",
          target: root.id,
          targetHandle: "in",
        },
      ],
    };
    const result = compileToPython(graph);
    expect(result.code).toContain("re.compile");
    expect(result.pattern).toBe("^\\d{3}$");
    expect(result.code).toContain("re.IGNORECASE");
    expect(result.complete).toBe(true);
  });

  it("歌单段链含包含/不含条件", () => {
    const result = compileToPython(createPlaylistSequenceRuleGraph());
    expect(result.pattern).toContain("[^-\\s]+ - [^-\\s]+");
    expect(result.pattern).toContain("周杰伦");
    expect(result.pattern).toContain("Live");
  });

  it("或条件：完整编译", () => {
    resetRuleGraphIdCounter();
    const contains = createNode("contains", { x: 0, y: 0 }, { text: "@", ignoreCase: false });
    const startsWith = createNode(
      "starts_with",
      { x: 0, y: 80 },
      { preset: "text", text: "http", ignoreCase: true },
    );
    const or = createNode("or", { x: 120, y: 40 });
    const scope = createNode("scope", { x: 280, y: 40 }, { mode: "line" });
    const root = createNode("root", { x: 440, y: 40 });
    const graph = {
      version: 1 as const,
      nodes: [contains, startsWith, or, scope, root],
      edges: [
        { id: "e1", source: contains.id, sourceHandle: "out", target: or.id, targetHandle: "in" },
        { id: "e2", source: startsWith.id, sourceHandle: "out", target: or.id, targetHandle: "in" },
        { id: "e3", source: or.id, sourceHandle: "out", target: scope.id, targetHandle: "predicate" },
        { id: "e4", source: scope.id, sourceHandle: "bool", target: root.id, targetHandle: "in" },
      ],
    };
    const result = compileToPython(graph);
    expect(result.complete).toBe(true);
    expect(result.pattern).toContain("|");
    expect(result.pattern).toContain("@");
    expect(result.pattern).toContain("http");
  });

  it("非条件：否定编译", () => {
    resetRuleGraphIdCounter();
    const contains = createNode("contains", { x: 0, y: 0 }, { text: "spam", ignoreCase: false });
    const not = createNode("not", { x: 120, y: 0 });
    const scope = createNode("scope", { x: 280, y: 0 }, { mode: "line" });
    const root = createNode("root", { x: 440, y: 0 });
    const graph = {
      version: 1 as const,
      nodes: [contains, not, scope, root],
      edges: [
        { id: "e1", source: contains.id, sourceHandle: "out", target: not.id, targetHandle: "in" },
        { id: "e2", source: not.id, sourceHandle: "out", target: scope.id, targetHandle: "predicate" },
        { id: "e3", source: scope.id, sourceHandle: "bool", target: root.id, targetHandle: "in" },
      ],
    };
    const result = compileToPython(graph);
    expect(result.complete).toBe(true);
    expect(result.pattern).toContain("(?!");
    expect(result.pattern).toContain("spam");
  });

  it("B 类匹配次数：导出辅助脚本", () => {
    resetRuleGraphIdCounter();
    const regex = createNode("regex", { x: 0, y: 0 }, { pattern: "\\d+", ignoreCase: false });
    const count = createNode("count", { x: 200, y: 0 }, { mode: "at_least", n: 2 });
    const root = createNode("root", { x: 400, y: 0 });
    const graph = {
      version: 1 as const,
      nodes: [regex, count, root],
      edges: [
        { id: "e1", source: regex.id, sourceHandle: "out", target: count.id, targetHandle: "predicate" },
        { id: "e2", source: count.id, sourceHandle: "bool", target: root.id, targetHandle: "in" },
      ],
    };
    const snippet = compileToPythonSnippet(graph);
    expect(snippet?.snippet).toContain("LINE_PATTERN");
    expect(snippet?.snippet).toContain("match_document");
    expect(snippet?.complete).toBe(true);

    const result = compileToPython(graph);
    expect(result.exportKind).toBe("document");
    expect(result.snippet).toContain("matched >= 2");
  });

  it("split_pattern：邮箱拆段", () => {
    resetRuleGraphIdCounter();
    const split = createNode("split_pattern", { x: 0, y: 0 }, { separator: "@", parts: 2 });
    const scope = createNode("scope", { x: 200, y: 0 }, { mode: "line" });
    const root = createNode("root", { x: 360, y: 0 });
    const graph = {
      version: 1 as const,
      nodes: [split, scope, root],
      edges: [
        { id: "e1", source: split.id, sourceHandle: "out", target: scope.id, targetHandle: "predicate" },
        { id: "e2", source: scope.id, sourceHandle: "bool", target: root.id, targetHandle: "in" },
      ],
    };
    const result = compileToPython(graph);
    expect(result.complete).toBe(true);
    expect(result.pattern).toContain("@");
  });

  it("段链新积木：手机号模式可导出", () => {
    const result = compileToPython(createFormatTemplateBlocksGraph("phone_cn"));
    expect(result.complete).toBe(true);
    expect(result.pattern).toBe("^1[3-9]\\d{9}$");
  });
});
