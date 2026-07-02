import type { RuleGraph } from "./ruleGraph";
import { createDefaultRuleGraph } from "../utils/ruleGraph/defaultGraph";

export type CompareMode = "full" | "line" | "regex" | "folder";

export interface FullTextOptions {
  normalizeLineEndings: boolean;
  ignoreAllWhitespace: boolean;
  ignoreFinalNewline: boolean;
  ignoreBom: boolean;
}

export interface LineCompareOptions {
  trimWhitespace: boolean;
  ignoreCase: boolean;
  /** 开启时按集合比对（顺序可不同）；关闭时按行号逐行比对 */
  ignoreOrder: boolean;
  duplicateMode: "count" | "existence";
}

export interface RegexCompareOptions {
  matchScope: "full" | "line";
  ignoreCase: boolean;
}

export interface TextCompareFormState {
  mode: CompareMode;
  targetText: string;
  candidateText: string;
  targetFile: string;
  candidateFile: string;
  targetFolder: string;
  candidateFolder: string;
  fullText: FullTextOptions;
  line: LineCompareOptions;
  regex: RegexCompareOptions;
  /** 规则比对模式下的节点图（mode === regex） */
  ruleGraph: RuleGraph;
  /** 高级：手写正则；非空时优先于 ruleGraph */
  legacyRegex: string;
  useLegacyRegex: boolean;
}

export type CompareDetailKind = "missing" | "extra";

export interface CompareDetailItem {
  kind: CompareDetailKind;
  /** 展示用原文 */
  text: string;
  /** 按行比对时的行号（1-based，展示侧） */
  lineNumber?: number;
  /** 缺少或多余的出现次数 */
  count?: number;
}

export type FolderDiffKind = "only_left" | "only_right" | "content_diff";

export interface FolderDiffEntry {
  relPath: string;
  kind: FolderDiffKind;
}

export interface FolderCompareStats {
  sameFileCount: number;
  diffFileCount: number;
  onlyLeftCount: number;
  onlyRightCount: number;
  totalFiles: number;
}

export interface CompareResult {
  match: boolean;
  /** 0～100 */
  matchRate: number;
  summary: string;
  targetLineCount?: number;
  candidateLineCount?: number;
  matchedCount?: number;
  missingCount: number;
  extraCount: number;
  missing: CompareDetailItem[];
  extra: CompareDetailItem[];
  folderStats?: FolderCompareStats;
  folderDiffs?: FolderDiffEntry[];
}

export const defaultTextCompareForm = (): TextCompareFormState => ({
  mode: "line",
  targetText: "",
  candidateText: "",
  targetFile: "",
  candidateFile: "",
  targetFolder: "",
  candidateFolder: "",
  fullText: {
    normalizeLineEndings: false,
    ignoreAllWhitespace: false,
    ignoreFinalNewline: false,
    ignoreBom: false,
  },
  line: {
    trimWhitespace: false,
    ignoreCase: false,
    ignoreOrder: true,
    duplicateMode: "count",
  },
  regex: {
    matchScope: "line",
    ignoreCase: false,
  },
  ruleGraph: createDefaultRuleGraph(),
  legacyRegex: "",
  useLegacyRegex: false,
});
