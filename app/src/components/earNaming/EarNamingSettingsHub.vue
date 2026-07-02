<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Icon } from "@iconify/vue";
import { storeToRefs } from "pinia";
import { EAR_TRAINING_DIFFICULTY_LABELS } from "../../types/earNaming";
import { useEarNamingStore } from "../../stores/earNaming";
import { useEarNamingEarTrainingStore } from "../../stores/earNamingEarTraining";
import SolfegeSelector from "./earTraining/SolfegeSelector.vue";
import DoReferencePicker from "./earTraining/DoReferencePicker.vue";
import {
  getEarNamingAudioSource,
  getEarNamingAudioStatus,
  setEarNamingAudioSource,
  type EarNamingAudioSource,
} from "../../utils/earNaming/sampler";

const store = useEarNamingStore();
const earStore = useEarNamingEarTrainingStore();

const {
  exploreDoString,
  exploreDoFret,
  exploreShowEnharmonic,
  exploreMaxFret,
  doString,
  doFret,
  enabledStrings,
  maxFret,
  showEnharmonic,
  questionsPerRound,
  dictationNoteCount,
} = storeToRefs(store);

const {
  doString: earDoString,
  doFret: earDoFret,
  doReferenceSummary,
  canRandomizeDoReference,
  useDoReference,
  difficulty,
  questionsPerRound: earQuestionsPerRound,
  enabledSolfege,
} = storeToRefs(earStore);

const audioSource = ref<EarNamingAudioSource>(getEarNamingAudioSource());
const audioStatus = ref(getEarNamingAudioStatus());
const showEarDoPicker = ref(false);

function onAudioSourceChange(source: EarNamingAudioSource) {
  audioSource.value = source;
  setEarNamingAudioSource(source);
  audioStatus.value = getEarNamingAudioStatus();
}

function onStringToggle(stringNo: number, checked: boolean) {
  store.toggleString(stringNo, checked);
}

onMounted(() => {
  store.loadExploreSettings();
  store.loadFretboardSettings();
  earStore.reloadSettings();
});
</script>

<template>
  <div class="mx-auto w-full max-w-2xl space-y-4 overflow-y-auto py-2">
    <p class="text-sm text-zinc-400">各模块配置独立保存，修改后分别生效。</p>

    <section class="space-y-3 rounded-xl border border-border bg-black/20 p-4">
      <h3 class="text-sm font-medium text-zinc-200">音色</h3>
      <div class="flex flex-wrap gap-4 text-sm">
        <label class="flex items-center gap-2 text-zinc-300">
          <input
            type="radio"
            name="audio-source"
            value="builtin"
            :checked="audioSource === 'builtin'"
            class="accent-accent"
            @change="onAudioSourceChange('builtin')"
          />
          内置合成吉他（默认）
        </label>
        <label class="flex items-center gap-2 text-zinc-300">
          <input
            type="radio"
            name="audio-source"
            value="recorded"
            :checked="audioSource === 'recorded'"
            class="accent-accent"
            @change="onAudioSourceChange('recorded')"
          />
          真实电吉他采样（可选）
        </label>
      </div>
      <p class="text-xs text-zinc-500">
        {{ audioStatus.sourceLabel }}。真实采样需运行
        <code class="text-zinc-400">python app/scripts/install-freepats-guitar.py</code>
        安装到 <code class="text-zinc-400">public/audio/guitar/recorded/</code>。
      </p>
    </section>

    <section class="space-y-3 rounded-xl border border-border bg-black/20 p-4">
      <h3 class="text-sm font-medium text-zinc-200">自由探索</h3>
      <div class="flex flex-wrap items-center gap-3 text-sm">
        <span class="text-zinc-400">Do 参照：</span>
        <label class="flex items-center gap-2 text-zinc-300">
          弦
          <select v-model.number="exploreDoString" class="rounded-md border border-border bg-black/30 px-2 py-1">
            <option v-for="stringNo in [6, 5, 4, 3, 2, 1]" :key="`ex-do-${stringNo}`" :value="stringNo">
              {{ stringNo }}弦
            </option>
          </select>
        </label>
        <label class="flex items-center gap-2 text-zinc-300">
          品
          <input
            v-model.number="exploreDoFret"
            type="number"
            min="0"
            :max="exploreMaxFret"
            class="w-20 rounded-md border border-border bg-black/30 px-2 py-1"
          />
        </label>
      </div>
      <label class="flex items-center gap-2 text-sm text-zinc-300">
        <input v-model="exploreShowEnharmonic" type="checkbox" class="accent-accent" />
        同音异位高亮
      </label>
    </section>

    <section class="space-y-3 rounded-xl border border-border bg-black/20 p-4">
      <h3 class="text-sm font-medium text-zinc-200">听力训练</h3>
      <div class="space-y-2 text-sm">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-zinc-400">Do 参照：</span>
          <span class="text-zinc-200">{{ doReferenceSummary }}</span>
          <button
            type="button"
            class="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-zinc-300 transition hover:border-accent/40 hover:text-accent"
            @click="showEarDoPicker = !showEarDoPicker"
          >
            {{ showEarDoPicker ? "收起指板" : "在指板上选择" }}
          </button>
          <button
            type="button"
            title="随机切换到同音名、不同弦品/八度的 Do 参照"
            class="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-zinc-300 transition hover:border-accent/40 hover:text-accent disabled:opacity-40"
            :disabled="!canRandomizeDoReference"
            @click="earStore.randomizeDoReferencePosition()"
          >
            <Icon icon="mdi:dice-multiple" />
            随机异位
          </button>
        </div>
        <p class="text-xs text-zinc-500">点击指板任意一格设为 Do（主音）；听感相同的位置音名相同。</p>
      </div>
      <DoReferencePicker
        v-if="showEarDoPicker"
        :do-string="earDoString"
        :do-fret="earDoFret"
        @pick="(s, f) => earStore.setDoReference(s, f)"
      />
      <div class="flex flex-wrap items-center gap-3 text-sm">
        <label class="flex items-center gap-2 text-zinc-300">
          难度
          <select v-model="difficulty" class="rounded-md border border-border bg-black/30 px-2 py-1">
            <option v-for="(label, key) in EAR_TRAINING_DIFFICULTY_LABELS" :key="key" :value="key">
              {{ label }}
            </option>
          </select>
        </label>
        <label class="flex items-center gap-2 text-zinc-300">
          <input v-model="useDoReference" type="checkbox" class="accent-accent" />
          先播 Do 参照
        </label>
        <label class="flex items-center gap-2 text-zinc-300">
          每轮题数
          <select v-model.number="earQuestionsPerRound" class="rounded-md border border-border bg-black/30 px-2 py-1">
            <option :value="5">5</option>
            <option :value="10">10</option>
            <option :value="15">15</option>
          </select>
        </label>
      </div>
      <SolfegeSelector
        :enabled-solfege="enabledSolfege"
        @toggle="(name, checked) => earStore.toggleEnabledSolfege(name, checked)"
      />
    </section>

    <section class="space-y-3 rounded-xl border border-border bg-black/20 p-4">
      <h3 class="text-sm font-medium text-zinc-200">记忆指板</h3>
      <div class="flex flex-wrap items-center gap-3 text-sm">
        <span class="text-zinc-400">Do 参照：</span>
        <label class="flex items-center gap-2 text-zinc-300">
          弦
          <select v-model.number="doString" class="rounded-md border border-border bg-black/30 px-2 py-1">
            <option v-for="stringNo in [6, 5, 4, 3, 2, 1]" :key="`fb-do-${stringNo}`" :value="stringNo">
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
            :max="maxFret"
            class="w-20 rounded-md border border-border bg-black/30 px-2 py-1"
          />
        </label>
      </div>
      <div class="flex flex-wrap items-center gap-3 text-sm">
        <span class="text-zinc-400">练习弦：</span>
        <label v-for="stringNo in [1, 2, 3, 4, 5, 6]" :key="`str-${stringNo}`" class="flex items-center gap-1.5">
          <input
            type="checkbox"
            :checked="enabledStrings.includes(stringNo)"
            class="accent-accent"
            @change="onStringToggle(stringNo, ($event.target as HTMLInputElement).checked)"
          />
          <span class="text-zinc-300">{{ stringNo }}弦</span>
        </label>
      </div>
      <label class="flex items-center gap-2 text-sm text-zinc-300">
        <input v-model="showEnharmonic" type="checkbox" class="accent-accent" />
        同音异位高亮
      </label>
      <label class="flex items-center gap-2 text-sm text-zinc-300">
        每轮题数
        <select v-model.number="questionsPerRound" class="rounded-md border border-border bg-black/30 px-2 py-1">
          <option :value="5">5</option>
          <option :value="10">10</option>
          <option :value="15">15</option>
        </select>
      </label>
      <label class="flex items-center gap-2 text-sm text-zinc-300">
        扒音每段音数
        <select v-model.number="dictationNoteCount" class="rounded-md border border-border bg-black/30 px-2 py-1">
          <option :value="3">3</option>
          <option :value="4">4</option>
          <option :value="5">5</option>
        </select>
      </label>
    </section>
  </div>
</template>
