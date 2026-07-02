import type {
  CharClassSegParams,
  CharRunParams,
  CountParams,
  PositionCharParams,
  RuleGraph,
  RuleNode,
  ScopeParams,
  SpaceParams,
  TextParams,
} from "../../types/ruleGraph";
import { getNodeDef } from "./nodeDefs";
import { collectSegmentChainEndingAt, collectSegmentChainOrder, getNodeBuilderMode, isSegmentChainTailNode } from "./segmentChain";

function nodeMap(graph: RuleGraph): Map<string, RuleNode> {
  return new Map(graph.nodes.map((n) => [n.id, n]));
}

function incomingSources(graph: RuleGraph, nodeId: string, handleId: string): string[] {
  return graph.edges
    .filter((e) => e.target === nodeId && e.targetHandle === handleId)
    .map((e) => e.source);
}

function scopeLabel(mode: ScopeParams["mode"]): string {
  switch (mode) {
    case "full":
      return "全文";
    case "line":
      return "每一行";
    case "non_empty_line":
      return "每一非空行";
  }
}

function countModeLabel(mode: CountParams["mode"], n: number): string {
  switch (mode) {
    case "at_least":
      return n <= 1 ? "+" : `≥${n}`;
    case "at_most":
      return `≤${n}`;
    case "exactly":
      return `=${n}`;
    case "all":
      return "全部";
    case "global":
      return `全文≥${n}`;
  }
}

function charRunLabel(params: CharRunParams): string {
  const kind =
    params.kind === "digit"
      ? "数字"
      : params.kind === "letter"
        ? "字母"
        : params.kind === "word"
          ? "单词字符"
          : "任意字符";
  return `${params.n}个${kind}`;
}

function charClassLabel(params: CharClassSegParams): string {
  const preset =
    params.preset === "digit"
      ? "数字"
      : params.preset === "letter"
        ? "字母"
        : params.preset === "alnum"
          ? "字母数字"
          : `[${params.customClass}]`;
  return params.quantifier === "one_or_more" ? `${preset}+` : `${preset}`;
}

function describeSegmentNode(node: RuleNode, next?: RuleNode): string {
  switch (node.type) {
    case "non_empty": {
      if (next?.type === "count") {
        const p = next.params as CountParams;
        return `非空${countModeLabel(p.mode, p.n)}`;
      }
      return "非空+";
    }
    case "count":
      return countModeLabel((node.params as CountParams).mode, (node.params as CountParams).n);
    case "space": {
      const p = node.params as Partial<SpaceParams>;
      const mode = p.mode ?? "exactly";
      const n = typeof p.n === "number" ? p.n : 1;
      return mode === "exactly" && n === 1 ? "空格" : `空格${countModeLabel(mode, n)}`;
    }
    case "matches_text": {
      const text = (node.params as TextParams).text ?? "";
      return `「${text}」`;
    }
    case "char_run":
      return charRunLabel(node.params as CharRunParams);
    case "char_class_seg":
      return charClassLabel(node.params as CharClassSegParams);
    case "position_char": {
      const p = node.params as PositionCharParams;
      if (p.mode === "literal") return `固定位「${p.literal}」`;
      return `固定位[${p.rangeFrom}-${p.rangeTo}]`;
    }
    case "optional_seg":
      return "可选";
    default:
      return getNodeDef(node.type).label;
  }
}

function describeSegmentChain(graph: RuleGraph, sequenceId: string): string {
  const chain = collectSegmentChainOrder(graph, sequenceId);
  if (!chain || chain.length === 0) return "（空段链）";

  const parts: string[] = [];
  for (let i = 0; i < chain.length; i++) {
    const node = chain[i]!;
    if (node.type === "count" || node.type === "optional_seg") continue;
    let part = describeSegmentNode(node, chain[i + 1]);
    if (chain[i - 1]?.type === "optional_seg") part = `（可选 ${part}）`;
    parts.push(part);
  }
  return parts.join(" → ");
}

function describeSegmentTailChain(graph: RuleGraph, tailNodeId: string): string {
  const chain = collectSegmentChainEndingAt(graph, tailNodeId);
  if (!chain || chain.length === 0) return "（空段链）";
  const parts: string[] = [];
  for (let i = 0; i < chain.length; i++) {
    const node = chain[i]!;
    if (node.type === "count" || node.type === "optional_seg") continue;
    let part = describeSegmentNode(node, chain[i + 1]);
    if (chain[i - 1]?.type === "optional_seg") part = `（可选 ${part}）`;
    parts.push(part);
  }
  return parts.join(" → ");
}

function describeConstraint(node: RuleNode): string {
  const def = getNodeDef(node.type);
  switch (node.type) {
    case "non_empty":
      return "非空";
    case "contains": {
      const text = (node.params as { text?: string }).text ?? "";
      return `包含「${text}」`;
    }
    case "not_contains": {
      const text = (node.params as { text?: string }).text ?? "";
      return `不包含「${text}」`;
    }
    case "matches_text": {
      const text = (node.params as { text?: string }).text ?? "";
      return `等于「${text}」`;
    }
    case "starts_with": {
      const p = node.params as { preset?: string; text?: string };
      if (p.preset === "digit") return "以数字开头";
      if (p.preset === "letter") return "以字母开头";
      return `以「${p.text ?? ""}」开头`;
    }
    case "ends_with": {
      const p = node.params as { preset?: string; text?: string };
      if (p.preset === "digit") return "以数字结尾";
      if (p.preset === "letter") return "以字母结尾";
      return `以「${p.text ?? ""}」结尾`;
    }
    case "split_parts": {
      const p = node.params as { separator?: string; parts?: number };
      return `按「${p.separator ?? ""}」拆成 ${p.parts ?? 0} 段`;
    }
    case "split_pattern": {
      const p = node.params as { separator?: string; parts?: number };
      return `拆段正则「${p.separator ?? ""}」→${p.parts ?? 0} 段`;
    }
    case "split_pattern": {
      const p = node.params as { separator?: string; parts?: number };
      return `拆段正则「${p.separator ?? ""}」→${p.parts ?? 0} 段`;
    }
    case "length": {
      const p = node.params as { min?: number; max?: number };
      return `长度 ${p.min ?? 0}～${p.max ?? 0}`;
    }
    case "charset":
      return "字符集受限";
    case "regex": {
      const p = node.params as { pattern?: string };
      return `正则「${p.pattern ?? ""}」`;
    }
    default:
      return def.label;
  }
}

function describePredicateNode(nodeId: string, graph: RuleGraph, visited: Set<string>): string {
  const map = nodeMap(graph);
  const node = map.get(nodeId);
  if (!node || visited.has(nodeId)) return "";
  visited.add(nodeId);

  if (getNodeDef(node.type).category === "constraint") {
    if (isSegmentChainTailNode(node)) {
      return `按顺序：${describeSegmentTailChain(graph, node.id)}`;
    }
    return describeConstraint(node);
  }

  switch (node.type) {
    case "and": {
      const parts = incomingSources(graph, nodeId, "in")
        .map((id) => describePredicateNode(id, graph, visited))
        .filter(Boolean);
      return parts.length ? parts.join(" 且 ") : "（空且条件）";
    }
    case "or": {
      const parts = incomingSources(graph, nodeId, "in")
        .map((id) => describePredicateNode(id, graph, visited))
        .filter(Boolean);
      return parts.length ? `(${parts.join(" 或 ")})` : "（空或条件）";
    }
    case "not": {
      const inner = incomingSources(graph, nodeId, "in")[0];
      return inner ? `非（${describePredicateNode(inner, graph, visited)}）` : "非（空）";
    }
    case "group": {
      const inner = incomingSources(graph, nodeId, "in")[0];
      return inner ? describePredicateNode(inner, graph, visited) : "（空分组）";
    }
    case "sequence":
      return `按顺序：${describeSegmentChain(graph, nodeId)}`;
    case "count":
      if (getNodeBuilderMode(node) === "segment") {
        return `按顺序：${describeSegmentTailChain(graph, nodeId)}`;
      }
      return "匹配次数";
    default:
      return getNodeDef(node.type).label;
  }
}

/** 生成规则图的自然语言摘要（供 UI 展示） */
export function summarizeGraph(graph: RuleGraph): string {
  const root = graph.nodes.find((n) => n.type === "root");
  if (!root) return "尚未配置规则图";

  const boolSource = incomingSources(graph, root.id, "in")[0];
  if (!boolSource) return "请将判定条件连接到输出节点";

  const map = nodeMap(graph);
  const boolNode = map.get(boolSource);
  if (!boolNode) return "规则图不完整";

  if (boolNode.type === "scope") {
    const mode = (boolNode.params as ScopeParams).mode;
    const pred = incomingSources(graph, boolNode.id, "predicate")[0];
    const cond = pred ? describePredicateNode(pred, graph, new Set()) : "（无条件）";
    return `${scopeLabel(mode)}均满足：${cond}`;
  }

  if (boolNode.type === "count") {
    const p = boolNode.params as { mode?: string; n?: number };
    const pred = incomingSources(graph, boolNode.id, "predicate")[0];
    const cond = pred ? describePredicateNode(pred, graph, new Set()) : "（无条件）";
    return `匹配次数（${p.mode ?? "all"} ${p.n ?? 0}）：${cond}`;
  }

  return getNodeDef(boolNode.type).label;
}
