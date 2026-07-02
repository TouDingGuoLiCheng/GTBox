<script setup lang="ts">
import { Icon } from "@iconify/vue";
import { SPEED_PLAYER_SITES } from "../../types/speedPlayer";

const emit = defineEmits<{
  select: [siteId: (typeof SPEED_PLAYER_SITES)[number]["id"]];
}>();

const cardClass =
  "group flex cursor-pointer flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left transition duration-200 hover:border-accent/35 hover:bg-white/[0.06] hover:shadow-lg hover:shadow-black/30 active:scale-[0.99]";
</script>

<template>
  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    <button
      v-for="site in SPEED_PLAYER_SITES"
      :key="site.id"
      type="button"
      :class="cardClass"
      @click="emit('select', site.id)"
    >
      <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20">
        <Icon :icon="site.icon" class="text-2xl" />
      </div>
      <h3 class="text-base font-medium text-zinc-100">{{ site.name }}</h3>
      <p class="mt-1 text-sm text-zinc-500">{{ site.description }}</p>
    </button>
  </div>
</template>
