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

const SPACE_SYMBOL = "□";

function joinSegmentParts(parts: string[]): string {
  if (parts.length === 0) return "（空）";
  let result = parts[0]!;
  for (let i = 1; i < parts.length; i++) {
    const prev = parts[i - 1]!;
    const part = parts[i]!;
    const needsDot = prev !== SPACE_SYMBOL && part !== SPACE_SYMBOL;
    result += needsDot ? `·${part}` : part;
  }
  return result;
}

function nodeMap(graph: RuleGraph): Map<string, RuleNode> {
  return new Map(graph.nodes.map((n) => [n.id, n]));
}

function incomingSources(graph: RuleGraph, nodeId: string, handleId: string): string[] {
  return graph.edges
    .filter((e) => e.target === nodeId && e.targetHandle === handleId)
    .map((e) => e.source);
}

function scopePrefix(mode: ScopeParams["mode"]): string {
  switch (mode) {
    case "full":
      return "【全文】";
    case "line":
      return "【每行】";
    case "non_empty_line":
      return "【每非空行】";
  }
}

function countPrefix(mode: CountParams["mode"], n: number): string {
  switch (mode) {
    case "at_least":
      return `【行≥${n}】`;
    case "at_most":
      return `【行≤${n}】`;
    case "exactly":
      return `【行=${n}】`;
    case "all":
      return "【行全部】";
    case "global":
      return `【全文≥${n}】`;
  }
}

function segmentQuantSuffix(mode: SpaceParams["mode"], n: number, symbol: string): string {
  if (mode === "at_least" && n <= 1) return `${symbol}+`;
  if (mode === "exactly" && n === 1) return symbol;
  switch (mode) {
    case "at_least":
      return `${symbol}{≥${n}}`;
    case "exactly":
      return `${symbol}{=${n}}`;
    case "at_most":
      return `${symbol}{≤${n}}`;
  }
}

function formatLiteral(text: string): string {
  if (text.length === 1 && text !== "·" && text !== " ") {
    return text;
  }
  return `=「${text}」`;
}

function charRunSymbol(params: CharRunParams): string {
  const sym =
    params.kind === "digit" ? "\\d" : params.kind === "letter" ? "A" : params.kind === "word" ? "W" : ".";
  return params.n === 1 ? sym : `${sym}{${params.n}}`;
}

function charClassSymbol(params: CharClassSegParams): string {
  const sym =
    params.preset === "digit"
      ? "9"
      : params.preset === "letter"
        ? "A"
        : params.preset === "alnum"
          ? "AN"
          : `[${params.customClass || "?"}]`;
  return params.quantifier === "one_or_more" ? `${sym}+` : sym;
}

function describeSegmentNode(node: RuleNode, next?: RuleNode): string {
  switch (node.type) {
    case "non_empty": {
      if (next?.type === "count") {
        const p = next.params as CountParams;
        return segmentQuantSuffix(p.mode as SpaceParams["mode"], p.n, "X");
      }
      return "X+";
    }
    case "count":
      return segmentQuantSuffix(
        (node.params as CountParams).mode as SpaceParams["mode"],
        (node.params as CountParams).n,
        "X",
      );
    case "space": {
      const p = node.params as Partial<SpaceParams>;
      const mode = p.mode ?? "exactly";
      const n = typeof p.n === "number" ? p.n : 1;
      return segmentQuantSuffix(mode, n, SPACE_SYMBOL);
    }
    case "matches_text": {
      const text = (node.params as TextParams).text ?? "";
      return formatLiteral(text);
    }
    case "char_run":
      return charRunSymbol(node.params as CharRunParams);
    case "char_class_seg":
      return charClassSymbol(node.params as CharClassSegParams);
    case "position_char": {
      const p = node.params as PositionCharParams;
      if (p.mode === "literal") return formatLiteral(p.literal || "?");
      return `[${p.rangeFrom}-${p.rangeTo}]`;
    }
    case "optional_seg":
      return "?";
    default:
      return getNodeDef(node.type).label;
  }
}


function describeSegmentChain(graph: RuleGraph, sequenceId: string): string {
  const chain = collectSegmentChainOrder(graph, sequenceId);
  if (!chain || chain.length === 0) return "（空）";

  const parts: string[] = [];
  for (let i = 0; i < chain.length; i++) {
    const node = chain[i]!;
    if (node.type === "count" || node.type === "optional_seg") continue;
    let part = describeSegmentNode(node, chain[i + 1]);
    if (chain[i - 1]?.type === "optional_seg") part = `(${part})?`;
    parts.push(part);
  }
  return joinSegmentParts(parts);
}

function describeSegmentTailChain(graph: RuleGraph, tailNodeId: string): string {
  const chain = collectSegmentChainEndingAt(graph, tailNodeId);
  if (!chain || chain.length === 0) return "（空）";
  const parts: string[] = [];
  for (let i = 0; i < chain.length; i++) {
    const node = chain[i]!;
    if (node.type === "count" || node.type === "optional_seg") continue;
    let part = describeSegmentNode(node, chain[i + 1]);
    if (chain[i - 1]?.type === "optional_seg") part = `(${part})?`;
    parts.push(part);
  }
  return joinSegmentParts(parts);
}


function describeConstraint(node: RuleNode): string {
  switch (node.type) {
    case "non_empty":
      return "非空";
    case "contains": {
      const text = (node.params as { text?: string }).text ?? "";
      return `含「${text}」`;
    }
    case "not_contains": {
      const text = (node.params as { text?: string }).text ?? "";
      return `不含「${text}」`;
    }
    case "matches_text": {
      const text = (node.params as { text?: string }).text ?? "";
      return `=「${text}」`;
    }
    case "starts_with": {
      const p = node.params as { preset?: string; text?: string };
      if (p.preset === "digit") return "起数字";
      if (p.preset === "letter") return "起字母";
      return `起「${p.text ?? ""}」`;
    }
    case "ends_with": {
      const p = node.params as { preset?: string; text?: string };
      if (p.preset === "digit") return "止数字";
      if (p.preset === "letter") return "止字母";
      return `止「${p.text ?? ""}」`;
    }
    case "split_parts": {
      const p = node.params as { separator?: string; parts?: number };
      return `拆「${p.separator ?? ""}」→${p.parts ?? 0}段`;
    }
    case "split_pattern": {
      const p = node.params as { separator?: string; parts?: number };
      return `拆段「${p.separator ?? ""}」→${p.parts ?? 0}`;
    }
    case "length": {
      const p = node.params as { min?: number; max?: number };
      return `长${p.min ?? 0}~${p.max ?? 0}`;
    }
    case "charset":
      return "字集";
    case "regex":
      return "【自定义正则】";
    default:
      return getNodeDef(node.type).label;
  }
}

function describePredicateNode(nodeId: string, graph: RuleGraph, visited: Set<string>): string {
  const map = nodeMap(graph);
  const node = map.get(nodeId);
  if (!node || visited.has(nodeId)) return "";
  visited.add(nodeId);

  if (getNodeDef(node.type).category === "constraint") {
    if (isSegmentChainTailNode(node)) {
      return describeSegmentTailChain(graph, node.id);
    }
    return describeConstraint(node);
  }

  switch (node.type) {
    case "and": {
      const parts = incomingSources(graph, nodeId, "in")
        .map((id) => describePredicateNode(id, graph, visited))
        .filter(Boolean);
      return parts.length ? parts.join(" 且 ") : "（空）";
    }
    case "or": {
      const parts = incomingSources(graph, nodeId, "in")
        .map((id) => describePredicateNode(id, graph, visited))
        .filter(Boolean);
      return parts.length ? `(${parts.join(" 或 ")})` : "（空）";
    }
    case "not": {
      const inner = incomingSources(graph, nodeId, "in")[0];
      return inner ? `非(${describePredicateNode(inner, graph, visited)})` : "非(空)";
    }
    case "group": {
      const inner = incomingSources(graph, nodeId, "in")[0];
      return inner ? describePredicateNode(inner, graph, visited) : "（空）";
    }
    case "sequence":
      return describeSegmentChain(graph, nodeId);
    case "count":
      if (getNodeBuilderMode(node) === "segment") {
        return describeSegmentTailChain(graph, node.id);
      }
      return "匹配次数";
    default:
      return getNodeDef(node.type).label;
  }
}

/** 生成规则图的伪表达式预览（供 UI 展示，非真正则） */
export function pseudoPatternGraph(graph: RuleGraph): string {
  const root = graph.nodes.find((n) => n.type === "root");
  if (!root) return "尚未配置";

  const boolSource = incomingSources(graph, root.id, "in")[0];
  if (!boolSource) return "请连接输出";

  const map = nodeMap(graph);
  const boolNode = map.get(boolSource);
  if (!boolNode) return "规则不完整";

  if (boolNode.type === "scope") {
    const mode = (boolNode.params as ScopeParams).mode;
    const pred = incomingSources(graph, boolNode.id, "predicate")[0];
    const cond = pred ? describePredicateNode(pred, graph, new Set()) : "（无条件）";
    return `${scopePrefix(mode)}${cond}`;
  }

  if (boolNode.type === "count") {
    const p = boolNode.params as CountParams;
    const pred = incomingSources(graph, boolNode.id, "predicate")[0];
    const cond = pred ? describePredicateNode(pred, graph, new Set()) : "（无条件）";
    return `${countPrefix(p.mode, p.n)}${cond}`;
  }

  return getNodeDef(boolNode.type).label;
}
