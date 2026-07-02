import type {
  CharsetParams,
  CountParams,
  CountMode,
  EvalContext,
  GraphEvalResult,
  LengthParams,
  PredicateFailure,
  PredicateResult,
  RegexParams,
  RuleGraph,
  RuleNode,
  ScopeMode,
  ScopeParams,
  SplitPartsParams,
  StartsWithParams,
  TextParams,
} from "../../types/ruleGraph";
import { RuleGraphError } from "../../types/ruleGraph";
import { compileSegmentChainRegExp } from "./compileSequence";
import { getNodeDef } from "./nodeDefs";
import { collectSegmentChainEndingAt, collectSegmentChainOrder, getNodeBuilderMode, isSegmentChainTailNode } from "./segmentChain";
import { isGraphValid, validateGraph } from "./validateGraph";

type PredicateFn = (text: string) => PredicateResult;
type BoolFn = (ctx: EvalContext) => GraphEvalResult;

function nodeMap(graph: RuleGraph): Map<string, RuleNode> {
  return new Map(graph.nodes.map((n) => [n.id, n]));
}

function incomingSources(graph: RuleGraph, nodeId: string, handleId: string): string[] {
  return graph.edges
    .filter((e) => e.target === nodeId && e.targetHandle === handleId)
    .map((e) => e.source);
}

function mergeFailures(results: PredicateResult[]): PredicateFailure[] {
  const failures: PredicateFailure[] = [];
  for (const r of results) {
    if (!r.pass) failures.push(...r.failures);
  }
  return failures;
}

function passResult(): PredicateResult {
  return { pass: true, failures: [] };
}

function failResult(text: string, reason: string): PredicateResult {
  return { pass: false, failures: [{ text, reason }] };
}

function normalizeCompare(text: string, ignoreCase?: boolean): string {
  return ignoreCase ? text.toLowerCase() : text;
}

function matchStartsWith(text: string, params: StartsWithParams): boolean {
  const subject = normalizeCompare(text, params.ignoreCase);
  if (params.preset === "digit") return /^\d/.test(subject);
  if (params.preset === "letter") return /^[a-zA-Z]/.test(subject);
  const prefix = normalizeCompare(params.text, params.ignoreCase);
  return subject.startsWith(prefix);
}

function matchEndsWith(text: string, params: StartsWithParams): boolean {
  const subject = normalizeCompare(text, params.ignoreCase);
  if (params.preset === "digit") return /\d$/.test(subject);
  if (params.preset === "letter") return /[a-zA-Z]$/.test(subject);
  const suffix = normalizeCompare(params.text, params.ignoreCase);
  return subject.endsWith(suffix);
}

function buildCharsetRegex(params: CharsetParams): RegExp | null {
  let pattern = "^[";
  if (params.allowChinese) pattern += "\\u4e00-\\u9fff";
  if (params.allowLatin) pattern += "a-zA-Z";
  if (params.allowDigits) pattern += "0-9";
  if (params.allowPunctuation) pattern += "\\s\\p{P}";
  pattern += "]*$";
  if (pattern === "^[]*$") return null;
  try {
    return new RegExp(pattern, "u");
  } catch {
    return null;
  }
}

/** 分隔符去掉首尾空白后是否为连字符（歌单 ` - ` 场景） */
function separatorCoreIsHyphen(separator: string): boolean {
  return separator.trim() === "-";
}

function evaluateSplitParts(text: string, params: SplitPartsParams): PredicateResult {
  const segments = text.split(params.separator);
  if (segments.length !== params.parts) {
    return failResult(
      text,
      `按「${params.separator}」应拆成 ${params.parts} 段，实际 ${segments.length} 段`,
    );
  }
  if (segments.some((s) => s.length === 0)) {
    return failResult(text, `按「${params.separator}」拆段后存在空段`);
  }
  if (separatorCoreIsHyphen(params.separator)) {
    const bad = segments.find((s) => s.includes("-"));
    if (bad !== undefined) {
      return failResult(text, `段「${bad}」内含有额外连字符「-」`);
    }
  }
  return passResult();
}

function compileLeafPredicate(node: RuleNode): PredicateFn {
  const label = getNodeDef(node.type).label;

  switch (node.type) {
    case "non_empty":
      return (text) => (text.trim() === "" ? failResult(text, "为空") : passResult());

    case "contains": {
      const p = node.params as TextParams;
      return (text) => {
        const hay = normalizeCompare(text, p.ignoreCase);
        const needle = normalizeCompare(p.text, p.ignoreCase);
        return hay.includes(needle)
          ? passResult()
          : failResult(text, `未包含「${p.text}」`);
      };
    }

    case "not_contains": {
      const p = node.params as TextParams;
      return (text) => {
        const hay = normalizeCompare(text, p.ignoreCase);
        const needle = normalizeCompare(p.text, p.ignoreCase);
        return hay.includes(needle)
          ? failResult(text, `不应包含「${p.text}」`)
          : passResult();
      };
    }

    case "starts_with": {
      const p = node.params as StartsWithParams;
      return (text) =>
        matchStartsWith(text, p)
          ? passResult()
          : failResult(text, `不符合开头规则（${label}）`);
    }

    case "ends_with": {
      const p = node.params as StartsWithParams;
      return (text) =>
        matchEndsWith(text, p)
          ? passResult()
          : failResult(text, `不符合结尾规则（${label}）`);
    }

    case "matches_text": {
      const p = node.params as TextParams;
      return (text) => {
        const a = normalizeCompare(text, p.ignoreCase);
        const b = normalizeCompare(p.text, p.ignoreCase);
        return a === b ? passResult() : failResult(text, `不等于「${p.text}」`);
      };
    }

    case "split_parts":
    case "split_pattern": {
      const p = node.params as SplitPartsParams;
      return (text) => evaluateSplitParts(text, p);
    }

    case "length": {
      const p = node.params as LengthParams;
      return (text) => {
        const len = text.length;
        if (len < p.min || len > p.max) {
          return failResult(text, `长度 ${len} 不在 ${p.min}～${p.max} 范围内`);
        }
        return passResult();
      };
    }

    case "charset": {
      const p = node.params as CharsetParams;
      const re = buildCharsetRegex(p);
      return (text) => {
        if (!re) return failResult(text, "未选择任何允许字符");
        return re.test(text) ? passResult() : failResult(text, "包含不允许的字符");
      };
    }

    case "regex": {
      const p = node.params as RegexParams;
      let re: RegExp;
      try {
        re = new RegExp(p.pattern, p.ignoreCase ? "i" : "");
      } catch (err) {
        const msg = err instanceof SyntaxError ? err.message : String(err);
        throw new RuleGraphError(`正则积木无效：${msg}`);
      }
      return (text) =>
        re.test(text) ? passResult() : failResult(text, `不满足正则「${p.pattern}」`);
    }

    default:
      throw new RuleGraphError(`节点「${label}」暂不支持编译为约束`);
  }
}

function compilePredicateNode(nodeId: string, graph: RuleGraph, stack: Set<string>): PredicateFn {
  const map = nodeMap(graph);
  const node = map.get(nodeId);
  if (!node) throw new RuleGraphError(`找不到节点 ${nodeId}`);
  if (stack.has(nodeId)) throw new RuleGraphError("规则图存在环路");
  stack.add(nodeId);

  const def = getNodeDef(node.type);
  let fn: PredicateFn;

  if (isSegmentChainTailNode(node)) {
    const chain = collectSegmentChainEndingAt(graph, node.id);
    if (!chain || chain.length === 0) {
      throw new RuleGraphError("段链无效或为空");
    }
    const re = compileSegmentChainRegExp(chain);
    fn = (text) =>
      re.test(text) ? passResult() : failResult(text, "不符合顺序段链模式");
    stack.delete(nodeId);
    return fn;
  }

  if (def.category === "constraint") {
    fn = compileLeafPredicate(node);
  } else {
    switch (node.type) {
      case "and": {
        const sources = incomingSources(graph, nodeId, "in");
        const fns = sources.map((id) => compilePredicateNode(id, graph, new Set(stack)));
        fn = (text) => {
          const results = fns.map((f) => f(text));
          const failures = mergeFailures(results);
          return { pass: failures.length === 0, failures };
        };
        break;
      }
      case "or": {
        const sources = incomingSources(graph, nodeId, "in");
        const fns = sources.map((id) => compilePredicateNode(id, graph, new Set(stack)));
        fn = (text) => {
          if (fns.length === 0) return failResult(text, "或条件为空");
          const results = fns.map((f) => f(text));
          if (results.some((r) => r.pass)) return passResult();
          return {
            pass: false,
            failures: [{ text, reason: "不满足任一或条件" }],
          };
        };
        break;
      }
      case "not": {
        const sources = incomingSources(graph, nodeId, "in");
        const inner = sources[0]
          ? compilePredicateNode(sources[0], graph, new Set(stack))
          : () => passResult();
        fn = (text) => {
          const r = inner(text);
          return r.pass
            ? failResult(text, "不应满足内部条件")
            : passResult();
        };
        break;
      }
      case "group": {
        const sources = incomingSources(graph, nodeId, "in");
        fn = sources[0]
          ? compilePredicateNode(sources[0], graph, new Set(stack))
          : () => failResult("", "分组内无条件");
        break;
      }
      case "sequence": {
        const chain = collectSegmentChainOrder(graph, nodeId);
        if (!chain || chain.length === 0) {
          throw new RuleGraphError("顺序节点段链无效或为空");
        }
        const re = compileSegmentChainRegExp(chain);
        fn = (text) =>
          re.test(text) ? passResult() : failResult(text, "不符合顺序段链模式");
        break;
      }
      case "count":
        throw new RuleGraphError("匹配次数（段内）请将「构建模式」切为顺序后作为段链尾输出");
      default:
        throw new RuleGraphError(`节点「${def.label}」不能作为约束组合`);
    }
  }

  stack.delete(nodeId);
  return fn;
}

interface ScopeUnit {
  text: string;
  lineNumber?: number;
}

function getScopeUnits(ctx: EvalContext, mode: ScopeMode): ScopeUnit[] {
  if (mode === "full") {
    return [{ text: ctx.text }];
  }
  const lines = ctx.lines;
  const units: ScopeUnit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (mode === "non_empty_line" && line.trim() === "") continue;
    units.push({ text: line, lineNumber: i + 1 });
  }
  return units;
}

function evaluateCount(
  mode: CountMode,
  n: number,
  total: number,
  matched: number,
): boolean {
  switch (mode) {
    case "all":
      return matched === total;
    case "at_least":
      return matched >= n;
    case "at_most":
      return matched <= n;
    case "exactly":
      return matched === n;
    case "global":
      return matched >= n;
  }
}

function compileBoolNode(nodeId: string, graph: RuleGraph, stack: Set<string>): BoolFn {
  const map = nodeMap(graph);
  const node = map.get(nodeId);
  if (!node) throw new RuleGraphError(`找不到节点 ${nodeId}`);
  if (stack.has(nodeId)) throw new RuleGraphError("规则图存在环路");
  stack.add(nodeId);

  let fn: BoolFn;

  switch (node.type) {
    case "scope": {
      const params = node.params as ScopeParams;
      const predSources = incomingSources(graph, nodeId, "predicate");
      if (predSources.length === 0) {
        throw new RuleGraphError("作用范围节点未连接约束条件");
      }
      const predicate = compilePredicateNode(predSources[0], graph, new Set());
      fn = (ctx) => {
        const units = getScopeUnits(ctx, params.mode);
        if (units.length === 0) {
          return {
            pass: false,
            failures: [{ text: "", reason: "待比对项无有效内容" }],
            evaluatedCount: 0,
            matchedCount: 0,
          };
        }
        const failures: PredicateFailure[] = [];
        let matched = 0;
        for (const unit of units) {
          const r = predicate(unit.text);
          if (r.pass) {
            matched++;
          } else {
            for (const f of r.failures) {
              failures.push({
                ...f,
                lineNumber: unit.lineNumber ?? f.lineNumber,
                text: f.text || unit.text,
              });
            }
          }
        }
        return {
          pass: failures.length === 0,
          failures,
          evaluatedCount: units.length,
          matchedCount: matched,
        };
      };
      break;
    }

    case "count": {
      const params = node.params as CountParams;
      if (getNodeBuilderMode(node) === "segment") {
        throw new RuleGraphError("段内模式的匹配次数不能直接输出布尔判定，请改接作用范围条件口");
      }
      const predSources = incomingSources(graph, nodeId, "predicate");
      if (predSources.length === 0) {
        throw new RuleGraphError("匹配次数节点未连接约束条件");
      }
      const predicate = compilePredicateNode(predSources[0], graph, new Set());
      fn = (ctx) => {
        if (params.mode === "global") {
          const r = predicate(ctx.text);
          const matched = r.pass ? 1 : 0;
          const pass = evaluateCount(params.mode, params.n, 1, matched);
          return {
            pass,
            failures: pass
              ? []
              : [{ text: ctx.text.slice(0, 200), reason: `全文未满足至少 ${params.n} 次匹配` }],
            evaluatedCount: 1,
            matchedCount: matched,
          };
        }

        const units = getScopeUnits(ctx, "line");
        let matched = 0;
        const failures: PredicateFailure[] = [];
        for (const unit of units) {
          const r = predicate(unit.text);
          if (r.pass) matched++;
          else if (params.mode === "all") {
            failures.push(
              ...(r.failures.map((f) => ({
                ...f,
                lineNumber: unit.lineNumber,
                text: f.text || unit.text,
              })) ?? []),
            );
          }
        }

        const pass = evaluateCount(params.mode, params.n, units.length, matched);
        if (!pass && failures.length === 0) {
          failures.push({
            text: "",
            reason: `匹配次数不满足：需要 ${params.mode} ${params.n}，实际 ${matched}/${units.length}`,
          });
        }
        return {
          pass,
          failures,
          evaluatedCount: units.length,
          matchedCount: matched,
        };
      };
      break;
    }

    default:
      throw new RuleGraphError(`节点 ${node.type} 不能输出布尔判定`);
  }

  stack.delete(nodeId);
  return fn;
}

export function compileGraph(graph: RuleGraph): BoolFn {
  const issues = validateGraph(graph);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length > 0) {
    throw new RuleGraphError(errors[0].message);
  }

  const root = graph.nodes.find((n) => n.type === "root");
  if (!root) throw new RuleGraphError("规则图缺少输出节点");

  const sources = incomingSources(graph, root.id, "in");
  if (sources.length === 0) {
    throw new RuleGraphError("输出节点尚未连接判定条件");
  }

  return compileBoolNode(sources[0], graph, new Set());
}

/** 从图中编译约束谓词（供试跑预览，不含 SCOPE 聚合） */
export function compileGraphPredicate(graph: RuleGraph): PredicateFn {
  const scope = graph.nodes.find((n) => n.type === "scope");
  if (!scope) {
    throw new RuleGraphError("试跑预览需要「作用范围」节点");
  }
  const predSources = incomingSources(graph, scope.id, "predicate");
  if (predSources.length === 0) {
    throw new RuleGraphError("作用范围未连接约束条件");
  }
  return compilePredicateNode(predSources[0], graph, new Set());
}

export function evaluateGraph(graph: RuleGraph, ctx: EvalContext): GraphEvalResult {
  if (!isGraphValid(graph)) {
    const first = validateGraph(graph).find((i) => i.severity === "error");
    throw new RuleGraphError(first?.message ?? "规则图无效");
  }
  return compileGraph(graph)(ctx);
}
