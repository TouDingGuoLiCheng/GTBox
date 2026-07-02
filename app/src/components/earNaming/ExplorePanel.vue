<script setup lang="ts">
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import GuitarFretboard from "./GuitarFretboard.vue";
import { useEarNamingStore } from "../../stores/earNaming";
import {
  buildFretboard,
  findSamePitchClass,
  toDegreeName,
  toSolfegeName,
  type FretPoint,
} from "../../utils/earNaming/fretboard";
import { getEarNamingAudioStatus, playEarNamingMidi } from "../../utils/earNaming/sampler";

const store = useEarNamingStore();
const {
  exploreDoMidi,
  exploreEnabledStrings,
  exploreMaxFret,
  exploreShowEnharmonic,
} = storeToRefs(store);

const exploreSelected = ref<FretPoint | null>(null);
const audioStatus = ref(getEarNamingAudioStatus());
const isPlaying = ref(false);

const exploreSolfege = computed(() =>
  exploreSelected.value ? toSolfegeName(exploreSelected.value.midi, exploreDoMidi.value) : "--",
);
const exploreDegree = computed(() =>
  exploreSelected.value ? toDegreeName(exploreSelected.value.midi, exploreDoMidi.value) : "--",
);
const exploreEnharmonic = computed(() => {
  if (!exploreSelected.value || !exploreShowEnharmonic.value) return [];
  const all = buildFretboard(exploreMaxFret.value, exploreEnabledStrings.value);
  return findSamePitchClass(all, exploreSelected.value.midi).filter(
    (p) => p.stringNo !== exploreSelected.value!.stringNo || p.fret !== exploreSelected.value!.fret,
  );
});

async function onPick(point: FretPoint) {
  exploreSelected.value = point;
  isPlaying.value = true;
  await playEarNamingMidi(point.midi);
  audioStatus.value = getEarNamingAudioStatus();
  window.setTimeout(() => {
    isPlaying.value = false;
  }, 120);
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3">
    <section class="explore-info grid shrink-0 gap-3 rounded-xl border border-border bg-black/20 p-3 lg:grid-cols-2">
      <div class="space-y-2 text-sm">
        <p class="text-zinc-400">
          当前选择：
          <span class="text-zinc-200">
            {{
              exploreSelected
                ? `${exploreSelected.stringNo}弦 ${exploreSelected.fret}品 · ${exploreSelected.noteName}`
                : "未选择"
            }}
          </span>
        </p>
        <p class="text-zinc-400">
          标签：
          <span class="text-zinc-200">{{ exploreSolfege }} · {{ exploreDegree }}级</span>
        </p>
      </div>
      <div class="space-y-2 text-sm">
        <label class="flex items-center gap-2 text-zinc-300">
          <input v-model="exploreShowEnharmonic" type="checkbox" class="accent-accent" />
          同音异位高亮
        </label>
        <div class="min-h-[1.25rem]">
          <span v-if="isPlaying" class="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">播放中</span>
        </div>
        <p class="min-h-[2.5rem] text-xs text-emerald-300/90">
          <template v-if="exploreShowEnharmonic && exploreEnharmonic.length">
            同音异位：
            {{ exploreEnharmonic.map((p) => `${p.stringNo}弦${p.fret}品`).join("、") }}
          </template>
        </p>
      </div>
    </section>

    <div class="min-h-0 flex-1">
      <GuitarFretboard
        :max-fret="exploreMaxFret"
        :do-midi="exploreDoMidi"
        :enabled-strings="exploreEnabledStrings"
        :selected-midi="exploreSelected?.midi ?? null"
        :show-enharmonic="exploreShowEnharmonic"
        @pick="onPick"
      />
    </div>

    <p v-if="audioStatus.sampleReady" class="shrink-0 text-xs text-zinc-500">
      音色：{{ audioStatus.sourceLabel }}
    </p>
    <p v-else-if="audioStatus.sampleFailed" class="shrink-0 text-xs text-amber-300">
      内置采样加载失败，已回退合成音。
    </p>
  </div>
</template>

<style scoped>
.explore-info {
  min-height: 7.5rem;
}
</style>
