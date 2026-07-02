import type { GraphValidationIssue, RuleGraph } from "../../types/ruleGraph";
import { RuleGraphError } from "../../types/ruleGraph";
import { compileGraph, compileGraphPredicate } from "./compileGraph";
import { compileToPython } from "./compileToPython";
import { validateGraph } from "./validateGraph";

export function validateGraphForBuilder(graph: RuleGraph): GraphValidationIssue[] {
  const issues = validateGraph(graph);
  if (issues.some((i) => i.severity === "error")) {
    return issues;
  }

  const py = compileToPython(graph);
  if (py.error) {
    issues.push({
      severity: "error",
      code: "export_failed",
      message: py.error,
    });
    return issues;
  }

  const hasUsableExport = py.complete && !!(py.code || py.snippet);
  if (!hasUsableExport) {
    issues.push({
      severity: "error",
      code: "export_incomplete",
      message: py.warning ?? "规则图无法完整导出为 Python 正则或辅助脚本",
    });
    return issues;
  }

  if (py.warning) {
    issues.push({
      severity: "warning",
      code: "export_document",
      message: py.warning,
    });
  }

  try {
    compileGraph(graph);
    if (graph.nodes.some((n) => n.type === "scope")) {
      compileGraphPredicate(graph);
    }
  } catch (err) {
    issues.push({
      severity: "error",
      code: "trial_run_mismatch",
      message: err instanceof RuleGraphError ? err.message : "试跑编译失败，与导出结果不一致",
    });
  }

  return issues;
}

export function isGraphExportable(graph: RuleGraph): boolean {
  return !validateGraphForBuilder(graph).some((i) => i.severity === "error");
}
