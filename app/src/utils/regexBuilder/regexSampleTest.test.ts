import { describe, expect, it } from "vitest";
import { createDefaultRuleGraph } from "../ruleGraph/defaultGraph";
import {
  buildHighlightedParts,
  MAX_LINE_SAMPLE,
  testSampleBlock,
  testSampleLines,
} from "./regexSampleTest";

describe("regexSampleTest", () => {
  it("单段模式：找出所有行内匹配", () => {
    const graph = createDefaultRuleGraph();
    const sample = "hello\n\nworld";
    const result = testSampleBlock(graph, sample);
    expect(result.error).toBeUndefined();
    expect(result.matches.length).toBeGreaterThanOrEqual(2);
  });

  it("按行模式：统计命中行", () => {
    const graph = createDefaultRuleGraph();
    const result = testSampleLines(graph, "a\n\nb");
    expect(result.total).toBe(3);
    expect(result.passCount).toBe(2);
    expect(result.rows).toHaveLength(3);
  });

  it("空样本返回提示", () => {
    const graph = createDefaultRuleGraph();
    expect(testSampleBlock(graph, "").error).toBe("请输入样本文本");
    expect(testSampleLines(graph, "  ").error).toBe("请输入样本文本");
  });

  it("按行模式：超过行数上限", () => {
    const graph = createDefaultRuleGraph();
    const sample = Array.from({ length: MAX_LINE_SAMPLE + 1 }, (_, i) => `line${i}`).join("\n");
    const result = testSampleLines(graph, sample);
    expect(result.error).toContain(String(MAX_LINE_SAMPLE));
    expect(result.rows).toHaveLength(0);
  });

  it("buildHighlightedParts 不重叠", () => {
    const parts = buildHighlightedParts("abcdef", [
      { start: 1, end: 3, text: "bc", groups: [] },
      { start: 4, end: 6, text: "ef", groups: [] },
    ]);
    expect(parts.map((p) => p.text).join("")).toBe("abcdef");
    expect(parts.filter((p) => p.highlight)).toHaveLength(2);
  });
});
