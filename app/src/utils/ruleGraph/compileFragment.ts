import type {
  CharsetParams,
  LengthParams,
  RegexParams,
  RuleNode,
  SplitPartsParams,
  StartsWithParams,
  TextParams,
} from "../../types/ruleGraph";

export interface RegexFragment {
  lookaheads: string[];
  body: string;
  ignoreCase: boolean;
  complete: boolean;
  warning?: string;
}

export function escapeRegexLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function separatorCoreIsHyphen(separator: string): boolean {
  return separator.trim() === "-";
}

function compileCharsetBody(params: CharsetParams): string | null {
  let inner = "";
  if (params.allowChinese) inner += "\\u4e00-\\u9fff";
  if (params.allowLatin) inner += "a-zA-Z";
  if (params.allowDigits) inner += "0-9";
  if (params.allowPunctuation) inner += "\\s\\p{P}";
  if (!inner) return null;
  return `[${inner}]+`;
}

export function compileSplitPartsBody(params: SplitPartsParams): string {
  const sep = escapeRegexLiteral(params.separator);
  const isHyphen = separatorCoreIsHyphen(params.separator);
  const segment = isHyphen ? "[^-]+" : `(?:(?!${sep}).)+`;
  const parts = Math.max(2, params.parts);
  return Array(parts).fill(segment).join(sep);
}

export function fragmentCore(fragment: RegexFragment): string {
  return `${fragment.lookaheads.join("")}${fragment.body || ".*"}`;
}

export function negateFragment(fragment: RegexFragment): RegexFragment {
  return {
    lookaheads: [],
    body: `(?!${fragmentCore(fragment)}).*`,
    ignoreCase: fragment.ignoreCase,
    complete: fragment.complete,
    warning: fragment.warning,
  };
}

export function mergeIgnoreCase(a: boolean, b: boolean): boolean {
  return a || b;
}

export function mergeFragments(parts: RegexFragment[]): RegexFragment {
  const lookaheads: string[] = [];
  let body = "";
  let ignoreCase = false;
  let complete = true;
  const warnings: string[] = [];

  const bodies = parts.filter((p) => p.body);
  const lookaheadOnly = parts.filter((p) => !p.body && p.lookaheads.length > 0);

  for (const p of [...lookaheadOnly, ...parts]) {
    lookaheads.push(...p.lookaheads);
    ignoreCase = mergeIgnoreCase(ignoreCase, p.ignoreCase);
    if (!p.complete) complete = false;
    if (p.warning) warnings.push(p.warning);
  }

  if (bodies.length === 1) {
    body = bodies[0]!.body;
    ignoreCase = mergeIgnoreCase(ignoreCase, bodies[0]!.ignoreCase);
    if (!bodies[0]!.complete) complete = false;
  } else if (bodies.length > 1) {
    const starts = bodies.filter((b) => b.body.endsWith(".*") && !b.body.startsWith(".*"));
    const ends = bodies.filter((b) => b.body.startsWith(".*") && !b.body.endsWith(".*"));
    const exact = bodies.filter((b) => !b.body.includes(".*"));

    if (exact.length === 1 && starts.length === 0 && ends.length === 0) {
      body = exact[0]!.body;
      for (const other of bodies.filter((b) => b !== exact[0])) {
        lookaheads.push(`(?=${other.body})`);
      }
    } else if (starts.length === 1 && ends.length === 0 && exact.length === 0) {
      body = starts[0]!.body;
    } else if (starts.length === 1 && ends.length === 1 && exact.length === 0) {
      body = `${starts[0]!.body.slice(0, -2)}${ends[0]!.body.slice(2)}`;
    } else {
      for (let i = 0; i < bodies.length - 1; i++) {
        lookaheads.push(`(?=${bodies[i]!.body})`);
      }
      body = bodies[bodies.length - 1]!.body;
    }
  } else {
    body = ".*";
  }

  return {
    lookaheads: [...new Set(lookaheads)],
    body,
    ignoreCase,
    complete,
    warning: warnings.length ? warnings.join("；") : undefined,
  };
}

export function mergeOrFragments(parts: RegexFragment[]): RegexFragment {
  const ignoreCase = parts.some((p) => p.ignoreCase);
  const complete = parts.length > 0 && parts.every((p) => p.complete);
  const warnings = parts.map((p) => p.warning).filter(Boolean) as string[];
  const body = parts.map((p) => fragmentCore(p)).join("|");
  return {
    lookaheads: [],
    body: `(?:${body})`,
    ignoreCase,
    complete,
    warning: warnings.length ? warnings.join("；") : undefined,
  };
}

export function compileLeafFragment(node: RuleNode): RegexFragment | null {
  switch (node.type) {
    case "non_empty":
      return {
        lookaheads: ["(?=\\s*\\S)"],
        body: ".*",
        ignoreCase: false,
        complete: true,
      };
    case "contains": {
      const p = node.params as TextParams;
      const lit = escapeRegexLiteral(p.text);
      return {
        lookaheads: [`(?=.*${lit})`],
        body: "",
        ignoreCase: !!p.ignoreCase,
        complete: true,
      };
    }
    case "not_contains": {
      const p = node.params as TextParams;
      const lit = escapeRegexLiteral(p.text);
      return {
        lookaheads: [`(?!.*${lit})`],
        body: "",
        ignoreCase: !!p.ignoreCase,
        complete: true,
      };
    }
    case "starts_with": {
      const p = node.params as StartsWithParams;
      let start = "";
      if (p.preset === "digit") start = "\\d";
      else if (p.preset === "letter") start = "[a-zA-Z]";
      else start = escapeRegexLiteral(p.text);
      return {
        lookaheads: [],
        body: start + ".*",
        ignoreCase: !!p.ignoreCase,
        complete: true,
      };
    }
    case "ends_with": {
      const p = node.params as StartsWithParams;
      let end = "";
      if (p.preset === "digit") end = "\\d";
      else if (p.preset === "letter") end = "[a-zA-Z]";
      else end = escapeRegexLiteral(p.text);
      return {
        lookaheads: [],
        body: `.*${end}`,
        ignoreCase: !!p.ignoreCase,
        complete: true,
      };
    }
    case "matches_text": {
      const p = node.params as TextParams;
      return {
        lookaheads: [],
        body: escapeRegexLiteral(p.text),
        ignoreCase: !!p.ignoreCase,
        complete: true,
      };
    }
    case "length": {
      const p = node.params as LengthParams;
      const body =
        p.min === p.max ? `.{${p.min}}` : `.{${p.min},${p.max === null ? "" : p.max}}`;
      return {
        lookaheads: [],
        body,
        ignoreCase: false,
        complete: true,
      };
    }
    case "charset": {
      const body = compileCharsetBody(node.params as CharsetParams);
      if (!body) return null;
      return { lookaheads: [], body, ignoreCase: false, complete: true };
    }
    case "regex": {
      const p = node.params as RegexParams;
      return {
        lookaheads: [],
        body: p.pattern,
        ignoreCase: !!p.ignoreCase,
        complete: true,
      };
    }
    case "split_parts":
    case "split_pattern": {
      const p = node.params as SplitPartsParams;
      return {
        lookaheads: [],
        body: compileSplitPartsBody(p),
        ignoreCase: false,
        complete: true,
      };
    }
    default:
      return null;
  }
}
