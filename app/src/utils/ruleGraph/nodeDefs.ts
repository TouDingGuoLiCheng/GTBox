import type { NodeType, PortKind, RuleNode } from "../../types/ruleGraph";

export interface PortDef {
  id: string;
  kind: PortKind;
  /** 最大连接数；undefined 表示不限 */
  max?: number;
  /** 是否允许多条边接入同一端口 */
  multiple?: boolean;
}

export interface NodeDef {
  type: NodeType;
  label: string;
  category: "structure" | "constraint" | "count" | "segment";
  inputs: PortDef[];
  outputs: PortDef[];
  defaultParams: RuleNode["params"];
}

export const NODE_DEFS: Record<NodeType, NodeDef> = {
  root: {
    type: "root",
    label: "输出",
    category: "structure",
    inputs: [{ id: "in", kind: "bool", max: 1 }],
    outputs: [],
    defaultParams: {},
  },
  scope: {
    type: "scope",
    label: "作用范围",
    category: "structure",
    inputs: [{ id: "predicate", kind: "predicate", max: 1 }],
    outputs: [{ id: "bool", kind: "bool" }],
    defaultParams: { mode: "line" },
  },
  and: {
    type: "and",
    label: "且 (AND)",
    category: "structure",
    inputs: [{ id: "in", kind: "predicate", multiple: true }],
    outputs: [{ id: "out", kind: "predicate" }],
    defaultParams: {},
  },
  or: {
    type: "or",
    label: "或 (OR)",
    category: "structure",
    inputs: [{ id: "in", kind: "predicate", multiple: true }],
    outputs: [{ id: "out", kind: "predicate" }],
    defaultParams: {},
  },
  not: {
    type: "not",
    label: "非 (NOT)",
    category: "structure",
    inputs: [{ id: "in", kind: "predicate", max: 1 }],
    outputs: [{ id: "out", kind: "predicate" }],
    defaultParams: {},
  },
  group: {
    type: "group",
    label: "分组",
    category: "structure",
    inputs: [{ id: "in", kind: "predicate", max: 1 }],
    outputs: [{ id: "out", kind: "predicate" }],
    defaultParams: { label: "", collapsed: false },
  },
  sequence: {
    type: "sequence",
    label: "顺序",
    category: "structure",
    inputs: [{ id: "segment_in", kind: "segment", max: 1 }],
    outputs: [{ id: "predicate_out", kind: "predicate" }],
    defaultParams: {},
  },
  count: {
    type: "count",
    label: "匹配次数",
    category: "count",
    inputs: [
      { id: "predicate", kind: "predicate", max: 1 },
      { id: "segment_in", kind: "segment", max: 1 },
    ],
    outputs: [
      { id: "bool", kind: "bool" },
      { id: "out", kind: "predicate" },
      { id: "next", kind: "segment" },
    ],
    defaultParams: { mode: "all", n: 1, builderMode: "line" },
  },
  non_empty: {
    type: "non_empty",
    label: "非空",
    category: "constraint",
    inputs: [{ id: "segment_in", kind: "segment", max: 1 }],
    outputs: [
      { id: "out", kind: "predicate" },
      { id: "next", kind: "segment" },
    ],
    defaultParams: { builderMode: "line" },
  },
  contains: {
    type: "contains",
    label: "包含文本",
    category: "constraint",
    inputs: [],
    outputs: [{ id: "out", kind: "predicate" }],
    defaultParams: { text: "", ignoreCase: false, builderMode: "line" },
  },
  not_contains: {
    type: "not_contains",
    label: "不包含文本",
    category: "constraint",
    inputs: [],
    outputs: [{ id: "out", kind: "predicate" }],
    defaultParams: { text: "", ignoreCase: false },
  },
  starts_with: {
    type: "starts_with",
    label: "以…开头",
    category: "constraint",
    inputs: [],
    outputs: [{ id: "out", kind: "predicate" }],
    defaultParams: { preset: "text", text: "", ignoreCase: false },
  },
  ends_with: {
    type: "ends_with",
    label: "以…结尾",
    category: "constraint",
    inputs: [],
    outputs: [{ id: "out", kind: "predicate" }],
    defaultParams: { preset: "text", text: "", ignoreCase: false },
  },
  matches_text: {
    type: "matches_text",
    label: "等于文本",
    category: "constraint",
    inputs: [{ id: "segment_in", kind: "segment", max: 1 }],
    outputs: [
      { id: "out", kind: "predicate" },
      { id: "next", kind: "segment" },
    ],
    defaultParams: { text: "", ignoreCase: false },
  },
  split_parts: {
    type: "split_parts",
    label: "按分隔符拆段",
    category: "constraint",
    inputs: [],
    outputs: [{ id: "out", kind: "predicate" }],
    defaultParams: { separator: " - ", parts: 2 },
  },
  length: {
    type: "length",
    label: "长度范围",
    category: "constraint",
    inputs: [],
    outputs: [{ id: "out", kind: "predicate" }],
    defaultParams: { min: 1, max: 10_000 },
  },
  charset: {
    type: "charset",
    label: "允许字符集",
    category: "constraint",
    inputs: [],
    outputs: [{ id: "out", kind: "predicate" }],
    defaultParams: {
      allowChinese: true,
      allowLatin: true,
      allowDigits: true,
      allowPunctuation: true,
    },
  },
  regex: {
    type: "regex",
    label: "正则",
    category: "constraint",
    inputs: [],
    outputs: [{ id: "out", kind: "predicate" }],
    defaultParams: { pattern: "", ignoreCase: false },
  },
  space: {
    type: "space",
    label: "空格占位",
    category: "segment",
    inputs: [{ id: "segment_in", kind: "segment", max: 1 }],
    outputs: [{ id: "next", kind: "segment" }],
    defaultParams: { mode: "exactly", n: 1 },
  },
  char_run: {
    type: "char_run",
    label: "连续字符",
    category: "segment",
    inputs: [{ id: "segment_in", kind: "segment", max: 1 }],
    outputs: [
      { id: "out", kind: "predicate" },
      { id: "next", kind: "segment" },
    ],
    defaultParams: { kind: "digit", n: 1 },
  },
  char_class_seg: {
    type: "char_class_seg",
    label: "字符类段",
    category: "segment",
    inputs: [{ id: "segment_in", kind: "segment", max: 1 }],
    outputs: [
      { id: "out", kind: "predicate" },
      { id: "next", kind: "segment" },
    ],
    defaultParams: { preset: "digit", customClass: "", quantifier: "one_or_more" },
  },
  optional_seg: {
    type: "optional_seg",
    label: "可选段",
    category: "segment",
    inputs: [{ id: "segment_in", kind: "segment", max: 1 }],
    outputs: [{ id: "next", kind: "segment" }],
    defaultParams: {},
  },
  position_char: {
    type: "position_char",
    label: "固定位字符",
    category: "segment",
    inputs: [{ id: "segment_in", kind: "segment", max: 1 }],
    outputs: [
      { id: "out", kind: "predicate" },
      { id: "next", kind: "segment" },
    ],
    defaultParams: { mode: "range", literal: "", rangeFrom: "0", rangeTo: "9" },
  },
  split_pattern: {
    type: "split_pattern",
    label: "拆段正则",
    category: "constraint",
    inputs: [],
    outputs: [{ id: "out", kind: "predicate" }],
    defaultParams: { separator: "@", parts: 2 },
  },
};

export function getNodeDef(type: NodeType): NodeDef {
  return NODE_DEFS[type];
}

const DUAL_SEGMENT_TYPES: ReadonlySet<NodeType> = new Set(["non_empty", "matches_text", "count"]);

export { DUAL_SEGMENT_TYPES as DUAL_SEGMENT_NODE_TYPES };

/** 双模节点端口；count 按构建模式切换，其余双模节点蓝绿并存 */
export function resolveFlowPorts(
  type: NodeType,
  useSegmentPorts: boolean,
): { inputs: { id: string; kind: PortKind }[]; outputs: { id: string; kind: PortKind }[] } {
  const def = getNodeDef(type);
  const mapPort = (p: PortDef) => ({ id: p.id, kind: p.kind });

  if (type === "count") {
    if (useSegmentPorts) {
      return {
        inputs: def.inputs.filter((p) => p.kind === "segment").map(mapPort),
        outputs: def.outputs.filter((p) => p.id === "out" || p.id === "next").map(mapPort),
      };
    }
    return {
      inputs: def.inputs.filter((p) => p.kind === "predicate").map(mapPort),
      outputs: def.outputs.filter((p) => p.id === "bool").map(mapPort),
    };
  }

  return {
    inputs: def.inputs.map(mapPort),
    outputs: def.outputs.map(mapPort),
  };
}

export const PALETTE_GROUPS: { title: string; types: NodeType[] }[] = [
  {
    title: "结构",
    types: ["scope", "and", "or", "not", "group", "count", "root"],
  },
  {
    title: "段约束",
    types: ["space", "char_run", "char_class_seg", "optional_seg", "position_char"],
  },
  {
    title: "文本约束",
    types: [
      "non_empty",
      "contains",
      "not_contains",
      "matches_text",
      "starts_with",
      "ends_with",
    ],
  },
  {
    title: "结构约束",
    types: ["split_parts", "split_pattern", "length", "charset", "regex"],
  },
];
