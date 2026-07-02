<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { ref } from "vue";

const targetFolder = defineModel<string>("targetFolder", { required: true });
const candidateFolder = defineModel<string>("candidateFolder", { required: true });

const picking = ref<"target" | "candidate" | null>(null);
const pickError = ref<string | null>(null);

async function pickFolder(side: "target" | "candidate") {
  if (picking.value) return;
  picking.value = side;
  pickError.value = null;
  try {
    const path = await invoke<string | null>("pick_folder");
    if (!path) return;
    if (side === "target") {
      targetFolder.value = path;
    } else {
      candidateFolder.value = path;
    }
  } catch (err) {
    pickError.value = err instanceof Error ? err.message : String(err);
  } finally {
    picking.value = null;
  }
}
</script>

<template>
  <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
    <label class="field-cell">
      <span class="field-label">目标文件夹</span>
      <div class="flex gap-2">
        <input
          v-model="targetFolder"
          type="text"
          class="field-input min-w-0 flex-1"
          placeholder="选择或粘贴文件夹路径"
        />
        <button
          type="button"
          class="field-btn"
          :disabled="!!picking"
          @click="pickFolder('target')"
        >
          {{ picking === "target" ? "选择中…" : "浏览" }}
        </button>
      </div>
    </label>

    <label class="field-cell">
      <span class="field-label">待比对文件夹</span>
      <div class="flex gap-2">
        <input
          v-model="candidateFolder"
          type="text"
          class="field-input min-w-0 flex-1"
          placeholder="选择或粘贴文件夹路径"
        />
        <button
          type="button"
          class="field-btn"
          :disabled="!!picking"
          @click="pickFolder('candidate')"
        >
          {{ picking === "candidate" ? "选择中…" : "浏览" }}
        </button>
      </div>
    </label>

    <p v-if="pickError" class="text-xs text-rose-400 lg:col-span-2">{{ pickError }}</p>
  </div>
</template>

<style scoped>
.field-cell {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.field-label {
  font-size: 0.75rem;
  color: rgb(161 161 170);
}
.field-input {
  width: 100%;
  border-radius: 0.5rem;
  border: 1px solid var(--color-border);
  background: rgb(0 0 0 / 0.3);
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  color: rgb(212 212 216);
}
.field-btn {
  flex-shrink: 0;
  border-radius: 0.5rem;
  border: 1px solid var(--color-border);
  padding: 0.5rem 0.85rem;
  font-size: 0.875rem;
  color: rgb(228 228 231);
  transition: background 0.15s;
}
.field-btn:hover {
  background: rgb(255 255 255 / 0.08);
}
</style>
