import type { CompareMode, CompareResult } from "../types/textCompare";

export type ReportFormat = "txt" | "csv";

const modeLabels: Record<CompareMode, string> = {
  line: "按行比对",
  full: "全文比对",
  regex: "正则比对",
  folder: "文件夹比对",
};

function csvEscape(value: string) {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildCompareReport(
  mode: CompareMode,
  result: CompareResult,
  format: ReportFormat,
): string {
  const now = new Date().toLocaleString("zh-CN");
  const status = result.match ? "一致" : "不一致";

  if (format === "csv") {
    const lines = [
      "字段,值",
      `生成时间,${csvEscape(now)}`,
      `比对模式,${csvEscape(modeLabels[mode])}`,
      `结果,${status}`,
      `匹配度,${result.matchRate}%`,
      `摘要,${csvEscape(result.summary)}`,
      `差异项数,${result.missingCount + result.extraCount}`,
      "",
      "类型,行号,内容",
    ];
    for (const item of result.missing) {
      const text =
        (item.lineNumber != null ? `第 ${item.lineNumber} 行：` : "") +
        item.text +
        (item.count != null && item.count > 1 ? `（×${item.count}）` : "");
      lines.push(`缺失,${item.lineNumber ?? ""},${csvEscape(text)}`);
    }
    for (const item of result.extra) {
      const text =
        (item.lineNumber != null ? `第 ${item.lineNumber} 行：` : "") +
        item.text +
        (item.count != null && item.count > 1 ? `（×${item.count}）` : "");
      lines.push(`多出,${item.lineNumber ?? ""},${csvEscape(text)}`);
    }
    if (result.folderStats) {
      lines.push("");
      lines.push("统计项,数值");
      lines.push(`总文件数,${result.folderStats.totalFiles}`);
      lines.push(`一致文件,${result.folderStats.sameFileCount}`);
      lines.push(`内容不同,${result.folderStats.diffFileCount}`);
      lines.push(`仅目标,${result.folderStats.onlyLeftCount}`);
      lines.push(`仅待比对,${result.folderStats.onlyRightCount}`);
    }
    return `${lines.join("\n")}\n`;
  }

  const parts = [
    "文本比对报告",
    "==========",
    `生成时间：${now}`,
    `比对模式：${modeLabels[mode]}`,
    `结果：${status}`,
    `匹配度：${result.matchRate}%`,
    `摘要：${result.summary}`,
    `差异项：${result.missingCount + result.extraCount}`,
    "",
  ];

  if (result.folderStats) {
    parts.push(
      "【文件夹统计】",
      `总文件数：${result.folderStats.totalFiles}`,
      `一致文件：${result.folderStats.sameFileCount}`,
      `内容不同：${result.folderStats.diffFileCount}`,
      `仅目标：${result.folderStats.onlyLeftCount}`,
      `仅待比对：${result.folderStats.onlyRightCount}`,
      "",
    );
  }

  if (result.missing.length) {
    parts.push("【缺失 / 不匹配】");
    for (const item of result.missing) {
      const prefix = item.lineNumber != null ? `第 ${item.lineNumber} 行：` : "- ";
      const count = item.count != null && item.count > 1 ? `（×${item.count}）` : "";
      parts.push(`${prefix}${item.text}${count}`);
    }
    parts.push("");
  }

  if (result.extra.length) {
    parts.push("【多出】");
    for (const item of result.extra) {
      const prefix = item.lineNumber != null ? `第 ${item.lineNumber} 行：` : "- ";
      const count = item.count != null && item.count > 1 ? `（×${item.count}）` : "";
      parts.push(`${prefix}${item.text}${count}`);
    }
    parts.push("");
  }

  if (!result.missing.length && !result.extra.length) {
    parts.push("无差异明细。");
  }

  return parts.join("\n");
}
