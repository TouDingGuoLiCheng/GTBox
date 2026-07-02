import type { CompareDetailItem, CompareResult, FolderDiffEntry } from "../types/textCompare";

export interface FolderCompareResultRaw {
  match: boolean;
  matchRate: number;
  summary: string;
  sameFileCount: number;
  diffFileCount: number;
  onlyLeftCount: number;
  onlyRightCount: number;
  totalFiles: number;
  missingCount: number;
  extraCount: number;
  diffs: Array<{ relPath: string; kind: string }>;
}

const kindLabel: Record<string, string> = {
  only_left: "仅目标有",
  only_right: "仅待比对有",
  content_diff: "内容不同",
};

export function mapFolderCompareResult(raw: FolderCompareResultRaw): CompareResult {
  const folderDiffs: FolderDiffEntry[] = raw.diffs.map((d) => ({
    relPath: d.relPath,
    kind: d.kind as FolderDiffEntry["kind"],
  }));

  const missing: CompareDetailItem[] = [];
  const extra: CompareDetailItem[] = [];

  for (const d of folderDiffs) {
    const text = `${d.relPath}（${kindLabel[d.kind] ?? d.kind}）`;
    if (d.kind === "only_right") {
      extra.push({ kind: "extra", text });
    } else {
      missing.push({ kind: "missing", text });
    }
  }

  return {
    match: raw.match,
    matchRate: raw.matchRate,
    summary: raw.summary,
    missingCount: raw.missingCount,
    extraCount: raw.extraCount,
    missing,
    extra,
    folderStats: {
      sameFileCount: raw.sameFileCount,
      diffFileCount: raw.diffFileCount,
      onlyLeftCount: raw.onlyLeftCount,
      onlyRightCount: raw.onlyRightCount,
      totalFiles: raw.totalFiles,
    },
    folderDiffs,
  };
}
