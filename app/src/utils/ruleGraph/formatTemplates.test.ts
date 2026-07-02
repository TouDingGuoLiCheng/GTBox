import { describe, expect, it } from "vitest";
import { compileToPython } from "./compileToPython";
import { compileGraphPredicate } from "./compileGraph";
import {
  FORMAT_TEMPLATE_DEFS,
  createFormatTemplateGraph,
  type FormatTemplateId,
} from "./formatTemplates";

const IDS: FormatTemplateId[] = ["email", "url", "phone_cn", "id_card_cn"];

describe("formatTemplates", () => {
  it("内置模板菜单含积木与正则各四种", () => {
    expect(FORMAT_TEMPLATE_DEFS).toHaveLength(8);
    for (const id of IDS) {
      expect(FORMAT_TEMPLATE_DEFS.filter((d) => d.id === id)).toHaveLength(2);
    }
  });

  it.each(IDS)("%s 积木版 complete 可导出", (id) => {
    const graph = createFormatTemplateGraph(id, "blocks");
    const result = compileToPython(graph);
    expect(result.error).toBeUndefined();
    expect(result.complete).toBe(true);
    expect(result.pattern).toBeTruthy();
    expect(result.code).toContain("re.compile");
  });

  it.each(IDS)("%s 正则版可导出", (id) => {
    const graph = createFormatTemplateGraph(id, "regex");
    const result = compileToPython(graph);
    expect(result.error).toBeUndefined();
    expect(result.pattern).toBeTruthy();
    expect(result.code).toContain("re.compile");
  });

  it("手机号积木版与试跑谓词一致", () => {
    const graph = createFormatTemplateGraph("phone_cn", "blocks");
    const result = compileToPython(graph);
    const predicate = compileGraphPredicate(graph);
    const re = new RegExp(result.pattern!);
    for (const [text, pass] of [
      ["13812345678", true],
      ["12812345678", false],
    ] as const) {
      expect(predicate(text).pass).toBe(pass);
      expect(re.test(text)).toBe(pass);
    }
  });

  it("邮箱积木版拆段正则", () => {
    const result = compileToPython(createFormatTemplateGraph("email", "blocks"));
    expect(result.pattern).toContain("@");
    expect(result.pattern).toContain(".");
  });
});
