<script setup lang="ts">
import type {
  CompareMode,
  FullTextOptions,
  LineCompareOptions,
  RegexCompareOptions,
} from "../../types/textCompare";

defineProps<{
  mode: CompareMode;
  fullText: FullTextOptions;
  line: LineCompareOptions;
  regex: RegexCompareOptions;
}>();
</script>

<template>
  <div class="rounded-xl border border-border bg-black/20 p-4">
    <div class="mb-3 text-sm font-medium text-zinc-300">比对选项</div>

    <div v-if="mode === 'full'" class="flex flex-col gap-2.5">
      <p class="text-xs text-zinc-500">默认严格一致；勾选后放宽对应差异。</p>
      <label class="option-row">
        <input v-model="fullText.normalizeLineEndings" type="checkbox" class="accent-accent" />
        统一换行符（\r\n 与 \n 视为相同）
      </label>
      <label class="option-row">
        <input v-model="fullText.ignoreAllWhitespace" type="checkbox" class="accent-accent" />
        忽略全部空格
      </label>
      <label class="option-row">
        <input v-model="fullText.ignoreFinalNewline" type="checkbox" class="accent-accent" />
        忽略文件末尾是否多一个换行
      </label>
      <label class="option-row">
        <input v-model="fullText.ignoreBom" type="checkbox" class="accent-accent" />
        忽略 UTF-8 BOM
      </label>
    </div>

    <div v-else-if="mode === 'line'" class="flex flex-col gap-3">
      <div class="flex flex-col gap-2.5">
        <label class="option-row">
          <input v-model="line.ignoreOrder" type="checkbox" class="accent-accent" />
          忽略顺序
        </label>
        <label class="option-row">
          <input v-model="line.trimWhitespace" type="checkbox" class="accent-accent" />
          去空格（忽略首尾空格）
        </label>
        <label class="option-row">
          <input v-model="line.ignoreCase" type="checkbox" class="accent-accent" />
          忽略大小写
        </label>
      </div>
      <div>
        <span class="mb-2 block text-xs text-zinc-500">重复行策略</span>
        <div class="flex flex-col gap-2 sm:flex-row sm:gap-4">
          <label class="option-row">
            <input v-model="line.duplicateMode" type="radio" value="count" class="accent-accent" />
            按出现次数匹配
          </label>
          <label class="option-row">
            <input v-model="line.duplicateMode" type="radio" value="existence" class="accent-accent" />
            只关心是否存在
          </label>
        </div>
      </div>
    </div>

    <div v-else class="text-xs text-zinc-500">
      递归比对目录结构与每个文件内容。
    </div>
  </div>
</template>

<style scoped>
.option-row {
  display: flex;
  cursor: pointer;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: rgb(212 212 216);
}
</style>
