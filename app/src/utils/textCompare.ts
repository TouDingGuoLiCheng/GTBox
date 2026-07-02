import type {
  CompareDetailItem,
  CompareResult,
  FullTextOptions,
  LineCompareOptions,
  RegexCompareOptions,
} from "../types/textCompare";

export class RegexCompareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegexCompareError";
  }
}

export function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function normalizeFullText(text: string, opts: FullTextOptions): string {
  let s = text;
  if (opts.ignoreBom) {
    s = stripBom(s);
  }
  if (opts.normalizeLineEndings) {
    s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }
  if (opts.ignoreAllWhitespace) {
    s = s.replace(/\s/g, "");
  }
  if (opts.ignoreFinalNewline) {
    s = s.replace(/(\r\n|\n|\r)$/, "");
  }
  return s;
}

function lineKey(line: string, opts: LineCompareOptions): string {
  let s = line;
  if (opts.trimWhitespace) s = s.trim();
  if (opts.ignoreCase) s = s.toLowerCase();
  return s;
}

/** 按行比对用：忽略空行与纯空白行，避免尾换行 / CRLF 差异造成误报 */
function prepareLines(text: string, opts: LineCompareOptions): string[] {
  return splitLines(text).filter((line) => {
    if (line.trim() === "") return false;
    return lineKey(line, opts) !== "";
  });
}

function countMap(lines: string[], opts: LineCompareOptions): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) {
    const key = lineKey(line, opts);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

/** 同一 key 保留首次出现的展示文本 */
function displayMap(lines: string[], opts: LineCompareOptions): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of lines) {
    const key = lineKey(line, opts);
    if (!map.has(key)) map.set(key, line);
  }
  return map;
}

export function compareFullText(
  target: string,
  candidate: string,
  opts: FullTextOptions,
): CompareResult {
  const normTarget = normalizeFullText(target, opts);
  const normCandidate = normalizeFullText(candidate, opts);
  const match = normTarget === normCandidate;

  return {
    match,
    matchRate: match ? 100 : 0,
    summary: match ? "全文一致" : "全文不一致",
    missingCount: match ? 0 : 1,
    extraCount: match ? 0 : 1,
    missing: match ? [] : [{ kind: "missing", text: "全文内容与待比对项不一致" }],
    extra: [],
  };
}

export function compareLines(
  target: string,
  candidate: string,
  opts: LineCompareOptions,
): CompareResult {
  if (!opts.ignoreOrder) {
    return compareLinesByOrder(target, candidate, opts);
  }
  return compareLinesUnordered(target, candidate, opts);
}

function compareLinesByOrder(
  target: string,
  candidate: string,
  opts: LineCompareOptions,
): CompareResult {
  const targetLines = prepareLines(target, opts);
  const candidateLines = prepareLines(candidate, opts);
  const missing: CompareDetailItem[] = [];
  const extra: CompareDetailItem[] = [];
  let matchedCount = 0;

  for (let i = 0; i < targetLines.length; i++) {
    const tKey = lineKey(targetLines[i], opts);
    if (i < candidateLines.length) {
      const cKey = lineKey(candidateLines[i], opts);
      if (tKey === cKey) {
        matchedCount++;
      } else {
        missing.push({
          kind: "missing",
          text: targetLines[i],
          lineNumber: i + 1,
        });
        extra.push({
          kind: "extra",
          text: candidateLines[i],
          lineNumber: i + 1,
        });
      }
    } else {
      missing.push({
        kind: "missing",
        text: targetLines[i],
        lineNumber: i + 1,
      });
    }
  }
  for (let i = targetLines.length; i < candidateLines.length; i++) {
    extra.push({
      kind: "extra",
      text: candidateLines[i],
      lineNumber: i + 1,
    });
  }

  const match = missing.length === 0 && extra.length === 0;
  const targetEffective = targetLines.length;
  const matchRate =
    targetEffective === 0
      ? candidateLines.length === 0
        ? 100
        : 0
      : Math.round((matchedCount / targetEffective) * 100);

  let summary: string;
  if (match) {
    summary = "按行比对一致（顺序一致）";
  } else if (missing.length === 0) {
    summary = `顺序一致部分已匹配，待比对项多出 ${extra.length} 行`;
  } else {
    summary = `第 ${missing[0]?.lineNumber ?? "?"} 行起不一致，共 ${missing.length} 处差异`;
  }

  return {
    match,
    matchRate,
    summary,
    targetLineCount: targetLines.length,
    candidateLineCount: candidateLines.length,
    matchedCount,
    missingCount: missing.length,
    extraCount: extra.length,
    missing,
    extra,
  };
}

function compareLinesUnordered(
  target: string,
  candidate: string,
  opts: LineCompareOptions,
): CompareResult {
  const targetLines = prepareLines(target, opts);
  const candidateLines = prepareLines(candidate, opts);
  const targetCounts = countMap(targetLines, opts);
  const candidateCounts = countMap(candidateLines, opts);
  const targetDisplay = displayMap(targetLines, opts);
  const candidateDisplay = displayMap(candidateLines, opts);

  const missing: CompareDetailItem[] = [];
  const extra: CompareDetailItem[] = [];
  let matchedCount = 0;
  let targetEffective = 0;

  for (const [key, need] of targetCounts) {
    const required = opts.duplicateMode === "existence" ? 1 : need;
    targetEffective += required;
    const have = candidateCounts.get(key) ?? 0;
    const matched = Math.min(have, required);
    matchedCount += matched;
    if (have < required) {
      missing.push({
        kind: "missing",
        text: targetDisplay.get(key) ?? key,
        count: required - have,
      });
    }
  }

  for (const [key, have] of candidateCounts) {
    const required =
      opts.duplicateMode === "existence"
        ? targetCounts.has(key)
          ? 1
          : 0
        : (targetCounts.get(key) ?? 0);
    if (have > required) {
      extra.push({
        kind: "extra",
        text: candidateDisplay.get(key) ?? key,
        count: have - required,
      });
    }
  }

  const match = missing.length === 0 && extra.length === 0;
  const matchRate =
    targetEffective === 0
      ? candidateLines.length === 0
        ? 100
        : 0
      : Math.round((matchedCount / targetEffective) * 100);

  let summary: string;
  if (match) {
    summary = "按行比对一致";
  } else if (missing.length === 0) {
    summary = `目标项已全部包含，待比对项多出 ${extra.length} 类行`;
  } else {
    summary = `缺少 ${missing.length} 类行${extra.length ? `，多出 ${extra.length} 类行` : ""}`;
  }

  return {
    match,
    matchRate,
    summary,
    targetLineCount: targetLines.length,
    candidateLineCount: candidateLines.length,
    matchedCount,
    missingCount: missing.reduce((n, i) => n + (i.count ?? 1), 0),
    extraCount: extra.reduce((n, i) => n + (i.count ?? 1), 0),
    missing,
    extra,
  };
}

function compileRegex(pattern: string, ignoreCase: boolean): RegExp {
  try {
    return new RegExp(pattern, ignoreCase ? "i" : "");
  } catch (err) {
    const msg = err instanceof SyntaxError ? err.message : String(err);
    throw new RegexCompareError(`正则表达式无效：${msg}`);
  }
}

export function compareRegex(
  pattern: string,
  candidate: string,
  opts: RegexCompareOptions,
): CompareResult {
  const trimmed = pattern.trim();
  if (!trimmed) {
    throw new RegexCompareError("请在目标项填写正则表达式");
  }

  const re = compileRegex(trimmed, opts.ignoreCase);

  if (opts.matchScope === "full") {
    const match = re.test(candidate);
    return {
      match,
      matchRate: match ? 100 : 0,
      summary: match ? "全文满足正则规则" : "全文不满足正则规则",
      missingCount: match ? 0 : 1,
      extraCount: 0,
      missing: match
        ? []
        : [{ kind: "missing", text: `未匹配正则：${trimmed}` }],
      extra: [],
    };
  }

  const lines = splitLines(candidate).filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    return {
      match: false,
      matchRate: 0,
      summary: "待比对项无内容",
      missingCount: 0,
      extraCount: 0,
      missing: [],
      extra: [],
    };
  }

  const missing: CompareDetailItem[] = [];
  let matchedCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (re.test(line)) {
      matchedCount++;
    } else {
      missing.push({
        kind: "missing",
        text: line.length ? line : "(空行)",
        lineNumber: i + 1,
      });
    }
  }

  const match = missing.length === 0;
  const matchRate = Math.round((matchedCount / lines.length) * 100);

  return {
    match,
    matchRate,
    summary: match
      ? `全部 ${lines.length} 行满足正则`
      : `${missing.length} 行未满足正则（共 ${lines.length} 行）`,
    candidateLineCount: lines.length,
    matchedCount,
    missingCount: missing.length,
    extraCount: 0,
    missing,
    extra: [],
  };
}
