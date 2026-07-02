import type { FullTextOptions } from "../types/textCompare";
import { normalizeFullText, splitLines } from "./textCompare";

export type TextDiffKind = "equal" | "delete" | "insert" | "replace";

export interface TextDiffRow {
  kind: TextDiffKind;
  left?: string;
  right?: string;
  leftNo?: number;
  rightNo?: number;
}

export const MAX_DIFF_DISPLAY_ROWS = 400;
export const LARGE_TEXT_WARN_CHARS = 512_000;

export function isLargeText(text: string): boolean {
  return text.length >= LARGE_TEXT_WARN_CHARS;
}

/** 基于 LCS 的行级 diff，用于全文比对结果展示 */
export function buildLineDiff(
  target: string,
  candidate: string,
  opts: FullTextOptions,
): TextDiffRow[] {
  const leftLines = splitLines(normalizeFullText(target, opts));
  const rightLines = splitLines(normalizeFullText(candidate, opts));
  const m = leftLines.length;
  const n = rightLines.length;

  if (m === 0 && n === 0) return [];
  if (m === 0) {
    return rightLines.map((line, i) => ({
      kind: "insert" as const,
      right: line,
      rightNo: i + 1,
    }));
  }
  if (n === 0) {
    return leftLines.map((line, i) => ({
      kind: "delete" as const,
      left: line,
      leftNo: i + 1,
    }));
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (leftLines[i - 1] === rightLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const rows: TextDiffRow[] = [];
  let i = m;
  let j = n;
  const stack: TextDiffRow[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && leftLines[i - 1] === rightLines[j - 1]) {
      stack.push({
        kind: "equal",
        left: leftLines[i - 1],
        right: rightLines[j - 1],
        leftNo: i,
        rightNo: j,
      });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({
        kind: "insert",
        right: rightLines[j - 1],
        rightNo: j,
      });
      j -= 1;
    } else if (i > 0 && (j === 0 || dp[i - 1][j] >= dp[i][j - 1])) {
      stack.push({
        kind: "delete",
        left: leftLines[i - 1],
        leftNo: i,
      });
      i -= 1;
    }
  }

  stack.reverse();

  for (let k = 0; k < stack.length; k++) {
    const cur = stack[k];
    const next = stack[k + 1];
    if (
      cur.kind === "delete" &&
      next?.kind === "insert" &&
      rows[rows.length - 1]?.kind !== "replace"
    ) {
      rows.push({
        kind: "replace",
        left: cur.left,
        right: next.right,
        leftNo: cur.leftNo,
        rightNo: next.rightNo,
      });
      k += 1;
      continue;
    }
    rows.push(cur);
  }

  return rows;
}

/** 大文本时仅保留差异行及前后各 1 行上下文 */
export function compactDiffRows(rows: TextDiffRow[], maxRows = MAX_DIFF_DISPLAY_ROWS): {
  rows: TextDiffRow[];
  truncated: boolean;
} {
  if (rows.length <= maxRows) return { rows, truncated: false };

  const diffIdx = new Set<number>();
  rows.forEach((row, idx) => {
    if (row.kind !== "equal") {
      diffIdx.add(idx);
      if (idx > 0) diffIdx.add(idx - 1);
      if (idx < rows.length - 1) diffIdx.add(idx + 1);
    }
  });

  const picked = [...diffIdx].sort((a, b) => a - b).slice(0, maxRows);
  const compact: TextDiffRow[] = [];
  let last = -2;
  for (const idx of picked) {
    if (idx > last + 1) {
      compact.push({ kind: "equal", left: "…", right: "…" });
    }
    compact.push(rows[idx]);
    last = idx;
  }
  return { rows: compact, truncated: true };
}

export function countDiffRows(rows: TextDiffRow[]) {
  let changed = 0;
  for (const row of rows) {
    if (row.kind !== "equal") changed++;
  }
  return changed;
}
