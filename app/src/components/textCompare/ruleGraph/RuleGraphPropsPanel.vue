<script setup lang="ts">
import { computed } from "vue";
import type { RuleNode, RuleNodeParams } from "../../../types/ruleGraph";
import { getNodeDef } from "../../../utils/ruleGraph/nodeDefs";

const props = defineProps<{
  node: RuleNode | null;
  inSegmentChain?: boolean;
}>();

const emit = defineEmits<{
  "update:params": [params: RuleNode["params"]];
}>();

const nodeType = computed(() => props.node?.type ?? null);

const defLabel = computed(() =>
  nodeType.value ? getNodeDef(nodeType.value).label : "",
);

const p = computed(() => (props.node?.params ?? {}) as Record<string, unknown>);
const builderMode = computed(() =>
  strParam("builderMode", "line") === "segment" ? "segment" : "line",
);

function patchParams(partial: Record<string, unknown>) {
  emit("update:params", { ...(props.node?.params ?? {}), ...partial } as RuleNodeParams);
}

function boolParam(key: string): boolean {
  return !!p.value[key];
}

function strParam(key: string, fallback = ""): string {
  const v = p.value[key];
  return typeof v === "string" ? v : fallback;
}

function numParam(key: string, fallback: number): number {
  const v = p.value[key];
  return typeof v === "number" ? v : fallback;
}
</script>

<template>
  <div class="flex h-full flex-col gap-3 overflow-y-auto p-3">
    <template v-if="!node">
      <p class="text-xs text-zinc-500">点击画布中的节点以编辑参数</p>
    </template>

    <template v-else>
      <div>
        <div class="text-sm font-medium text-zinc-200">{{ defLabel }}</div>
        <div class="mt-0.5 font-mono text-[10px] text-zinc-600">{{ node.id }}</div>
        <p v-if="inSegmentChain" class="mt-1.5 text-xs text-emerald-400/90">
          当前处于顺序段链，语义为分段匹配（非整行相等）
        </p>
      </div>

      <template v-if="nodeType === 'scope'">
        <label class="field-label">作用范围</label>
        <select
          class="field-input"
          :value="strParam('mode', 'line')"
          @change="patchParams({ mode: ($event.target as HTMLSelectElement).value })"
        >
          <option value="line">每一行</option>
          <option value="non_empty_line">每一非空行</option>
          <option value="full">全文</option>
        </select>
      </template>

      <template v-else-if="nodeType === 'count'">
        <label class="field-label">构建模式</label>
        <select
          class="field-input"
          :value="builderMode"
          @change="patchParams({ builderMode: ($event.target as HTMLSelectElement).value })"
        >
          <option value="line">默认（整行）</option>
          <option value="segment">顺序（段内）</option>
        </select>
        <template v-if="builderMode === 'segment'">
          <p class="text-xs text-zinc-500">段链量词：作用于紧邻前一个段积木。</p>
          <label class="field-label">量词模式</label>
          <select
            class="field-input"
            :value="strParam('mode', 'at_least')"
            @change="patchParams({ mode: ($event.target as HTMLSelectElement).value })"
          >
            <option value="at_least">至少 N 次</option>
            <option value="at_most">至多 N 次</option>
            <option value="exactly">恰好 N 次</option>
          </select>
        </template>
        <template v-else>
          <label class="field-label">统计模式</label>
          <select
            class="field-input"
            :value="strParam('mode', 'all')"
            @change="patchParams({ mode: ($event.target as HTMLSelectElement).value })"
          >
            <option value="all">全部满足</option>
            <option value="at_least">至少 N 次</option>
            <option value="at_most">至多 N 次</option>
            <option value="exactly">恰好 N 次</option>
            <option value="global">全文至少 N 次</option>
          </select>
        </template>
        <label class="field-label">N</label>
        <input
          class="field-input"
          type="number"
          min="0"
          :value="numParam('n', 1)"
          @input="patchParams({ n: Number(($event.target as HTMLInputElement).value) })"
        />
      </template>

      <template
        v-else-if="
          nodeType === 'contains' ||
          nodeType === 'not_contains' ||
          nodeType === 'matches_text'
        "
      >
        <template v-if="nodeType === 'matches_text'">
          <label class="field-label">构建模式</label>
          <select
            class="field-input"
            :value="builderMode"
            @change="patchParams({ builderMode: ($event.target as HTMLSelectElement).value })"
          >
            <option value="line">默认（整行）</option>
            <option value="segment">顺序（段内）</option>
          </select>
        </template>
        <label class="field-label">文本</label>
        <input
          class="field-input"
          type="text"
          :value="strParam('text')"
          @input="patchParams({ text: ($event.target as HTMLInputElement).value })"
        />
        <label class="option-row">
          <input
            type="checkbox"
            class="accent-accent"
            :checked="boolParam('ignoreCase')"
            @change="patchParams({ ignoreCase: ($event.target as HTMLInputElement).checked })"
          />
          忽略大小写
        </label>
      </template>

      <template v-else-if="nodeType === 'starts_with' || nodeType === 'ends_with'">
        <label class="field-label">预设</label>
        <select
          class="field-input"
          :value="strParam('preset', 'text')"
          @change="patchParams({ preset: ($event.target as HTMLSelectElement).value })"
        >
          <option value="text">自定义文本</option>
          <option value="digit">数字</option>
          <option value="letter">字母</option>
        </select>
        <template v-if="strParam('preset', 'text') === 'text'">
          <label class="field-label">文本</label>
          <input
            class="field-input"
            type="text"
            :value="strParam('text')"
            @input="patchParams({ text: ($event.target as HTMLInputElement).value })"
          />
        </template>
        <label class="option-row">
          <input
            type="checkbox"
            class="accent-accent"
            :checked="boolParam('ignoreCase')"
            @change="patchParams({ ignoreCase: ($event.target as HTMLInputElement).checked })"
          />
          忽略大小写
        </label>
      </template>

      <template v-else-if="nodeType === 'split_parts' || nodeType === 'split_pattern'">
        <label class="field-label">分隔符</label>
        <input
          class="field-input"
          type="text"
          :value="strParam('separator', nodeType === 'split_pattern' ? '@' : ' - ')"
          @input="patchParams({ separator: ($event.target as HTMLInputElement).value })"
        />
        <label class="field-label">段数</label>
        <input
          class="field-input"
          type="number"
          min="1"
          :value="numParam('parts', 2)"
          @input="patchParams({ parts: Number(($event.target as HTMLInputElement).value) })"
        />
      </template>

      <template v-else-if="nodeType === 'position_char'">
        <label class="field-label">模式</label>
        <select
          class="field-input"
          :value="strParam('mode', 'range')"
          @change="patchParams({ mode: ($event.target as HTMLSelectElement).value })"
        >
          <option value="literal">固定字符</option>
          <option value="range">字符范围</option>
        </select>
        <template v-if="strParam('mode', 'range') === 'literal'">
          <label class="field-label">字符</label>
          <input
            class="field-input font-mono text-xs"
            type="text"
            maxlength="1"
            :value="strParam('literal')"
            @input="patchParams({ literal: ($event.target as HTMLInputElement).value })"
          />
        </template>
        <template v-else>
          <label class="field-label">范围起</label>
          <input
            class="field-input font-mono text-xs"
            type="text"
            maxlength="1"
            :value="strParam('rangeFrom', '0')"
            @input="patchParams({ rangeFrom: ($event.target as HTMLInputElement).value })"
          />
          <label class="field-label">范围止</label>
          <input
            class="field-input font-mono text-xs"
            type="text"
            maxlength="1"
            :value="strParam('rangeTo', '9')"
            @input="patchParams({ rangeTo: ($event.target as HTMLInputElement).value })"
          />
        </template>
      </template>

      <template v-else-if="nodeType === 'length'">
        <label class="field-label">最短</label>
        <input
          class="field-input"
          type="number"
          min="0"
          :value="numParam('min', 0)"
          @input="patchParams({ min: Number(($event.target as HTMLInputElement).value) })"
        />
        <label class="field-label">最长</label>
        <input
          class="field-input"
          type="number"
          min="0"
          :value="numParam('max', 10000)"
          @input="patchParams({ max: Number(($event.target as HTMLInputElement).value) })"
        />
      </template>

      <template v-else-if="nodeType === 'charset'">
        <label class="option-row">
          <input
            type="checkbox"
            class="accent-accent"
            :checked="boolParam('allowChinese')"
            @change="patchParams({ allowChinese: ($event.target as HTMLInputElement).checked })"
          />
          中文
        </label>
        <label class="option-row">
          <input
            type="checkbox"
            class="accent-accent"
            :checked="boolParam('allowLatin')"
            @change="patchParams({ allowLatin: ($event.target as HTMLInputElement).checked })"
          />
          英文
        </label>
        <label class="option-row">
          <input
            type="checkbox"
            class="accent-accent"
            :checked="boolParam('allowDigits')"
            @change="patchParams({ allowDigits: ($event.target as HTMLInputElement).checked })"
          />
          数字
        </label>
        <label class="option-row">
          <input
            type="checkbox"
            class="accent-accent"
            :checked="boolParam('allowPunctuation')"
            @change="patchParams({ allowPunctuation: ($event.target as HTMLInputElement).checked })"
          />
          标点与空格
        </label>
      </template>

      <template v-else-if="nodeType === 'regex'">
        <label class="field-label">正则 pattern</label>
        <input
          class="field-input font-mono text-xs"
          type="text"
          :value="strParam('pattern')"
          @input="patchParams({ pattern: ($event.target as HTMLInputElement).value })"
        />
        <label class="option-row">
          <input
            type="checkbox"
            class="accent-accent"
            :checked="boolParam('ignoreCase')"
            @change="patchParams({ ignoreCase: ($event.target as HTMLInputElement).checked })"
          />
          忽略大小写 (i)
        </label>
      </template>

      <template v-else-if="nodeType === 'space'">
        <p class="text-xs text-zinc-500">段链空格量词：匹配连续 ASCII 空格。</p>
        <label class="field-label">量词模式</label>
        <select
          class="field-input"
          :value="strParam('mode', 'exactly')"
          @change="patchParams({ mode: ($event.target as HTMLSelectElement).value })"
        >
          <option value="at_least">至少 N 个</option>
          <option value="at_most">至多 N 个</option>
          <option value="exactly">恰好 N 个</option>
        </select>
        <label class="field-label">N</label>
        <input
          class="field-input"
          type="number"
          min="0"
          :value="numParam('n', 1)"
          @input="patchParams({ n: Number(($event.target as HTMLInputElement).value) })"
        />
      </template>

      <template v-else-if="nodeType === 'char_run'">
        <label class="field-label">字符类型</label>
        <select
          class="field-input"
          :value="strParam('kind', 'digit')"
          @change="patchParams({ kind: ($event.target as HTMLSelectElement).value })"
        >
          <option value="digit">数字</option>
          <option value="letter">字母</option>
          <option value="word">单词字符</option>
          <option value="any">任意字符</option>
        </select>
        <label class="field-label">连续个数 N</label>
        <input
          class="field-input"
          type="number"
          min="0"
          :value="numParam('n', 1)"
          @input="patchParams({ n: Number(($event.target as HTMLInputElement).value) })"
        />
      </template>

      <template v-else-if="nodeType === 'char_class_seg'">
        <label class="field-label">字符类</label>
        <select
          class="field-input"
          :value="strParam('preset', 'digit')"
          @change="patchParams({ preset: ($event.target as HTMLSelectElement).value })"
        >
          <option value="digit">数字</option>
          <option value="letter">字母</option>
          <option value="alnum">字母+数字</option>
          <option value="custom">自定义</option>
        </select>
        <template v-if="strParam('preset', 'digit') === 'custom'">
          <label class="field-label">类内字符（不含 [ ] \\）</label>
          <input
            class="field-input font-mono text-xs"
            type="text"
            placeholder="如 3-9"
            :value="strParam('customClass')"
            @input="patchParams({ customClass: ($event.target as HTMLInputElement).value })"
          />
        </template>
        <label class="field-label">量词</label>
        <select
          class="field-input"
          :value="strParam('quantifier', 'one_or_more')"
          @change="patchParams({ quantifier: ($event.target as HTMLSelectElement).value })"
        >
          <option value="one">一位</option>
          <option value="one_or_more">一位或多位</option>
        </select>
      </template>

      <template v-else-if="nodeType === 'optional_seg'">
        <p class="text-xs text-zinc-500">使段链中下一段变为可选（?）。请在其后连接一个段积木。</p>
      </template>

      <template
        v-else-if="
          nodeType === 'and' ||
          nodeType === 'or' ||
          nodeType === 'not' ||
          nodeType === 'root' ||
          nodeType === 'non_empty'
        "
      >
        <template v-if="nodeType === 'non_empty'">
          <label class="field-label">构建模式</label>
          <select
            class="field-input"
            :value="builderMode"
            @change="patchParams({ builderMode: ($event.target as HTMLSelectElement).value })"
          >
            <option value="line">默认（整行）</option>
            <option value="segment">顺序（段内）</option>
          </select>
        </template>
        <p v-else class="text-xs text-zinc-500">此节点无需额外参数，通过连线组合即可。</p>
      </template>

      <template v-else-if="nodeType === 'group'">
        <label class="field-label">分组名称</label>
        <input
          class="field-input"
          type="text"
          placeholder="可选，便于识别"
          :value="strParam('label')"
          @input="patchParams({ label: ($event.target as HTMLInputElement).value })"
        />
        <label class="option-row mt-2">
          <input
            type="checkbox"
            class="accent-accent"
            :checked="boolParam('collapsed')"
            @change="patchParams({ collapsed: ($event.target as HTMLInputElement).checked })"
          />
          折叠内部连线（隐藏上游节点）
        </label>
      </template>
    </template>
  </div>
</template>

<style scoped>
.field-label {
  display: block;
  margin-bottom: 0.25rem;
  font-size: 0.6875rem;
  color: rgb(161 161 170);
}
.field-input {
  width: 100%;
  border-radius: 0.375rem;
  border: 1px solid var(--color-border);
  background: rgb(0 0 0 / 0.35);
  padding: 0.375rem 0.5rem;
  font-size: 0.8125rem;
  color: rgb(212 212 216);
}
.field-input:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border));
}
.option-row {
  display: flex;
  cursor: pointer;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: rgb(212 212 216);
}
</style>
