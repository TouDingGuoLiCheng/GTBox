<script setup lang="ts">
import { Icon } from "@iconify/vue";
import { invoke } from "@tauri-apps/api/core";
import { ref } from "vue";

const targetText = defineModel<string>("targetText", { required: true });
const candidateText = defineModel<string>("candidateText", { required: true });
const targetFile = defineModel<string>("targetFile", { default: "" });
const candidateFile = defineModel<string>("candidateFile", { default: "" });

const props = withDefaults(
  defineProps<{
    targetLabel?: string;
    candidateLabel?: string;
    targetPlaceholder?: string;
    candidatePlaceholder?: string;
    targetMultiline?: boolean;
    candidateMultiline?: boolean;
    showFileImport?: boolean;
  }>(),
  {
    targetLabel: "目标项",
    candidateLabel: "待比对项",
    targetPlaceholder: "粘贴或输入内容…",
    candidatePlaceholder: "粘贴或输入内容…",
    targetMultiline: true,
    candidateMultiline: true,
    showFileImport: true,
  },
);

const picking = ref<"target" | "candidate" | null>(null);
const pickError = ref<string | null>(null);

function fileName(path: string) {
  if (!path) return "";
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? path;
}

async function pickTextFile(side: "target" | "candidate") {
  if (picking.value) return;
  picking.value = side;
  pickError.value = null;
  try {
    const path = await invoke<string | null>("pick_song_list_file");
    if (!path) return;
    const content = await invoke<string>("read_text_file", { path });
    if (side === "target") {
      targetFile.value = path;
      targetText.value = content;
    } else {
      candidateFile.value = path;
      candidateText.value = content;
    }
  } catch (err) {
    pickError.value = err instanceof Error ? err.message : String(err);
  } finally {
    picking.value = null;
  }
}

function clearFile(side: "target" | "candidate") {
  if (side === "target") {
    targetFile.value = "";
  } else {
    candidateFile.value = "";
  }
}
</script>

<template>
  <div class="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
    <div class="flex min-h-0 flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <span class="text-sm font-medium text-zinc-300">{{ props.targetLabel }}</span>
        <button
          v-if="showFileImport"
          type="button"
          class="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-white/5 disabled:opacity-50"
          :disabled="!!picking"
          @click="pickTextFile('target')"
        >
          <Icon icon="mdi:file-import-outline" />
          {{ picking === "target" ? "选择中…" : "导入文件" }}
        </button>
      </div>
      <input
        v-if="!targetMultiline"
        v-model="targetText"
        type="text"
        class="field-input font-mono text-sm"
        :placeholder="targetPlaceholder"
      />
      <textarea
        v-else
        v-model="targetText"
        class="field-textarea min-h-[12rem] flex-1"
        :placeholder="targetPlaceholder"
      />
      <p v-if="targetFile" class="flex items-center gap-2 text-xs text-zinc-500">
        <Icon icon="mdi:paperclip" class="shrink-0" />
        <span class="min-w-0 truncate" :title="targetFile">{{ fileName(targetFile) }}</span>
        <button type="button" class="shrink-0 text-zinc-600 hover:text-zinc-300" @click="clearFile('target')">
          清除
        </button>
      </p>
    </div>

    <div class="flex min-h-0 flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <span class="text-sm font-medium text-zinc-300">{{ props.candidateLabel }}</span>
        <button
          v-if="showFileImport"
          type="button"
          class="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-white/5 disabled:opacity-50"
          :disabled="!!picking"
          @click="pickTextFile('candidate')"
        >
          <Icon icon="mdi:file-import-outline" />
          {{ picking === "candidate" ? "选择中…" : "导入文件" }}
        </button>
      </div>
      <input
        v-if="!candidateMultiline"
        v-model="candidateText"
        type="text"
        class="field-input font-mono text-sm"
        :placeholder="candidatePlaceholder"
      />
      <textarea
        v-else
        v-model="candidateText"
        class="field-textarea min-h-[12rem] flex-1"
        :placeholder="candidatePlaceholder"
      />
      <p v-if="candidateFile" class="flex items-center gap-2 text-xs text-zinc-500">
        <Icon icon="mdi:paperclip" class="shrink-0" />
        <span class="min-w-0 truncate" :title="candidateFile">{{ fileName(candidateFile) }}</span>
        <button
          type="button"
          class="shrink-0 text-zinc-600 hover:text-zinc-300"
          @click="clearFile('candidate')"
        >
          清除
        </button>
      </p>
    </div>

    <p v-if="pickError" class="text-xs text-rose-400 lg:col-span-2">{{ pickError }}</p>
  </div>
</template>

<style scoped>
.field-input,
.field-textarea {
  width: 100%;
  border-radius: 0.5rem;
  border: 1px solid var(--color-border);
  background: rgb(0 0 0 / 0.3);
  padding: 0.625rem 0.75rem;
  font-size: 0.875rem;
  color: rgb(212 212 216);
  resize: vertical;
}
.field-textarea {
  min-height: 12rem;
  line-height: 1.5;
}
.field-input:focus,
.field-textarea:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border));
}
</style>
