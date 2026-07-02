<script setup lang="ts">
import { computed } from "vue";
import type { EarTrainingSolfegeName } from "../../../types/earNaming";
import {
  CHROMATIC_SOLFEGE_BUTTONS,
  DIATONIC_SOLFEGE_BUTTONS,
} from "../../../types/earNaming";
import { pickedSolfegeToInterval } from "../../../utils/earNaming/solfegeMatch";

const props = defineProps<{
  enabledSolfege: EarTrainingSolfegeName[];
  disabled?: boolean;
  highlightedSolfege?: string | null;
}>();

const emit = defineEmits<{
  pick: [solfege: string];
}>();

const highlightedInterval = computed(() => {
  if (!props.highlightedSolfege) return null;
  return pickedSolfegeToInterval(props.highlightedSolfege);
});

const isHighlighted = (name: string) => {
  const interval = highlightedInterval.value;
  if (interval === null) return false;
  return pickedSolfegeToInterval(name) === interval;
};

const highlightClass =
  "z-[1] !border-emerald-400 !bg-emerald-500/30 !text-emerald-100 ring-2 ring-emerald-400/70 shadow-lg shadow-emerald-500/25 !opacity-100 scale-[1.04]";

const diatonicButtons = () =>
  DIATONIC_SOLFEGE_BUTTONS.filter((name) => props.enabledSolfege.includes(name));

const chromaticButtons = () =>
  CHROMATIC_SOLFEGE_BUTTONS.filter((name) => props.enabledSolfege.includes(name));
</script>

<template>
  <div class="mx-auto w-fit max-w-full space-y-3">
    <div v-if="diatonicButtons().length" class="flex flex-wrap justify-center gap-2">
      <button
        v-for="name in diatonicButtons()"
        :key="name"
        type="button"
        :id="`solfege-btn-${name}`"
        class="relative min-w-[4.5rem] rounded-xl border border-border bg-black/25 px-3 py-3 text-sm font-medium text-zinc-200 transition hover:border-accent/50 hover:bg-accent/10 hover:text-accent active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
        :class="isHighlighted(name) ? highlightClass : ''"
        :disabled="disabled"
        @click="emit('pick', name)"
      >
        {{ name }}
      </button>
    </div>
    <div v-if="chromaticButtons().length" class="flex flex-wrap justify-center gap-2">
      <button
        v-for="name in chromaticButtons()"
        :key="name"
        type="button"
        :id="`solfege-btn-${name}`"
        class="relative min-w-[3.5rem] rounded-xl border border-border/80 bg-black/15 px-2 py-2.5 text-xs font-medium text-zinc-400 transition hover:border-accent/40 hover:bg-accent/8 hover:text-accent active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
        :class="isHighlighted(name) ? highlightClass : ''"
        :disabled="disabled"
        @click="emit('pick', name)"
      >
        {{ name }}
      </button>
    </div>
  </div>
</template>
