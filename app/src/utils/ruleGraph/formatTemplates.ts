import type { RuleEdge, RuleGraph, RuleNode } from "../../types/ruleGraph";
import { createNode, resetRuleGraphIdCounter } from "./defaultGraph";

export type FormatTemplateId = "email" | "url" | "phone_cn" | "id_card_cn";
export type FormatTemplateVariant = "blocks" | "regex";

export interface FormatTemplateMenuItem {
  id: FormatTemplateId;
  variant: FormatTemplateVariant;
  label: string;
  icon: string;
}

export const FORMAT_TEMPLATE_DEFS: FormatTemplateMenuItem[] = [
  { id: "email", variant: "blocks", label: "邮箱 · 积木", icon: "mdi:email-outline" },
  { id: "email", variant: "regex", label: "邮箱 · 正则", icon: "mdi:email-outline" },
  { id: "url", variant: "blocks", label: "URL · 积木", icon: "mdi:link-variant" },
  { id: "url", variant: "regex", label: "URL · 正则", icon: "mdi:link-variant" },
  { id: "phone_cn", variant: "blocks", label: "手机号 · 积木", icon: "mdi:cellphone" },
  { id: "phone_cn", variant: "regex", label: "手机号 · 正则", icon: "mdi:cellphone" },
  { id: "id_card_cn", variant: "blocks", label: "身份证 · 积木", icon: "mdi:card-account-details-outline" },
  { id: "id_card_cn", variant: "regex", label: "身份证 · 正则", icon: "mdi:card-account-details-outline" },
];

const PATTERNS: Record<FormatTemplateId, string> = {
  email: String.raw`[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}`,
  url: String.raw`https?://[^\s]+`,
  phone_cn: String.raw`1[3-9]\d{9}`,
  id_card_cn: String.raw`[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]`,
};

function wireSegmentChain(chain: RuleNode[]): RuleEdge[] {
  const edges: RuleEdge[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    edges.push({
      id: `edge_seg_${i}`,
      source: chain[i]!.id,
      sourceHandle: "next",
      target: chain[i + 1]!.id,
      targetHandle: "segment_in",
    });
  }
  return edges;
}

function createScopeRoot(): { scope: RuleNode; root: RuleNode } {
  return {
    scope: createNode("scope", { x: 360, y: 120 }, { mode: "line" }),
    root: createNode("root", { x: 540, y: 120 }),
  };
}

function finalizePredicateGraph(nodes: RuleNode[], predicateId: string): RuleGraph {
  const { scope, root } = createScopeRoot();
  return {
    version: 1,
    nodes: [...nodes, scope, root],
    edges: [
      {
        id: "edge_predicate",
        source: predicateId,
        sourceHandle: "out",
        target: scope.id,
        targetHandle: "predicate",
      },
      {
        id: "edge_root",
        source: scope.id,
        sourceHandle: "bool",
        target: root.id,
        targetHandle: "in",
      },
    ],
  };
}

function finalizeSegmentGraph(chain: RuleNode[]): RuleGraph {
  const { scope, root } = createScopeRoot();
  const tail = chain[chain.length - 1]!;
  const edges = [
    ...wireSegmentChain(chain),
    {
      id: "edge_predicate",
      source: tail.id,
      sourceHandle: "out",
      target: scope.id,
      targetHandle: "predicate",
    },
    {
      id: "edge_root",
      source: scope.id,
      sourceHandle: "bool",
      target: root.id,
      targetHandle: "in",
    },
  ];
  return { version: 1, nodes: [...chain, scope, root], edges };
}

function createRegexLineGraph(pattern: string, ignoreCase = false): RuleGraph {
  resetRuleGraphIdCounter();
  const regex = createNode("regex", { x: 40, y: 100 }, { pattern, ignoreCase });
  return finalizePredicateGraph([regex], regex.id);
}

function createPhoneBlocksGraph(): RuleGraph {
  resetRuleGraphIdCounter();
  const one = createNode(
    "matches_text",
    { x: 0, y: 60 },
    { text: "1", ignoreCase: false, builderMode: "segment" },
  );
  const second = createNode(
    "position_char",
    { x: 120, y: 60 },
    { mode: "range", literal: "", rangeFrom: "3", rangeTo: "9" },
  );
  const rest = createNode("char_run", { x: 240, y: 60 }, { kind: "digit", n: 9 });
  return finalizeSegmentGraph([one, second, rest]);
}

function createEmailBlocksGraph(): RuleGraph {
  resetRuleGraphIdCounter();
  const split = createNode("split_pattern", { x: 0, y: 80 }, { separator: "@", parts: 2 });
  const dot = createNode("contains", { x: 0, y: 160 }, { text: ".", ignoreCase: false });
  const and = createNode("and", { x: 180, y: 120 });
  const { scope, root } = createScopeRoot();
  return {
    version: 1,
    nodes: [split, dot, and, scope, root],
    edges: [
      {
        id: "edge_split_and",
        source: split.id,
        sourceHandle: "out",
        target: and.id,
        targetHandle: "in",
      },
      {
        id: "edge_dot_and",
        source: dot.id,
        sourceHandle: "out",
        target: and.id,
        targetHandle: "in",
      },
      {
        id: "edge_predicate",
        source: and.id,
        sourceHandle: "out",
        target: scope.id,
        targetHandle: "predicate",
      },
      {
        id: "edge_root",
        source: scope.id,
        sourceHandle: "bool",
        target: root.id,
        targetHandle: "in",
      },
    ],
  };
}

function createUrlBlocksGraph(): RuleGraph {
  resetRuleGraphIdCounter();
  const starts = createNode(
    "starts_with",
    { x: 40, y: 100 },
    { preset: "text", text: "http", ignoreCase: true },
  );
  return finalizePredicateGraph([starts], starts.id);
}

function createIdCardBlocksGraph(): RuleGraph {
  resetRuleGraphIdCounter();
  const first = createNode(
    "position_char",
    { x: 0, y: 60 },
    { mode: "range", literal: "", rangeFrom: "1", rangeTo: "9" },
  );
  const area = createNode("char_run", { x: 120, y: 60 }, { kind: "digit", n: 5 });
  const body = createNode("char_run", { x: 240, y: 60 }, { kind: "digit", n: 11 });
  const check = createNode(
    "char_class_seg",
    { x: 360, y: 60 },
    { preset: "custom", customClass: "0-9Xx", quantifier: "one" },
  );
  return finalizeSegmentGraph([first, area, body, check]);
}

const BLOCK_BUILDERS: Record<FormatTemplateId, () => RuleGraph> = {
  email: createEmailBlocksGraph,
  url: createUrlBlocksGraph,
  phone_cn: createPhoneBlocksGraph,
  id_card_cn: createIdCardBlocksGraph,
};

export function createFormatTemplateGraph(
  id: FormatTemplateId,
  variant: FormatTemplateVariant = "blocks",
): RuleGraph {
  if (variant === "regex") {
    return createRegexLineGraph(PATTERNS[id]);
  }
  return BLOCK_BUILDERS[id]();
}

/** 供 regex-test-data 与单测使用的积木版图 */
export function createFormatTemplateBlocksGraph(id: FormatTemplateId): RuleGraph {
  return createFormatTemplateGraph(id, "blocks");
}
