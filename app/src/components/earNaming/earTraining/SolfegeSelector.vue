<script setup lang="ts">
import {
  CHROMATIC_SOLFEGE_BUTTONS,
  DIATONIC_SOLFEGE_BUTTONS,
  type EarTrainingSolfegeName,
} from "../../../types/earNaming";

const props = defineProps<{
  enabledSolfege: EarTrainingSolfegeName[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  toggle: [name: EarTrainingSolfegeName, checked: boolean];
}>();

function isChecked(name: EarTrainingSolfegeName) {
  return props.enabledSolfege.includes(name);
}

function onToggle(name: EarTrainingSolfegeName, event: Event) {
  emit("toggle", name, (event.target as HTMLInputElement).checked);
}
</script>

<template>
  <div class="space-y-2">
    <p class="text-sm font-medium text-zinc-200">出题唱名</p>
    <p class="text-xs text-zinc-500">勾选本轮会出现的唱名（至少保留 1 个）</p>
    <div class="flex flex-wrap gap-2">
      <label
        v-for="name in DIATONIC_SOLFEGE_BUTTONS"
        :key="`sel-${name}`"
        class="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border/80 bg-black/20 px-2.5 py-1.5 text-sm text-zinc-300 transition hover:border-accent/35"
        :class="{ 'border-accent/45 bg-accent/10 text-accent': isChecked(name) }"
      >
        <input
          type="checkbox"
          class="accent-accent"
          :checked="isChecked(name)"
          :disabled="disabled || (enabledSolfege.length === 1 && isChecked(name))"
          @change="onToggle(name, $event)"
        />
        {{ name }}
      </label>
    </div>
    <div class="flex flex-wrap gap-2">
      <label
        v-for="name in CHROMATIC_SOLFEGE_BUTTONS"
        :key="`sel-${name}`"
        class="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border/60 bg-black/15 px-2.5 py-1.5 text-xs text-zinc-400 transition hover:border-accent/35"
        :class="{ 'border-accent/45 bg-accent/10 text-accent': isChecked(name) }"
      >
        <input
          type="checkbox"
          class="accent-accent"
          :checked="isChecked(name)"
          :disabled="disabled || (enabledSolfege.length === 1 && isChecked(name))"
          @change="onToggle(name, $event)"
        />
        {{ name }}
      </label>
    </div>
  </div>
</template>
