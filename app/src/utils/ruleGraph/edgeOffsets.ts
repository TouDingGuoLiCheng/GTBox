import type { Edge } from "@vue-flow/core";

/** 同一目标端口多条连线时分配 edge 类型（直线，端口对齐后保持水平） */
export function withAdaptiveEdgeOffsets(edges: Edge[]): Edge[] {
  return edges.map((edge) => ({
    ...edge,
    type: "straight",
  }));
}

export function graphFingerprint(graph: { nodes: unknown[]; edges: unknown[]; version?: number }): string {
  return JSON.stringify(graph);
}
