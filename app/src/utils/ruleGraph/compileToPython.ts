import type {
  CountMode,
  CountParams,
  RuleGraph,
  RuleNode,
  ScopeMode,
  ScopeParams,
} from "../../types/ruleGraph";
import { RuleGraphError } from "../../types/ruleGraph";
import { compileSegmentChainPattern } from "./compileSequence";
import {
  compileLeafFragment,
  mergeFragments,
  mergeOrFragments,
  negateFragment,
  type RegexFragment,
} from "./compileFragment";
import { getNodeDef } from "./nodeDefs";
import {
  collectSegmentChainEndingAt,
  collectSegmentChainOrder,
  getNodeBuilderMode,
  isSegmentChainTailNode,
} from "./segmentChain";
import { isGraphValid, validateGraph } from "./validateGraph";

export interface PythonCompileResult {
  code: string | null;
  pattern: string | null;
  flags: ("IGNORECASE" | "MULTILINE" | "DOTALL")[];
  complete: boolean;
  warning?: string;
  error?: string;
  /** B 类文档级：子正则 + 辅助脚本 */
  snippet?: string | null;
  exportKind?: "line" | "document";
}

function nodeMap(graph: RuleGraph): Map<string, RuleNode> {
  return new Map(graph.nodes.map((n) => [n.id, n]));
}

function incomingSources(graph: RuleGraph, nodeId: string, handleId: string): string[] {
  return graph.edges
    .filter((e) => e.target === nodeId && e.targetHandle === handleId)
    .map((e) => e.source);
}

function escapeForPythonRawString(pattern: string): string {
  if (!pattern.includes('"') && !/(?:^|[^\\])\\$/.test(pattern)) {
    return `r"${pattern}"`;
  }
  const escaped = pattern.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function compilePredicateNode(nodeId: string, graph: RuleGraph, stack: Set<string>): RegexFragment {
  const map = nodeMap(graph);
  const node = map.get(nodeId);
  if (!node) throw new RuleGraphError(`找不到节点 ${nodeId}`);
  if (stack.has(nodeId)) throw new RuleGraphError("规则图存在环路");
  stack.add(nodeId);

  const def = getNodeDef(node.type);

  if (isSegmentChainTailNode(node)) {
    const chain = collectSegmentChainEndingAt(graph, node.id);
    if (!chain?.length) throw new RuleGraphError("段链无效或为空");
    const { pattern, ignoreCase } = compileSegmentChainPattern(chain);
    stack.delete(nodeId);
    return { lookaheads: [], body: pattern, ignoreCase, complete: true };
  }

  if (def.category === "constraint") {
    const leaf = compileLeafFragment(node);
    if (!leaf) {
      throw new RuleGraphError(`节点「${def.label}」无法编译为 Python 正则`);
    }
    stack.delete(nodeId);
    return leaf;
  }

  switch (node.type) {
    case "and": {
      const sources = incomingSources(graph, nodeId, "in");
      if (sources.length === 0) {
        stack.delete(nodeId);
        return { lookaheads: [], body: ".*", ignoreCase: false, complete: false, warning: "且条件为空" };
      }
      const parts = sources.map((id) => compilePredicateNode(id, graph, new Set(stack)));
      stack.delete(nodeId);
      return mergeFragments(parts);
    }
    case "or": {
      const sources = incomingSources(graph, nodeId, "in");
      stack.delete(nodeId);
      if (sources.length === 0) {
        return {
          lookaheads: [],
          body: "",
          ignoreCase: false,
          complete: false,
          warning: "或条件为空",
        };
      }
      try {
        const parts = sources.map((id) => compilePredicateNode(id, graph, new Set(stack)));
        return mergeOrFragments(parts);
      } catch {
        return {
          lookaheads: [],
          body: "",
          ignoreCase: false,
          complete: false,
          warning: "含「或」条件，无法导出为单一正则",
        };
      }
    }
    case "not": {
      const sources = incomingSources(graph, nodeId, "in");
      if (!sources[0]) {
        stack.delete(nodeId);
        return { lookaheads: [], body: ".*", ignoreCase: false, complete: false, warning: "非条件为空" };
      }
      const inner = compilePredicateNode(sources[0], graph, new Set(stack));
      stack.delete(nodeId);
      return negateFragment(inner);
    }
    case "group": {
      const sources = incomingSources(graph, nodeId, "in");
      if (!sources[0]) {
        stack.delete(nodeId);
        return { lookaheads: [], body: "", ignoreCase: false, complete: false, warning: "分组内无条件" };
      }
      const inner = compilePredicateNode(sources[0], graph, new Set(stack));
      stack.delete(nodeId);
      return inner;
    }
    case "sequence": {
      const chain = collectSegmentChainOrder(graph, nodeId);
      if (!chain?.length) throw new RuleGraphError("顺序节点段链无效或为空");
      const { pattern, ignoreCase } = compileSegmentChainPattern(chain);
      stack.delete(nodeId);
      return { lookaheads: [], body: pattern, ignoreCase, complete: true };
    }
    case "count": {
      stack.delete(nodeId);
      return {
        lookaheads: [],
        body: "",
        ignoreCase: false,
        complete: false,
        warning: "行级「匹配次数」无法完整编译为单一正则",
      };
    }
    default:
      stack.delete(nodeId);
      throw new RuleGraphError(`节点「${def.label}」不能编译为 Python 正则`);
  }
}

export function assemblePattern(fragment: RegexFragment, scopeMode?: ScopeMode): string {
  const anchored = scopeMode !== "full";
  const core = `${fragment.lookaheads.join("")}${fragment.body || ".*"}`;
  if (!anchored) return core;
  return `^${core}$`;
}

function scopeFlags(mode: ScopeMode): PythonCompileResult["flags"] {
  if (mode === "full") return [];
  return ["MULTILINE"];
}

function formatPythonCode(pattern: string, flags: PythonCompileResult["flags"]): string {
  const raw = escapeForPythonRawString(pattern);
  if (flags.length === 0) {
    return `import re\n\npattern = re.compile(${raw})`;
  }
  const flagExpr = flags.map((f) => `re.${f}`).join(" | ");
  return `import re\n\npattern = re.compile(${raw}, ${flagExpr})`;
}

function countCheckExpression(mode: CountMode, n: number): string {
  switch (mode) {
    case "all":
      return "matched == total";
    case "at_least":
      return `matched >= ${n}`;
    case "at_most":
      return `matched <= ${n}`;
    case "exactly":
      return `matched == ${n}`;
    case "global":
      return `matched >= ${n}`;
  }
}

function countModeLabel(mode: CountMode, n: number): string {
  switch (mode) {
    case "all":
      return "全部行匹配";
    case "at_least":
      return `至少 ${n} 行匹配`;
    case "at_most":
      return `至多 ${n} 行匹配`;
    case "exactly":
      return `恰好 ${n} 行匹配`;
    case "global":
      return `全文至少匹配 ${n} 次`;
  }
}

function resolveScopePredicate(
  graph: RuleGraph,
  predicateId: string,
): { scopeMode: ScopeMode; predicateId: string } {
  const node = nodeMap(graph).get(predicateId);
  if (node?.type === "scope") {
    const scopeMode = (node.params as ScopeParams).mode;
    const inner = incomingSources(graph, node.id, "predicate");
    if (!inner[0]) throw new RuleGraphError("作用范围未连接约束条件");
    return { scopeMode, predicateId: inner[0] };
  }
  return { scopeMode: "line", predicateId };
}

export function compileToPythonSnippet(graph: RuleGraph): PythonCompileResult | null {
  const root = graph.nodes.find((n) => n.type === "root");
  if (!root) return null;

  const countSources = incomingSources(graph, root.id, "in");
  const countNode = countSources[0] ? nodeMap(graph).get(countSources[0]) : undefined;
  if (countNode?.type !== "count") return null;
  if (getNodeBuilderMode(countNode) === "segment") return null;

  const countParams = countNode.params as CountParams;
  const predSources = incomingSources(graph, countNode.id, "predicate");
  if (!predSources[0]) return null;

  try {
    const { scopeMode, predicateId } = resolveScopePredicate(graph, predSources[0]);
    const assembly = compilePredicateNode(predicateId, graph, new Set());
    if (!assembly.complete) return null;

    const linePattern = assemblePattern(assembly, scopeMode);
    const flags: PythonCompileResult["flags"] = [...scopeFlags(scopeMode)];
    if (assembly.ignoreCase) flags.unshift("IGNORECASE");

    const raw = escapeForPythonRawString(linePattern);
    const flagExpr = flags.length ? flags.map((f) => `re.${f}`).join(" | ") : "";
    const compileLine = flagExpr
      ? `LINE_PATTERN = re.compile(${raw}, ${flagExpr})`
      : `LINE_PATTERN = re.compile(${raw})`;

    const check = countCheckExpression(countParams.mode, countParams.n);
    const skipEmpty = scopeMode === "non_empty_line";

    const snippet = `import re

${compileLine}

def match_document(text: str) -> bool:
    lines = [ln for ln in text.splitlines() if ln.strip() or not ${skipEmpty}]
    total = len(lines)
    matched = sum(1 for ln in lines if LINE_PATTERN.search(ln))
    return ${check}
`;

    return {
      code: null,
      pattern: linePattern,
      flags,
      complete: true,
      snippet,
      exportKind: "document",
      warning: `文档级规则：${countModeLabel(countParams.mode, countParams.n)}`,
    };
  } catch {
    return null;
  }
}

function boolPathHasCount(graph: RuleGraph, rootId: string): boolean {
  const sources = incomingSources(graph, rootId, "in");
  if (!sources[0]) return false;
  const node = nodeMap(graph).get(sources[0]);
  return node?.type === "count";
}

export function compileToPython(graph: RuleGraph): PythonCompileResult {
  if (!isGraphValid(graph)) {
    const issue = validateGraph(graph).find((i) => i.severity === "error");
    return {
      code: null,
      pattern: null,
      flags: [],
      complete: false,
      error: issue?.message ?? "规则图无效",
    };
  }

  const root = graph.nodes.find((n) => n.type === "root");
  if (!root) {
    return { code: null, pattern: null, flags: [], complete: false, error: "规则图缺少输出节点" };
  }

  if (boolPathHasCount(graph, root.id)) {
    const snippetResult = compileToPythonSnippet(graph);
    if (snippetResult?.snippet) {
      return snippetResult;
    }
    return {
      code: null,
      pattern: null,
      flags: [],
      complete: false,
      error: "输出链含「匹配次数」且无法导出辅助脚本",
    };
  }

  const scope = graph.nodes.find((n) => n.type === "scope");
  if (!scope) {
    return { code: null, pattern: null, flags: [], complete: false, error: "缺少「作用范围」节点" };
  }

  const scopeMode = (scope.params as ScopeParams).mode;
  const predSources = incomingSources(graph, scope.id, "predicate");
  if (predSources.length === 0) {
    return { code: null, pattern: null, flags: [], complete: false, error: "作用范围未连接约束条件" };
  }

  try {
    const assembly = compilePredicateNode(predSources[0], graph, new Set());
    const pattern = assemblePattern(assembly, scopeMode);
    const flags: PythonCompileResult["flags"] = [...scopeFlags(scopeMode)];
    if (assembly.ignoreCase) flags.unshift("IGNORECASE");

    const code = formatPythonCode(pattern, flags);
    const warnings: string[] = [];
    if (assembly.warning) warnings.push(assembly.warning);

    return {
      code,
      pattern,
      flags,
      complete: assembly.complete,
      exportKind: "line",
      warning: warnings.length ? warnings.join("；") : undefined,
    };
  } catch (err) {
    const msg = err instanceof RuleGraphError ? err.message : err instanceof Error ? err.message : String(err);
    return { code: null, pattern: null, flags: [], complete: false, error: msg };
  }
}
