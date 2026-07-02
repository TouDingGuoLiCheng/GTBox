<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useAppearanceStore } from "../../stores/appearance";
import { clearMediaDebug, mediaDebugState } from "../../utils/mediaDebug";

const appearance = useAppearanceStore();
const visible = computed(() => appearance.uiPreferences.mediaDebugOverlay);
const entries = computed(() => mediaDebugState.entries);
const listRef = ref<HTMLElement | null>(null);

function formatPayload(payload?: Record<string, unknown>): string {
  if (!payload) return "";
  try {
    return JSON.stringify(payload);
  } catch {
    return "[payload serialize failed]";
  }
}

function eventClass(event: string): string {
  const e = event.toLowerCase();
  if (e.includes("error") || e.includes("stderr") || e.includes("fail")) return "text-[#ff6b6b]";
  if (e.includes("ocr") || e.includes("scan") || e.includes("detect") || e.includes("recognize"))
    return "text-[#79c0ff]";
  if (e.includes("load") || e.includes("canplay") || e.includes("done") || e.includes("ok"))
    return "text-[#7ee787]";
  if (e.includes("update") || e.includes("mount") || e.includes("start") || e.includes("phase"))
    return "text-[#f2cc60]";
  return "text-[#e6edf3]";
}

watch(
  () => entries.value.length,
  () => {
    void nextTick(() => {
      if (!listRef.value) return;
      listRef.value.scrollTop = listRef.value.scrollHeight;
    });
  },
);
</script>

<template>
  <div
    v-if="visible"
    class="fixed bottom-3 right-3 z-[500] w-[min(52vw,720px)] overflow-hidden rounded border border-[#3d444d] bg-[#0d1117] font-mono text-[12px] text-[#e6edf3] shadow-2xl"
  >
    <div class="flex items-center justify-between border-b border-[#30363d] px-3 py-2">
      <p class="font-medium tracking-wide text-[#f0f6fc]">PS GLCToolBox&gt; 调试终端</p>
      <button
        type="button"
        class="rounded border border-[#30363d] px-2 py-0.5 text-[11px] text-[#e6edf3] transition hover:bg-[#161b22]"
        @click="clearMediaDebug()"
      >
        clear
      </button>
    </div>
    <div ref="listRef" class="max-h-80 overflow-y-auto px-3 py-2">
      <p v-if="!entries.length" class="text-[#8b949e]">PS&gt; 等待日志…（设置中开启「显示调试终端」）</p>
      <div
        v-for="(item, idx) in entries"
        :key="`${item.time}-${item.source}-${item.event}-${idx}`"
        class="mb-1.5 break-all leading-5"
      >
        <p>
          <span class="text-[#8b949e]">[{{ item.time }}]</span>
          <span class="ml-1 text-[#79c0ff]">{{ item.source }}</span>
          <span class="mx-1 text-[#8b949e]">::</span>
          <span :class="eventClass(item.event)">{{ item.event }}</span>
        </p>
        <p v-if="item.detail" class="pl-4 text-[#c9d1d9]">{{ item.detail }}</p>
        <p v-if="item.payload" class="pl-4 text-[#8b949e]">{{ formatPayload(item.payload) }}</p>
      </div>
    </div>
  </div>
</template>
