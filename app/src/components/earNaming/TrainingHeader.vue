<script setup lang="ts">
import { Icon } from "@iconify/vue";
import { storeToRefs } from "pinia";
import { TRAINING_MODE_LABELS } from "../../types/earNaming";
import { useEarNamingStore } from "../../stores/earNaming";

const store = useEarNamingStore();
const {
  trainingMode,
  trainingPhase,
  doString,
  doFret,
  enabledStrings,
  questionsPerRound,
  dictationNoteCount,
  isDictationMode,
  showEnharmonic,
} = storeToRefs(store);

function onStringToggle(stringNo: number, checked: boolean) {
  store.toggleString(stringNo, checked);
}
</script>

<template>
  <section class="training-header space-y-3 rounded-xl border border-border bg-black/20 p-3">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-sm font-medium text-zinc-200">{{ TRAINING_MODE_LABELS[trainingMode] }}</span>
      <button
        type="button"
        class="rounded-lg px-2 py-1 text-xs text-zinc-500 transition hover:bg-white/5 hover:text-accent"
        @click="store.backToFretboardMenu()"
      >
        换练法
      </button>
      <span class="ml-auto text-xs text-zinc-500">
        {{ trainingPhase === "idle" ? "未开始" : trainingPhase === "round-complete" ? "本轮完成" : "训练中" }}
      </span>
    </div>

    <div class="grid gap-3 lg:grid-cols-2">
      <div class="flex flex-wrap items-center gap-3 text-sm">
        <span class="text-zinc-400">Do 参照：</span>
        <label class="flex items-center gap-2 text-zinc-300">
          弦
          <select v-model.number="doString" class="rounded-md border border-border bg-black/30 px-2 py-1">
            <option v-for="stringNo in [6, 5, 4, 3, 2, 1]" :key="`do-string-${stringNo}`" :value="stringNo">
              {{ stringNo }}弦
            </option>
          </select>
        </label>
        <label class="flex items-center gap-2 text-zinc-300">
          品
          <input
            v-model.number="doFret"
            type="number"
            min="0"
            max="22"
            class="w-20 rounded-md border border-border bg-black/30 px-2 py-1"
          />
        </label>
      </div>

      <div class="flex flex-wrap items-center gap-3 text-sm">
        <span class="text-zinc-400">练习弦：</span>
        <label v-for="stringNo in [1, 2, 3, 4, 5, 6]" :key="`toggle-${stringNo}`" class="flex items-center gap-1.5">
          <input
            type="checkbox"
            :checked="enabledStrings.includes(stringNo)"
            class="accent-accent"
            @change="onStringToggle(stringNo, ($event.target as HTMLInputElement).checked)"
          />
          <span class="text-zinc-300">{{ stringNo }}弦</span>
        </label>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-3 text-sm">
      <label class="flex items-center gap-2 text-zinc-300">
        <input v-model="showEnharmonic" type="checkbox" class="accent-accent" />
        同音异位高亮
      </label>
      <label class="flex items-center gap-2 text-zinc-300">
        每轮题数
        <select v-model.number="questionsPerRound" class="rounded-md border border-border bg-black/30 px-2 py-1">
          <option :value="5">5</option>
          <option :value="10">10</option>
          <option :value="15">15</option>
        </select>
      </label>
      <label v-if="isDictationMode" class="flex items-center gap-2 text-zinc-300">
        每段音数
        <select v-model.number="dictationNoteCount" class="rounded-md border border-border bg-black/30 px-2 py-1">
          <option :value="3">3</option>
          <option :value="4">4</option>
          <option :value="5">5</option>
        </select>
      </label>
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-black transition hover:brightness-110"
        @click="store.startRound()"
      >
        <Icon icon="mdi:play" />
        {{ trainingPhase === "idle" || trainingPhase === "round-complete" ? "开始训练" : "重新开始" }}
      </button>
    </div>
  </section>
</template>
