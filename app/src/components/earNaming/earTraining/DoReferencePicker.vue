<script setup lang="ts">
import { computed } from "vue";
import { Icon } from "@iconify/vue";
import GuitarFretboard from "../GuitarFretboard.vue";
import { getFretMidi, getFretPoint, type FretPoint } from "../../../utils/earNaming/fretboard";
import { playEarNamingMidi } from "../../../utils/earNaming/sampler";

const props = defineProps<{
  doString: number;
  doFret: number;
  showDoneButton?: boolean;
}>();

const emit = defineEmits<{
  pick: [stringNo: number, fret: number];
  done: [];
}>();

const doMidi = computed(() => getFretMidi(props.doString, props.doFret));
const currentPoint = computed(() => getFretPoint(props.doString, props.doFret));

async function onPick(point: FretPoint) {
  emit("pick", point.stringNo, point.fret);
  await playEarNamingMidi(point.midi);
}

async function replayDo() {
  await playEarNamingMidi(doMidi.value);
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3">
    <div class="shrink-0 space-y-2 rounded-xl border border-border bg-black/20 p-3">
      <p class="text-sm font-medium text-zinc-200">选择 Do 参照（主音）</p>
      <p class="text-xs leading-relaxed text-zinc-400">
        在指板上<strong class="font-normal text-zinc-300">点击任意一格</strong>，该音即为 Do（1 级）。
        之后题目的唱名都相对它计算；若开启「先播 Do 参照」，每题会先播放这个音。
      </p>
      <p class="text-xs text-zinc-500">
        你选的是<strong class="font-normal text-zinc-400">音高（音名）</strong>，不是弦/品编号。
        不同位置若是同一个音（如 5 弦 3 品与 6 弦 8 品都是 C），听起来一样。
      </p>
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <span class="text-zinc-400">当前 Do：</span>
        <span class="rounded-md bg-accent/15 px-2 py-0.5 text-accent">
          {{ currentPoint.stringNo }}弦 {{ currentPoint.fret }}品 · {{ currentPoint.noteName }}
        </span>
        <button
          type="button"
          class="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-zinc-300 transition hover:border-accent/40 hover:text-accent"
          @click="replayDo()"
        >
          <Icon icon="mdi:volume-high" />
          试听
        </button>
        <button
          v-if="showDoneButton"
          type="button"
          class="ml-auto flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-black transition hover:brightness-110"
          @click="emit('done')"
        >
          <Icon icon="mdi:check" />
          完成
        </button>
      </div>
    </div>

    <div class="min-h-[240px] flex-1">
      <GuitarFretboard
        :max-fret="22"
        :do-midi="doMidi"
        :enabled-strings="[1, 2, 3, 4, 5, 6]"
        :selected-midi="null"
        :show-enharmonic="false"
        variant="explore"
        label-mode="noteName"
        :anchor-string="doString"
        :anchor-fret="doFret"
        selection-exact
        do-anchor-highlight
        @pick="onPick"
      />
    </div>
  </div>
</template>
