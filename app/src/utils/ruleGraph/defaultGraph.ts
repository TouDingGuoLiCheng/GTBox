import type { RuleGraph, RuleNode } from "../../types/ruleGraph";

let nextId = 0;

function uid(prefix: string): string {
  nextId += 1;
  return `${prefix}_${nextId}`;
}

/** 重置 ID 序列（仅测试用） */
export function resetRuleGraphIdCounter(): void {
  nextId = 0;
}

export function createNode(
  type: RuleNode["type"],
  position: { x: number; y: number },
  params?: RuleNode["params"],
): RuleNode {
  return {
    id: uid(type),
    type,
    position,
    params: params ?? {},
  };
}

/** 空白规则图：仅保留输出节点，便于从零搭建 */
export function createBlankRuleGraph(): RuleGraph {
  resetRuleGraphIdCounter();
  const root = createNode("root", { x: 200, y: 120 });
  return {
    version: 1,
    nodes: [root],
    edges: [],
  };
}

/** 默认规则图：每一行非空（TC-M3.5 画布初始态） */
export function createDefaultRuleGraph(): RuleGraph {
  resetRuleGraphIdCounter();

  const scope = createNode("scope", { x: 280, y: 120 }, { mode: "line" });
  const and = createNode("and", { x: 120, y: 120 });
  const nonEmpty = createNode("non_empty", { x: -40, y: 80 });
  const root = createNode("root", { x: 480, y: 120 });

  return {
    version: 1,
    nodes: [nonEmpty, and, scope, root],
    edges: [
      {
        id: uid("edge"),
        source: nonEmpty.id,
        sourceHandle: "out",
        target: and.id,
        targetHandle: "in",
      },
      {
        id: uid("edge"),
        source: and.id,
        sourceHandle: "out",
        target: scope.id,
        targetHandle: "predicate",
      },
      {
        id: uid("edge"),
        source: scope.id,
        sourceHandle: "bool",
        target: root.id,
        targetHandle: "in",
      },
    ],
  };
}

/** 歌单常用模板：每一行非空且包含分隔符并拆成 2 段 */
export function createPlaylistRuleGraph(): RuleGraph {
  resetRuleGraphIdCounter();

  const scope = createNode("scope", { x: 360, y: 140 }, { mode: "non_empty_line" });
  const and = createNode("and", { x: 180, y: 140 });
  const nonEmpty = createNode("non_empty", { x: 0, y: 60 });
  const contains = createNode("contains", { x: 0, y: 140 }, { text: " - ", ignoreCase: false });
  const split = createNode("split_parts", { x: 0, y: 220 }, { separator: " - ", parts: 2 });
  const root = createNode("root", { x: 540, y: 140 });

  return {
    version: 1,
    nodes: [nonEmpty, contains, split, and, scope, root],
    edges: [
      {
        id: uid("edge"),
        source: nonEmpty.id,
        sourceHandle: "out",
        target: and.id,
        targetHandle: "in",
      },
      {
        id: uid("edge"),
        source: contains.id,
        sourceHandle: "out",
        target: and.id,
        targetHandle: "in",
      },
      {
        id: uid("edge"),
        source: split.id,
        sourceHandle: "out",
        target: and.id,
        targetHandle: "in",
      },
      {
        id: uid("edge"),
        source: and.id,
        sourceHandle: "out",
        target: scope.id,
        targetHandle: "predicate",
      },
      {
        id: uid("edge"),
        source: scope.id,
        sourceHandle: "bool",
        target: root.id,
        targetHandle: "in",
      },
    ],
  };
}

/** 编号列表模板：每一非空行以数字开头 */
export function createNumberedListRuleGraph(): RuleGraph {
  resetRuleGraphIdCounter();

  const scope = createNode("scope", { x: 360, y: 140 }, { mode: "non_empty_line" });
  const and = createNode("and", { x: 180, y: 140 });
  const nonEmpty = createNode("non_empty", { x: 0, y: 100 });
  const startsWith = createNode(
    "starts_with",
    { x: 0, y: 180 },
    { preset: "digit", text: "", ignoreCase: false },
  );
  const root = createNode("root", { x: 540, y: 140 });

  return {
    version: 1,
    nodes: [nonEmpty, startsWith, and, scope, root],
    edges: [
      {
        id: uid("edge"),
        source: nonEmpty.id,
        sourceHandle: "out",
        target: and.id,
        targetHandle: "in",
      },
      {
        id: uid("edge"),
        source: startsWith.id,
        sourceHandle: "out",
        target: and.id,
        targetHandle: "in",
      },
      {
        id: uid("edge"),
        source: and.id,
        sourceHandle: "out",
        target: scope.id,
        targetHandle: "predicate",
      },
      {
        id: uid("edge"),
        source: scope.id,
        sourceHandle: "bool",
        target: root.id,
        targetHandle: "in",
      },
    ],
  };
}

/** 歌单教学模板：段链 + 组合条件（便于学习基础操作） */
export function createPlaylistSequenceRuleGraph(): RuleGraph {
  resetRuleGraphIdCounter();

  const segNonEmpty1 = createNode("non_empty", { x: -80, y: 20 }, { builderMode: "segment" });
  const segCount1 = createNode("count", { x: 40, y: 20 }, { builderMode: "segment", mode: "at_least", n: 1 });
  const segSpace1 = createNode("space", { x: 160, y: 20 }, { mode: "exactly", n: 1 });
  const segDash = createNode("matches_text", { x: 280, y: 20 }, { builderMode: "segment", text: "-", ignoreCase: false });
  const segSpace2 = createNode("space", { x: 400, y: 20 }, { mode: "exactly", n: 1 });
  const segNonEmpty2 = createNode("non_empty", { x: 520, y: 20 }, { builderMode: "segment" });
  const segCount2 = createNode("count", { x: 640, y: 20 }, { builderMode: "segment", mode: "at_least", n: 1 });

  const and = createNode("and", { x: 860, y: 120 });
  const contains = createNode("contains", { x: 640, y: 160 }, { text: "周杰伦", ignoreCase: false });
  const notContains = createNode("not_contains", { x: 640, y: 240 }, { text: "Live", ignoreCase: true });
  const scope = createNode("scope", { x: 1040, y: 120 }, { mode: "line" });
  const root = createNode("root", { x: 1220, y: 120 });

  return {
    version: 1,
    nodes: [
      segNonEmpty1,
      segCount1,
      segSpace1,
      segDash,
      segSpace2,
      segNonEmpty2,
      segCount2,
      contains,
      notContains,
      and,
      scope,
      root,
    ],
    edges: [
      {
        id: uid("edge"),
        source: segNonEmpty1.id,
        sourceHandle: "next",
        target: segCount1.id,
        targetHandle: "segment_in",
      },
      {
        id: uid("edge"),
        source: segCount1.id,
        sourceHandle: "next",
        target: segSpace1.id,
        targetHandle: "segment_in",
      },
      {
        id: uid("edge"),
        source: segSpace1.id,
        sourceHandle: "next",
        target: segDash.id,
        targetHandle: "segment_in",
      },
      {
        id: uid("edge"),
        source: segDash.id,
        sourceHandle: "next",
        target: segSpace2.id,
        targetHandle: "segment_in",
      },
      {
        id: uid("edge"),
        source: segSpace2.id,
        sourceHandle: "next",
        target: segNonEmpty2.id,
        targetHandle: "segment_in",
      },
      {
        id: uid("edge"),
        source: segNonEmpty2.id,
        sourceHandle: "next",
        target: segCount2.id,
        targetHandle: "segment_in",
      },
      {
        id: uid("edge"),
        source: segCount2.id,
        sourceHandle: "out",
        target: and.id,
        targetHandle: "in",
      },
      {
        id: uid("edge"),
        source: contains.id,
        sourceHandle: "out",
        target: and.id,
        targetHandle: "in",
      },
      {
        id: uid("edge"),
        source: notContains.id,
        sourceHandle: "out",
        target: and.id,
        targetHandle: "in",
      },
      {
        id: uid("edge"),
        source: and.id,
        sourceHandle: "out",
        target: scope.id,
        targetHandle: "predicate",
      },
      {
        id: uid("edge"),
        source: scope.id,
        sourceHandle: "bool",
        target: root.id,
        targetHandle: "in",
      },
    ],
  };
}
