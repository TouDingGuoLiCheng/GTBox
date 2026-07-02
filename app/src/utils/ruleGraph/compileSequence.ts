import type {
  CharClassSegParams,
  CharRunParams,
  CountParams,
  PositionCharParams,
  RuleNode,
  SpaceParams,
  TextParams,
} from "../../types/ruleGraph";
import { RuleGraphError } from "../../types/ruleGraph";

function escapeRegexLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveSpaceParams(node: RuleNode): SpaceParams {
  const p = node.params as Partial<SpaceParams>;
  return {
    mode: p.mode ?? "exactly",
    n: typeof p.n === "number" ? p.n : 1,
  };
}

function resolveCharRunParams(node: RuleNode): CharRunParams {
  const p = node.params as Partial<CharRunParams>;
  return {
    kind: p.kind ?? "digit",
    n: typeof p.n === "number" && p.n >= 0 ? p.n : 1,
  };
}

function resolveCharClassParams(node: RuleNode): CharClassSegParams {
  const p = node.params as Partial<CharClassSegParams>;
  return {
    preset: p.preset ?? "digit",
    customClass: typeof p.customClass === "string" ? p.customClass : "",
    quantifier: p.quantifier ?? "one_or_more",
  };
}

function compileNonEmptyQuantifier(params: CountParams): string {
  switch (params.mode) {
    case "at_least":
      return params.n <= 1 ? "[^-\\s]+" : `[^-\\s]{${params.n},}`;
    case "exactly":
      return `[^-\\s]{${params.n}}`;
    case "at_most":
      return params.n <= 0 ? "" : params.n === 1 ? "[^-\\s]?" : `[^-\\s]{0,${params.n}}`;
    case "all":
    case "global":
      throw new RuleGraphError("段链内「匹配次数」不支持行级模式 all / global，请改用 at_least / exactly");
    default:
      throw new RuleGraphError(`段链内不支持的量词模式：${params.mode as string}`);
  }
}

function compileSpaceQuantifier(params: SpaceParams): string {
  switch (params.mode) {
    case "at_least":
      return params.n <= 1 ? " +" : ` {${params.n},}`;
    case "exactly":
      return params.n <= 1 ? " " : ` {${params.n}}`;
    case "at_most":
      return params.n <= 0 ? "" : params.n === 1 ? " ?" : ` {0,${params.n}}`;
    default:
      throw new RuleGraphError(`段链内不支持的空格量词模式：${params.mode as string}`);
  }
}

function compileCharRunPiece(params: CharRunParams): string {
  const n = Math.max(0, params.n);
  const q = n === 1 ? "" : `{${n}}`;
  switch (params.kind) {
    case "digit":
      return `\\d${q}`;
    case "letter":
      return `[a-zA-Z]${q}`;
    case "word":
      return `\\w${q}`;
    case "any":
      return `.${q}`;
    default:
      throw new RuleGraphError(`不支持的连续字符类型：${params.kind as string}`);
  }
}

function sanitizeCustomClass(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new RuleGraphError("自定义字符类不能为空");
  if (/[\[\]\\]/.test(trimmed)) {
    throw new RuleGraphError("自定义字符类不能含 [ ] \\");
  }
  return trimmed;
}

function resolvePositionCharParams(node: RuleNode): PositionCharParams {
  const p = node.params as Partial<PositionCharParams>;
  return {
    mode: p.mode ?? "range",
    literal: typeof p.literal === "string" ? p.literal : "",
    rangeFrom: typeof p.rangeFrom === "string" ? p.rangeFrom : "0",
    rangeTo: typeof p.rangeTo === "string" ? p.rangeTo : "9",
  };
}

function compilePositionCharPiece(params: PositionCharParams): string {
  if (params.mode === "literal") {
    const lit = params.literal.trim();
    if (!lit) throw new RuleGraphError("固定字符不能为空");
    return escapeRegexLiteral(lit.slice(0, 1));
  }
  const from = params.rangeFrom.trim();
  const to = params.rangeTo.trim();
  if (!from || !to) throw new RuleGraphError("字符范围不能为空");
  if (from.length !== 1 || to.length !== 1) {
    throw new RuleGraphError("字符范围仅支持单字符起止");
  }
  return `[${escapeRegexLiteral(from)}-${escapeRegexLiteral(to)}]`;
}

function compileCharClassPiece(params: CharClassSegParams): string {
  let inner: string;
  switch (params.preset) {
    case "digit":
      inner = "0-9";
      break;
    case "letter":
      inner = "a-zA-Z";
      break;
    case "alnum":
      inner = "a-zA-Z0-9";
      break;
    case "custom":
      inner = sanitizeCustomClass(params.customClass);
      break;
    default:
      throw new RuleGraphError(`不支持的字符类预设：${params.preset as string}`);
  }
  const body = `[${inner}]`;
  return params.quantifier === "one_or_more" ? `${body}+` : body;
}

interface SegmentPiece {
  pattern: string;
  consumed: number;
  ignoreCase?: boolean;
}

function compileSegmentPieceAt(chain: RuleNode[], index: number): SegmentPiece {
  const node = chain[index];
  if (!node) throw new RuleGraphError("段链索引越界");

  switch (node.type) {
    case "non_empty": {
      const next = chain[index + 1];
      if (next?.type === "count") {
        return {
          pattern: compileNonEmptyQuantifier(next.params as CountParams),
          consumed: 2,
        };
      }
      return { pattern: "[^\\s]+", consumed: 1 };
    }
    case "count":
      throw new RuleGraphError("段链中「匹配次数」需紧跟在非空段之后");
    case "space":
      return {
        pattern: compileSpaceQuantifier(resolveSpaceParams(node)),
        consumed: 1,
      };
    case "matches_text": {
      const p = node.params as TextParams;
      return {
        pattern: escapeRegexLiteral(p.text),
        consumed: 1,
        ignoreCase: !!p.ignoreCase,
      };
    }
    case "char_run":
      return {
        pattern: compileCharRunPiece(resolveCharRunParams(node)),
        consumed: 1,
      };
    case "char_class_seg":
      return {
        pattern: compileCharClassPiece(resolveCharClassParams(node)),
        consumed: 1,
      };
    case "position_char":
      return {
        pattern: compilePositionCharPiece(resolvePositionCharParams(node)),
        consumed: 1,
      };
    case "optional_seg":
      throw new RuleGraphError("可选段不能作为被包装段，请检查段链顺序");
    default:
      throw new RuleGraphError(`段链不支持节点类型：${node.type}`);
  }
}

/** 将顺序节点的段链编译为正则片段（不含 ^$ 锚点） */
export function compileSegmentChainPattern(chain: RuleNode[]): {
  pattern: string;
  ignoreCase: boolean;
} {
  if (chain.length === 0) {
    throw new RuleGraphError("顺序节点的段链为空");
  }

  let pattern = "";
  let ignoreCase = false;
  let i = 0;

  while (i < chain.length) {
    const node = chain[i]!;

    if (node.type === "optional_seg") {
      const next = i + 1;
      if (next >= chain.length) {
        throw new RuleGraphError("可选段后需连接段积木");
      }
      const piece = compileSegmentPieceAt(chain, next);
      pattern += `(?:${piece.pattern})?`;
      if (piece.ignoreCase) ignoreCase = true;
      i = next + piece.consumed;
      continue;
    }

    const piece = compileSegmentPieceAt(chain, i);
    pattern += piece.pattern;
    if (piece.ignoreCase) ignoreCase = true;
    i += piece.consumed;
  }

  return { pattern, ignoreCase };
}

export function compileSegmentChainRegExp(chain: RuleNode[]): RegExp {
  const { pattern, ignoreCase } = compileSegmentChainPattern(chain);
  try {
    return new RegExp(`^${pattern}$`, ignoreCase ? "i" : "");
  } catch (err) {
    const msg = err instanceof SyntaxError ? err.message : String(err);
    throw new RuleGraphError(`顺序段链编译失败：${msg}`);
  }
}
