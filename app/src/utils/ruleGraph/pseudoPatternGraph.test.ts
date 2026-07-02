import { describe, expect, it } from "vitest";
import {
  createDefaultRuleGraph,
  createNumberedListRuleGraph,
  createPlaylistRuleGraph,
  createPlaylistSequenceRuleGraph,
} from "./defaultGraph";
import { pseudoPatternGraph } from "./pseudoPatternGraph";

describe("pseudoPatternGraph", () => {
  it("歌单顺序模板", () => {
    const graph = createPlaylistSequenceRuleGraph();
    expect(pseudoPatternGraph(graph)).toBe("【每行】X+□-□X+ 且 含「周杰伦」 且 不含「Live」");
  });

  it("默认模板", () => {
    const graph = createDefaultRuleGraph();
    expect(pseudoPatternGraph(graph)).toBe("【每行】非空");
  });

  it("旧歌单模板", () => {
    const graph = createPlaylistRuleGraph();
    expect(pseudoPatternGraph(graph)).toBe("【每非空行】非空 且 含「 - 」 且 拆「 - 」→2段");
  });

  it("编号列表模板", () => {
    const graph = createNumberedListRuleGraph();
    expect(pseudoPatternGraph(graph)).toBe("【每非空行】非空 且 起数字");
  });
});
