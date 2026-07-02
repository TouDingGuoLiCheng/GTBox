import type { ScopeParams } from "../../types/ruleGraph";
import type { RuleGraph } from "../../types/ruleGraph";
import { splitLines } from "../textCompare";
import { compileGraph, compileGraphPredicate } from "./compileGraph";
import { isGraphValid, validateGraph } from "./validateGraph";

export interface RulePreviewRow {
  lineNumber?: number;
  text: string;
  pass: boolean;
  reason?: string;
}

export function previewRuleGraph(
  graph: RuleGraph,
  candidate: string,
  maxRows = 5,
): { rows: RulePreviewRow[]; error?: string } {
  if (!candidate.trim()) {
    return { rows: [], error: "待比对项为空，无法试跑" };
  }
  if (!isGraphValid(graph)) {
    const issue = validateGraph(graph).find((i) => i.severity === "error");
    return { rows: [], error: issue?.message ?? "规则图无效" };
  }

  try {
    const lines = splitLines(candidate);
    const scopeNode = graph.nodes.find((n) => n.type === "scope");
    const scopeMode = scopeNode
      ? (scopeNode.params as ScopeParams).mode
      : "line";

    if (scopeMode === "full") {
      const evaluate = compileGraph(graph);
      const r = evaluate({ text: candidate, lines });
      return {
        rows: [
          {
            text: candidate.length > 120 ? `${candidate.slice(0, 120)}…` : candidate,
            pass: r.pass,
            reason: r.pass ? undefined : r.failures[0]?.reason,
          },
        ],
      };
    }

    const predicate = compileGraphPredicate(graph);
    const units = lines
      .map((text, i) => ({ text, lineNumber: i + 1 }))
      .filter((l) => (scopeMode === "non_empty_line" ? l.text.trim() !== "" : true))
      .slice(0, maxRows);

    if (units.length === 0) {
      return { rows: [], error: "待比对项无有效行" };
    }

    const rows: RulePreviewRow[] = units.map((unit) => {
      const r = predicate(unit.text);
      return {
        lineNumber: unit.lineNumber,
        text: unit.text,
        pass: r.pass,
        reason: r.pass ? undefined : r.failures[0]?.reason,
      };
    });
    return { rows };
  } catch (err) {
    return {
      rows: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
