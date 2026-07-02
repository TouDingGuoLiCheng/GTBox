<script setup lang="ts">
import { Handle, Position, type NodeProps } from "@vue-flow/core";
import { computed } from "vue";
import type { GroupParams } from "../../../types/ruleGraph";
import type { RuleFlowNodeData } from "../../../utils/ruleGraph/flowAdapter";

const props = defineProps<NodeProps<RuleFlowNodeData>>();

/** 与 .rule-flow-node height 保持一致 */
const NODE_HEIGHT_REM = 3.75;

function handlePositionStyle(index: number, total: number): { top: string } {
  if (total <= 1) return { top: "50%" };
  if (total === 2) {
    return { top: index === 0 ? "28%" : "72%" };
  }
  const pct = ((index + 1) / (total + 1)) * 100;
  return { top: `${pct}%` };
}

/** 同侧相邻端口中心间距（rem） */
function adjacentPortGapRem(total: number): number {
  if (total <= 1) return NODE_HEIGHT_REM;
  if (total === 2) return NODE_HEIGHT_REM * 0.44;
  return NODE_HEIGHT_REM / (total + 1);
}

/** 同侧多端口时收窄垂直热区，避免上下端口互相抢点击 */
function handleHitVars(_index: number, total: number): Record<string, string> {
  const outward = "1.5rem";
  const inward = "0.625rem";
  if (total <= 1) {
    return { "--hit-w-out": outward, "--hit-w-in": inward, "--hit-h": "1.35rem" };
  }
  const gapRem = adjacentPortGapRem(total);
  const hitH = Math.max(0.7, gapRem - 0.45);
  return { "--hit-w-out": outward, "--hit-w-in": inward, "--hit-h": `${hitH}rem` };
}

function handleStyle(index: number, total: number): Record<string, string> {
  return { ...handlePositionStyle(index, total), ...handleHitVars(index, total) };
}

const inputs = computed(() => props.data.inputs ?? []);
const outputs = computed(() => props.data.outputs ?? []);
</script>

<template>
  <div
    class="rule-flow-node ui-matte-node"
    :class="[
      `cat-${props.data.category}`,
      {
        'is-selected': props.selected,
        'is-segment': props.data.inSegmentChain || props.data.useSegmentPorts,
        'is-group-collapsed':
          props.data.ruleType === 'group' && (props.data.params as GroupParams).collapsed,
      },
    ]"
  >
    <Handle
      v-for="(input, index) in inputs"
      :id="input.id"
      :key="`in-${input.id}`"
      type="target"
      :position="Position.Left"
      class="rule-handle rule-handle-in"
      :class="{ 'rule-handle--segment': input.kind === 'segment' }"
      :style="handleStyle(index, inputs.length)"
    />
    <div class="rule-flow-node__body">
      <div class="rule-flow-node__title-row">
        <span v-if="props.data.inSegmentChain || props.data.useSegmentPorts" class="rule-flow-node__badge">段内</span>
        <div class="rule-flow-node__label">
          {{ props.data.label }}
        </div>
      </div>
      <div class="rule-flow-node__hint" :class="{ 'is-empty': !props.data.hint }">
        {{ props.data.hint || " " }}
      </div>
    </div>
    <Handle
      v-for="(output, index) in outputs"
      :id="output.id"
      :key="`out-${output.id}`"
      type="source"
      :position="Position.Right"
      class="rule-handle rule-handle-out"
      :class="{ 'rule-handle--segment': output.kind === 'segment' }"
      :style="handleStyle(index, outputs.length)"
    />
  </div>
</template>

<style scoped>
.rule-flow-node {
  min-width: 7.5rem;
  max-width: 11rem;
  height: 3.75rem;
  box-sizing: border-box;
  border-radius: 0.625rem;
  border: 1px solid rgb(63 63 70);
  background: rgb(24 24 27 / 0.95);
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.35);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.rule-flow-node.is-selected {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 50%, transparent);
}
.rule-flow-node.cat-structure {
  border-color: color-mix(in srgb, var(--rule-structure-border) 45%, rgb(63 63 70));
}
.rule-flow-node.cat-constraint {
  border-color: color-mix(in srgb, #a78bfa 35%, rgb(63 63 70));
}
.rule-flow-node.cat-count {
  border-color: color-mix(in srgb, #fbbf24 35%, rgb(63 63 70));
}
.rule-flow-node.cat-segment {
  border-color: color-mix(in srgb, var(--rule-segment-border) 45%, rgb(63 63 70));
}
.rule-flow-node.is-segment {
  border-color: color-mix(in srgb, var(--rule-segment-border) 55%, rgb(63 63 70));
}
.rule-flow-node.is-group-collapsed {
  border-style: dashed;
  opacity: 0.92;
}
.rule-flow-node__body {
  display: flex;
  height: 100%;
  flex-direction: column;
  justify-content: center;
  padding: 0.375rem 0.75rem;
  box-sizing: border-box;
}
.rule-flow-node__title-row {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  min-width: 0;
}
.rule-flow-node__badge {
  flex-shrink: 0;
  border-radius: 0.25rem;
  background: color-mix(in srgb, var(--rule-segment-border) 22%, rgb(24 24 27));
  padding: 0 0.25rem;
  font-size: 0.5625rem;
  font-weight: 600;
  line-height: 1.25rem;
  color: rgb(74 222 128);
}
.rule-flow-node__label {
  min-width: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: rgb(228 228 231);
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rule-flow-node__hint {
  margin-top: 0.125rem;
  min-height: 0.875rem;
  font-size: 0.625rem;
  line-height: 1.25;
  color: rgb(161 161 170);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rule-flow-node__hint.is-empty {
  visibility: hidden;
}
:deep(.rule-handle) {
  width: 0.75rem;
  height: 0.75rem;
  border: 2px solid rgb(39 39 42);
  background: var(--rule-port-predicate);
  transform: translateY(-50%);
}
:deep(.rule-handle--segment) {
  background: var(--rule-port-segment);
}
:deep(.rule-handle)::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  width: calc(var(--hit-w-in, 0.625rem) + var(--hit-w-out, 1.5rem));
  height: var(--hit-h, 1.35rem);
  transform: translateY(-50%);
  pointer-events: all;
  border-radius: 0.375rem;
}
:deep(.rule-handle-in)::before {
  transform: translate(calc(-1 * var(--hit-w-out, 1.5rem)), -50%);
}
:deep(.rule-handle-out)::before {
  transform: translate(calc(-1 * var(--hit-w-in, 0.625rem)), -50%);
}
</style>
