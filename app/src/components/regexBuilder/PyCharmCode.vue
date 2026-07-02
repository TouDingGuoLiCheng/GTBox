<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  code: string;
}>();

/** 简易 PyCharm Darcula 风格高亮 */
const highlighted = computed(() => {
  const escaped = props.code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped
    .replace(/\b(import)\b/g, '<span class="py-kw">$1</span>')
    .replace(/\b(re)\b/g, '<span class="py-mod">$1</span>')
    .replace(/\b(compile)\b/g, '<span class="py-fn">$1</span>')
    .replace(/\b(IGNORECASE|MULTILINE|DOTALL)\b/g, '<span class="py-const">$1</span>')
    .replace(/(r"[^"\\]*(?:\\.[^"\\]*)*")/g, '<span class="py-str">$1</span>')
    .replace(/(r'[^'\\]*(?:\\.[^'\\]*)*')/g, '<span class="py-str">$1</span>');
});
</script>

<template>
  <pre class="pycharm-code overflow-x-auto rounded-lg p-3 font-mono text-xs leading-relaxed" v-html="highlighted" />
</template>

<style scoped>
.pycharm-code {
  background: #2b2b2b;
  color: #a9b7c6;
}
:deep(.py-kw) {
  color: #cc7832;
  font-weight: 500;
}
:deep(.py-mod) {
  color: #9876aa;
}
:deep(.py-fn) {
  color: #ffc66d;
}
:deep(.py-const) {
  color: #9876aa;
}
:deep(.py-str) {
  color: #6a8759;
}
</style>
