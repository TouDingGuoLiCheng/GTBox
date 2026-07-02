import type { RuleGraph, ScopeParams } from "../../types/ruleGraph";
import { splitLines } from "../textCompare";
import { compileGraph, compileGraphPredicate } from "../ruleGraph/compileGraph";
import { compileToPython } from "../ruleGraph/compileToPython";
import { validateGraphForBuilder } from "../ruleGraph/validateGraphForBuilder";

export const MAX_LINE_SAMPLE = 5000;

export interface MatchSpan {
  start: number;
  end: number;
  text: string;
  groups: string[];
}

export interface LineTestRow {
  lineNumber: number;
  text: string;
  pass: boolean;
  reason?: string;
  matches: MatchSpan[];
}

export interface BlockTestResult {
  error?: string;
  /** 全文是否满足规则图语义 */
  pass: boolean;
  matches: MatchSpan[];
}

export interface LineTestResult {
  error?: string;
  rows: LineTestRow[];
  passCount: number;
  total: number;
}

function pythonFlagsToJs(flags: ("IGNORECASE" | "MULTILINE" | "DOTALL")[]): string {
  let out = "";
  if (flags.includes("IGNORECASE")) out += "i";
  if (flags.includes("MULTILINE")) out += "m";
  if (flags.includes("DOTALL")) out += "s";
  return out;
}

function findRegexMatches(pattern: string, flags: string, text: string): MatchSpan[] {
  try {
    const re = new RegExp(pattern, flags.includes("g") ? flags : `${flags}g`);
    const matches: MatchSpan[] = [];
    for (const m of text.matchAll(re)) {
      if (m.index === undefined) continue;
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        text: m[0],
        groups: m.slice(1).map((g) => g ?? ""),
      });
    }
    return matches;
  } catch {
    return [];
  }
}

function lineMatches(pattern: string, flags: string, line: string): MatchSpan[] {
  const lineFlags = flags.replace("g", "");
  try {
    const re = new RegExp(pattern, lineFlags);
    const matches: MatchSpan[] = [];
    const m = re.exec(line);
    if (m?.index !== undefined) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        text: m[0],
        groups: m.slice(1).map((g) => g ?? ""),
      });
    }
    return matches;
  } catch {
    return [];
  }
}

function getScopeMode(graph: RuleGraph): ScopeParams["mode"] {
  const scope = graph.nodes.find((n) => n.type === "scope");
  return scope ? (scope.params as ScopeParams).mode : "line";
}

export function testSampleBlock(graph: RuleGraph, sample: string): BlockTestResult {
  if (!sample) {
    return { pass: false, matches: [], error: "请输入样本文本" };
  }
  const issue = validateGraphForBuilder(graph).find((i) => i.severity === "error");
  if (issue) {
    return { pass: false, matches: [], error: issue.message };
  }

  try {
    const lines = splitLines(sample);
    const evaluate = compileGraph(graph);
    const pass = evaluate({ text: sample, lines }).pass;

    const compiled = compileToPython(graph);
    let matches: MatchSpan[] = [];
    if (compiled.pattern) {
      const flags = pythonFlagsToJs(compiled.flags);
      matches = findRegexMatches(compiled.pattern, flags, sample);
    }

    return { pass, matches };
  } catch (err) {
    return {
      pass: false,
      matches: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function testSampleLines(graph: RuleGraph, sample: string): LineTestResult {
  if (!sample.trim()) {
    return { rows: [], passCount: 0, total: 0, error: "请输入样本文本" };
  }
  const issue = validateGraphForBuilder(graph).find((i) => i.severity === "error");
  if (issue) {
    return { rows: [], passCount: 0, total: 0, error: issue.message };
  }

  try {
    const lines = splitLines(sample);
    if (lines.length > MAX_LINE_SAMPLE) {
      return {
        rows: [],
        passCount: 0,
        total: 0,
        error: `样本文本超过 ${MAX_LINE_SAMPLE} 行，请删减后重试`,
      };
    }
    const scopeMode = getScopeMode(graph);
    const predicate = compileGraphPredicate(graph);
    const compiled = compileToPython(graph);
    const pattern = compiled.pattern;
    const flags = pattern ? pythonFlagsToJs(compiled.flags) : "";

    const rows: LineTestRow[] = lines.map((text, i) => {
      const lineNumber = i + 1;
      if (scopeMode === "non_empty_line" && text.trim() === "") {
        return { lineNumber, text, pass: true, matches: [], reason: "空行跳过" };
      }
      const r = predicate(text);
      const matches = pattern ? lineMatches(pattern, flags, text) : [];
      return {
        lineNumber,
        text,
        pass: r.pass,
        reason: r.pass ? undefined : r.failures[0]?.reason,
        matches,
      };
    });

    const evaluated = rows.filter((row) => row.reason !== "空行跳过");
    const passCount = evaluated.filter((r) => r.pass).length;
    return { rows, passCount, total: evaluated.length };
  } catch (err) {
    return {
      rows: [],
      passCount: 0,
      total: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function buildHighlightedParts(
  text: string,
  spans: MatchSpan[],
): Array<{ text: string; highlight: boolean }> {
  if (spans.length === 0) return [{ text, highlight: false }];

  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const parts: Array<{ text: string; highlight: boolean }> = [];
  let cursor = 0;

  for (const span of sorted) {
    if (span.start < cursor) continue;
    if (span.start > cursor) {
      parts.push({ text: text.slice(cursor, span.start), highlight: false });
    }
    parts.push({ text: text.slice(span.start, span.end), highlight: true });
    cursor = span.end;
  }

  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), highlight: false });
  }

  return parts;
}
