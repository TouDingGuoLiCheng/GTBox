import { describe, expect, it } from "vitest";
import { compileGraph, evaluateGraph } from "./compileGraph";
import { compileSegmentChainPattern, compileSegmentChainRegExp } from "./compileSequence";
import {
  createDefaultRuleGraph,
  createNode,
  createNumberedListRuleGraph,
  createPlaylistRuleGraph,
  createPlaylistSequenceRuleGraph,
  resetRuleGraphIdCounter,
} from "./defaultGraph";
import { collectSegmentChainEndingAt } from "./segmentChain";

describe("compileSegmentChainPattern", () => {
  it("非空+量词+空格+字面量 编译为 [^\\s]+ - [^\\s]+", () => {
    resetRuleGraphIdCounter();
    const a = createNode("non_empty", { x: 0, y: 0 });
    const b = createNode("count", { x: 0, y: 0 }, { mode: "at_least", n: 1 });
    const c = createNode("space", { x: 0, y: 0 });
    const d = createNode("matches_text", { x: 0, y: 0 }, { text: "-" });
    const { pattern } = compileSegmentChainPattern([a, b, c, d]);
    expect(pattern).toBe("[^-\\s]+ -");
  });

  it("孤立段量词报错", () => {
    resetRuleGraphIdCounter();
    const count = createNode("count", { x: 0, y: 0 }, { mode: "at_least", n: 1 });
    expect(() => compileSegmentChainPattern([count])).toThrow(/紧跟在非空段之后/);
  });

  it("空格占位恰好 N 个编译为 {N}", () => {
    resetRuleGraphIdCounter();
    const space = createNode("space", { x: 0, y: 0 }, { mode: "exactly", n: 2 });
    const { pattern } = compileSegmentChainPattern([space]);
    expect(pattern).toBe(" {2}");
  });

  it("空格占位至少 N 个编译为 {N,}", () => {
    resetRuleGraphIdCounter();
    const space = createNode("space", { x: 0, y: 0 }, { mode: "at_least", n: 2 });
    const { pattern } = compileSegmentChainPattern([space]);
    expect(pattern).toBe(" {2,}");
  });

  it("无参数的空格占位默认恰好 1 个", () => {
    resetRuleGraphIdCounter();
    const space = createNode("space", { x: 0, y: 0 });
    const { pattern } = compileSegmentChainPattern([space]);
    expect(pattern).toBe(" ");
  });

  it("连续字符：9 个数字", () => {
    resetRuleGraphIdCounter();
    const run = createNode("char_run", { x: 0, y: 0 }, { kind: "digit", n: 9 });
    const { pattern } = compileSegmentChainPattern([run]);
    expect(pattern).toBe("\\d{9}");
  });

  it("字符类段：自定义 [3-9]", () => {
    resetRuleGraphIdCounter();
    const cls = createNode(
      "char_class_seg",
      { x: 0, y: 0 },
      { preset: "custom", customClass: "3-9", quantifier: "one" },
    );
    const { pattern } = compileSegmentChainPattern([cls]);
    expect(pattern).toBe("[3-9]");
  });

  it("可选段：包装下一段", () => {
    resetRuleGraphIdCounter();
    const opt = createNode("optional_seg", { x: 0, y: 0 });
    const dash = createNode("matches_text", { x: 80, y: 0 }, { text: "-" });
    const { pattern } = compileSegmentChainPattern([opt, dash]);
    expect(pattern).toBe("(?:-)?");
  });

  it("position_char：范围 [3-9]", () => {
    resetRuleGraphIdCounter();
    const pos = createNode(
      "position_char",
      { x: 0, y: 0 },
      { mode: "range", literal: "", rangeFrom: "3", rangeTo: "9" },
    );
    const { pattern } = compileSegmentChainPattern([pos]);
    expect(pattern).toBe("[3-9]");
  });

  it("手机号段链：1 + [3-9] + 9 位数字", () => {
    resetRuleGraphIdCounter();
    const one = createNode("matches_text", { x: 0, y: 0 }, { text: "1" });
    const second = createNode(
      "char_class_seg",
      { x: 80, y: 0 },
      { preset: "custom", customClass: "3-9", quantifier: "one" },
    );
    const rest = createNode("char_run", { x: 160, y: 0 }, { kind: "digit", n: 9 });
    const { pattern } = compileSegmentChainPattern([one, second, rest]);
    expect(pattern).toBe("1[3-9]\\d{9}");
    const re = compileSegmentChainRegExp([one, second, rest]);
    expect(re.test("13812345678")).toBe(true);
    expect(re.test("12812345678")).toBe(false);
  });
});

describe("歌单顺序模板 §3.5", () => {
  const graph = createPlaylistSequenceRuleGraph();
  const tail = graph.nodes.find((n) =>
    graph.edges.some((e) => e.source === n.id && e.sourceHandle === "out"),
  )!;
  const chain = collectSegmentChainEndingAt(graph, tail.id)!;

  it("段链编译等价于 ^[^-\\s]+ - [^-\\s]+$", () => {
    const { pattern } = compileSegmentChainPattern(chain);
    expect(pattern).toBe("[^-\\s]+ - [^-\\s]+");
    const re = compileSegmentChainRegExp(chain);
    expect(re.source).toBe("^[^-\\s]+ - [^-\\s]+$");
  });

  it.each([
    ["晴天 - 周杰伦", true],
    ["七里香 - 周杰伦", true],
    ["晴天-周杰伦", false],
    ["晴天 - Live周杰伦", false],
    ["晴天 - 周杰伦-Liv", false],
    [" - ", false],
    ["A - B - C", false],
  ])("试跑「%s」→ %s", (line, expected) => {
    const result = evaluateGraph(graph, { text: line, lines: [line] });
    expect(result.pass).toBe(expected);
  });
});

describe("链外语义回归", () => {
  it("默认模板：非空整行语义不变", () => {
    const graph = createDefaultRuleGraph();
    const pass = evaluateGraph(graph, { text: "hello\n", lines: ["hello", ""] });
    expect(pass.pass).toBe(false);
    const ok = evaluateGraph(graph, { text: "a\nb", lines: ["a", "b"] });
    expect(ok.pass).toBe(true);
  });

  it("编号列表模板仍可用", () => {
    const graph = createNumberedListRuleGraph();
    const ok = evaluateGraph(graph, { text: "1. item\n2. item", lines: ["1. item", "2. item"] });
    expect(ok.pass).toBe(true);
  });

  it("旧歌单模板仍可用", () => {
    const graph = createPlaylistRuleGraph();
    const ok = evaluateGraph(graph, {
      text: "晴天 - 周杰伦",
      lines: ["晴天 - 周杰伦"],
    });
    expect(ok.pass).toBe(true);
    const bad = evaluateGraph(graph, {
      text: "晴天 - 周杰伦-Liv",
      lines: ["晴天 - 周杰伦-Liv"],
    });
    expect(bad.pass).toBe(false);
  });

  it("compileGraph 对顺序节点输出 predicate", () => {
    resetRuleGraphIdCounter();
    const a = createNode("non_empty", { x: 0, y: 0 });
    const b = createNode("space", { x: 80, y: 0 });
    const sequence = createNode("sequence", { x: 160, y: 0 });
    const scope = createNode("scope", { x: 240, y: 0 }, { mode: "line" });
    const root = createNode("root", { x: 320, y: 0 });
    const legacy = {
      version: 1 as const,
      nodes: [a, b, sequence, scope, root],
      edges: [
        { id: "e1", source: a.id, sourceHandle: "next", target: b.id, targetHandle: "segment_in" },
        { id: "e2", source: b.id, sourceHandle: "next", target: sequence.id, targetHandle: "segment_in" },
        { id: "e3", source: sequence.id, sourceHandle: "predicate_out", target: scope.id, targetHandle: "predicate" },
        { id: "e4", source: scope.id, sourceHandle: "bool", target: root.id, targetHandle: "in" },
      ],
    };
    const fn = compileGraph(legacy);
    expect(fn({ text: "x ", lines: ["x "] }).pass).toBe(true);
  });
});
