import type { CompareResult } from "../../types/textCompare";
import type { RuleGraph } from "../../types/ruleGraph";
import { RuleGraphError } from "../../types/ruleGraph";
import { splitLines } from "../textCompare";
import { compileGraph } from "./compileGraph";
import { summarizeGraph } from "./summarizeGraph";
import { isGraphValid, validateGraph } from "./validateGraph";

export function compareWithRuleGraph(graph: RuleGraph, candidate: string): CompareResult {
  if (!isGraphValid(graph)) {
    const first = validateGraph(graph).find((i) => i.severity === "error");
    throw new RuleGraphError(first?.message ?? "规则图无效");
  }

  const evaluate = compileGraph(graph);
  const evalResult = evaluate({
    text: candidate,
    lines: splitLines(candidate),
  });

  const summaryText = summarizeGraph(graph);
  const missing = evalResult.failures.map((f) => ({
    kind: "missing" as const,
    text: f.lineNumber != null ? `第 ${f.lineNumber} 行：${f.text}` : f.text,
    lineNumber: f.lineNumber,
  }));

  const evaluated = evalResult.evaluatedCount ?? 0;
  const matched = evalResult.matchedCount ?? (evalResult.pass ? evaluated : 0);
  const matchRate =
    evaluated === 0 ? 0 : Math.round((matched / evaluated) * 100);

  return {
    match: evalResult.pass,
    matchRate: evalResult.pass ? 100 : matchRate,
    summary: evalResult.pass
      ? `规则满足：${summaryText}`
      : `${summaryText}；${evalResult.failures.length} 处未通过`,
    candidateLineCount: evaluated || undefined,
    matchedCount: matched,
    missingCount: missing.length,
    extraCount: 0,
    missing,
    extra: [],
  };
}

export { RuleGraphError };
