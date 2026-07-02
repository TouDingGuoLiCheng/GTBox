<script setup lang="ts">
import { computed, ref, watch, nextTick } from "vue";
import { Icon } from "@iconify/vue";
import { storeToRefs } from "pinia";
import { EAR_TRAINING_DIFFICULTY_LABELS } from "../../../types/earNaming";
import { useEarNamingEarTrainingStore } from "../../../stores/earNamingEarTraining";
import DoReferencePicker from "./DoReferencePicker.vue";
import EarTrainingFeedback from "./EarTrainingFeedback.vue";
import SolfegeAnswerPad from "./SolfegeAnswerPad.vue";
import SolfegeSelector from "./SolfegeSelector.vue";

const store = useEarNamingEarTrainingStore();
const {
  doString,
  doFret,
  doReferenceSummary,
  canRandomizeDoReference,
  useDoReference,
  difficulty,
  questionsPerRound,
  enabledSolfege,
  canStartRound,
  trainingPhase,
  isPlayingCue,
  revealedSolfege,
} = storeToRefs(store);

const pickingDo = ref(false);

const canAnswer = () =>
  (trainingPhase.value === "prompt" || trainingPhase.value === "review-prompt") &&
  !isPlayingCue.value;

const configLocked = computed(
  () => trainingPhase.value !== "idle" && trainingPhase.value !== "round-complete",
);

const highlightedSolfegeForPad = computed(() => revealedSolfege.value);

watch(revealedSolfege, (name) => {
  if (!name) return;
  void nextTick(() => {
    document.getElementById(`solfege-btn-${name}`)?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  });
});

function openDoPicker() {
  if (configLocked.value) return;
  pickingDo.value = true;
}

function onDoPick(stringNo: number, fret: number) {
  store.setDoReference(stringNo, fret);
}
</script>

<template>
  <DoReferencePicker
    v-if="pickingDo"
    :do-string="doString"
    :do-fret="doFret"
    show-done-button
    @pick="onDoPick"
    @done="pickingDo = false"
  />

  <div v-else class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
    <section class="shrink-0 space-y-3 rounded-xl border border-border bg-black/20 p-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm font-medium text-zinc-200">听力训练</span>
        <span class="ml-auto text-xs text-zinc-500">
          {{
            trainingPhase === "idle"
              ? "未开始"
              : trainingPhase === "round-complete"
                ? "本轮完成"
                : "训练中"
          }}
        </span>
      </div>

      <div class="space-y-2 text-sm">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-zinc-400">Do 参照：</span>
          <span class="text-zinc-200">{{ doReferenceSummary }}</span>
          <button
            type="button"
            class="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-zinc-300 transition hover:border-accent/40 hover:text-accent disabled:opacity-40"
            :disabled="configLocked"
            @click="openDoPicker()"
          >
            <Icon icon="mdi:guitar-electric" />
            在指板上选择
          </button>
          <button
            type="button"
            title="随机切换到同音名、不同弦品/八度的 Do 参照"
            class="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-zinc-300 transition hover:border-accent/40 hover:text-accent disabled:opacity-40"
            :disabled="configLocked || !canRandomizeDoReference"
            @click="store.randomizeDoReferencePosition()"
          >
            <Icon icon="mdi:dice-multiple" />
            随机异位
          </button>
        </div>
        <p class="text-xs text-zinc-500">
          你选的音就是 Do（主音），题目唱名相对它计算；同音异位的不同弦品听起来相同。
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-3 text-sm">
        <label class="flex items-center gap-2 text-zinc-300">
          难度
          <select
            v-model="difficulty"
            class="rounded-md border border-border bg-black/30 px-2 py-1"
            :disabled="configLocked"
          >
            <option v-for="(label, key) in EAR_TRAINING_DIFFICULTY_LABELS" :key="key" :value="key">
              {{ label }}
            </option>
          </select>
        </label>
        <label class="flex items-center gap-2 text-zinc-300">
          <input
            v-model="useDoReference"
            type="checkbox"
            class="accent-accent"
            :disabled="configLocked"
          />
          先播 Do 参照
        </label>
        <label class="flex items-center gap-2 text-zinc-300">
          每轮题数
          <select
            v-model.number="questionsPerRound"
            class="rounded-md border border-border bg-black/30 px-2 py-1"
            :disabled="configLocked"
          >
            <option :value="5">5</option>
            <option :value="10">10</option>
            <option :value="15">15</option>
          </select>
        </label>
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!canStartRound"
          @click="store.startRound()"
        >
          <Icon icon="mdi:play" />
          {{ trainingPhase === "idle" || trainingPhase === "round-complete" ? "开始训练" : "重新开始" }}
        </button>
      </div>

      <SolfegeSelector
        :enabled-solfege="enabledSolfege"
        :disabled="configLocked"
        @toggle="(name, checked) => store.toggleEnabledSolfege(name, checked)"
      />
      <p v-if="!canStartRound" class="text-xs text-amber-300/90">
        当前唱名与难度组合无可用音高，请多选几个唱名或提高难度。
      </p>
    </section>

    <EarTrainingFeedback class="shrink-0" />

    <section
      v-if="trainingPhase === 'prompt' || trainingPhase === 'feedback' || trainingPhase === 'review-prompt' || trainingPhase === 'review-feedback'"
      class="mx-auto w-fit max-w-full shrink-0 rounded-xl border border-border bg-black/20 p-4"
    >
      <h3 class="mb-3 text-center text-sm text-zinc-400">
        {{ trainingPhase === 'review-prompt' || trainingPhase === 'review-feedback' ? '错题复习：选择唱名' : '选择你听到的唱名' }}
      </h3>
      <SolfegeAnswerPad
        :enabled-solfege="enabledSolfege"
        :disabled="!canAnswer()"
        :highlighted-solfege="highlightedSolfegeForPad"
        @pick="store.submitAnswer($event)"
      />
    </section>

    <p v-else class="text-center text-sm text-zinc-500">
      纯听音练习，不显示指板。配置好后点击「开始训练」。
    </p>
  </div>
</template>
