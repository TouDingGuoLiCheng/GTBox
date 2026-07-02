import { describe, expect, it } from "vitest";
import { createDefaultRuleGraph } from "./defaultGraph";
import { createFormatTemplateGraph } from "./formatTemplates";
import { parseRuleGraphJson, serializeRuleGraph } from "./ruleGraphIo";

describe("ruleGraphIo", () => {
  it("默认图 JSON 往返不丢节点", () => {
    const graph = createDefaultRuleGraph();
    const roundTrip = parseRuleGraphJson(serializeRuleGraph(graph));
    expect(roundTrip.nodes).toHaveLength(graph.nodes.length);
    expect(roundTrip.edges).toHaveLength(graph.edges.length);
    expect(roundTrip.nodes.map((n) => n.id).sort()).toEqual(graph.nodes.map((n) => n.id).sort());
  });

  it("内置格式模板 JSON 往返保留参数", () => {
    for (const id of ["email", "url", "phone_cn", "id_card_cn"] as const) {
      for (const variant of ["blocks", "regex"] as const) {
        const graph = createFormatTemplateGraph(id, variant);
        const roundTrip = parseRuleGraphJson(serializeRuleGraph(graph));
        expect(roundTrip.nodes).toHaveLength(graph.nodes.length);
        if (variant === "regex") {
          const origRegex = graph.nodes.find((n) => n.type === "regex");
          const rtRegex = roundTrip.nodes.find((n) => n.type === "regex");
          expect(rtRegex?.params).toEqual(origRegex?.params);
        }
      }
    }
  });

  it("无效 JSON 抛出可读错误", () => {
    expect(() => parseRuleGraphJson("{")).toThrow("JSON 格式无效");
    expect(() => parseRuleGraphJson('{"version":2}')).toThrow("不是有效的规则图文件");
  });
});
