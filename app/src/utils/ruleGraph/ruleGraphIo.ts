import type { RuleGraph } from "../../types/ruleGraph";
import { isGraphValid, validateGraph } from "./validateGraph";

export function isRuleGraph(value: unknown): value is RuleGraph {
  if (!value || typeof value !== "object") return false;
  const g = value as RuleGraph;
  return g.version === 1 && Array.isArray(g.nodes) && Array.isArray(g.edges);
}

export function parseRuleGraphJson(raw: string): RuleGraph {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("JSON 格式无效");
  }
  if (!isRuleGraph(parsed)) {
    throw new Error("不是有效的规则图文件（需要 version: 1、nodes、edges）");
  }
  const issues = validateGraph(parsed).filter((i) => i.severity === "error");
  if (issues.length > 0) {
    throw new Error(issues[0].message);
  }
  return parsed;
}

export function serializeRuleGraph(graph: RuleGraph): string {
  if (!isGraphValid(graph)) {
    const issue = validateGraph(graph).find((i) => i.severity === "error");
    throw new Error(issue?.message ?? "当前规则图无效，无法导出");
  }
  return JSON.stringify(graph, null, 2);
}
