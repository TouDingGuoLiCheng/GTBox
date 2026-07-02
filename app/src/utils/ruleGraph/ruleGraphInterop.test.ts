import { describe, expect, it } from "vitest";
import type { RuleGraph } from "../../types/ruleGraph";
import g01 from "../../../../regex-test-data/01-default-non-empty-line.json";
import g02 from "../../../../regex-test-data/02-numbered-list.json";
import g03 from "../../../../regex-test-data/03-playlist-split.json";
import g04 from "../../../../regex-test-data/04-playlist-sequence.json";
import g05 from "../../../../regex-test-data/05-email-regex.json";
import g06 from "../../../../regex-test-data/06-phone-cn-regex.json";
import g07 from "../../../../regex-test-data/07-url-regex.json";
import g08 from "../../../../regex-test-data/08-id-card-regex.json";
import g09 from "../../../../regex-test-data/09-email-or-url-line.json";
import { compareWithRuleGraph } from "./compareRuleGraph";
import {
  createDefaultRuleGraph,
  createNumberedListRuleGraph,
  createPlaylistRuleGraph,
  createPlaylistSequenceRuleGraph,
} from "./defaultGraph";
import {
  createFormatTemplateGraph,
  type FormatTemplateId,
} from "./formatTemplates";
import { parseRuleGraphJson, serializeRuleGraph } from "./ruleGraphIo";
import { isGraphExportable } from "./validateGraphForBuilder";

const testDataGraphs: Array<[string, RuleGraph]> = [
  ["01-default-non-empty-line.json", g01 as RuleGraph],
  ["02-numbered-list.json", g02 as RuleGraph],
  ["03-playlist-split.json", g03 as RuleGraph],
  ["04-playlist-sequence.json", g04 as RuleGraph],
  ["05-email-regex.json", g05 as RuleGraph],
  ["06-phone-cn-regex.json", g06 as RuleGraph],
  ["07-url-regex.json", g07 as RuleGraph],
  ["08-id-card-regex.json", g08 as RuleGraph],
  ["09-email-or-url-line.json", g09 as RuleGraph],
];

const builtinGraphs: Array<[string, () => RuleGraph]> = [
  ["default", createDefaultRuleGraph],
  ["numbered-list", createNumberedListRuleGraph],
  ["playlist-split", createPlaylistRuleGraph],
  ["playlist-sequence", createPlaylistSequenceRuleGraph],
];

const formatIds: FormatTemplateId[] = ["email", "url", "phone_cn", "id_card_cn"];

function assertRoundTrip(graph: RuleGraph) {
  const raw = serializeRuleGraph(graph);
  const roundTrip = parseRuleGraphJson(raw);
  expect(roundTrip.version).toBe(graph.version);
  expect(roundTrip.nodes).toHaveLength(graph.nodes.length);
  expect(roundTrip.edges).toHaveLength(graph.edges.length);
  expect(roundTrip.nodes.map((n) => n.id).sort()).toEqual(graph.nodes.map((n) => n.id).sort());
  for (const node of graph.nodes) {
    const rt = roundTrip.nodes.find((n) => n.id === node.id);
    expect(rt?.type).toBe(node.type);
    expect(rt?.params).toEqual(node.params);
  }
}

describe("规则图 JSON 互通回归", () => {
  describe("regex-test-data", () => {
    for (const [file, graph] of testDataGraphs) {
      it(`${file} JSON 往返`, () => {
        assertRoundTrip(graph);
      });

      it(`${file} 正则生成可导出`, () => {
        expect(isGraphExportable(graph)).toBe(true);
      });

      it(`${file} 文本比对可执行`, () => {
        const roundTrip = parseRuleGraphJson(serializeRuleGraph(graph));
        expect(() => compareWithRuleGraph(roundTrip, "sample text")).not.toThrow();
      });
    }
  });

  describe("内置模板", () => {
    for (const [name, factory] of builtinGraphs) {
      it(`${name} JSON 往返且可导出`, () => {
        const graph = factory();
        assertRoundTrip(graph);
        expect(isGraphExportable(graph)).toBe(true);
      });
    }

    for (const id of formatIds) {
      for (const variant of ["blocks", "regex"] as const) {
        it(`${id} ${variant} JSON 往返且可导出`, () => {
          const graph = createFormatTemplateGraph(id, variant);
          assertRoundTrip(graph);
          expect(isGraphExportable(graph)).toBe(true);
        });
      }
    }
  });
});
