<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useGomokuStore } from "../../stores/gomoku";

const store = useGomokuStore();
const { timer, labels, activeStone, aiThinking, mode } = storeToRefs(store);
</script>

<template>
  <div class="ui-card flex flex-col gap-3 rounded-xl border border-border p-4">
    <div class="flex items-center gap-3">
      <img src="/gomoku/images/player1.png" alt="" class="h-14 w-14 object-contain" />
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-medium text-zinc-200">{{ labels.black }}</div>
        <div class="text-xs text-zinc-500">黑棋</div>
      </div>
    </div>
    <div class="grid grid-cols-2 gap-2 text-xs text-zinc-400">
      <div>
        <span class="text-zinc-500">步时</span>
        <span class="ml-2 font-mono text-zinc-200">{{ timer.blackMove }}s</span>
      </div>
      <div>
        <span class="text-zinc-500">局时</span>
        <span class="ml-2 font-mono text-zinc-200">{{ timer.blackTotal }}s</span>
      </div>
    </div>
    <div
      v-if="activeStone === 1 && mode !== 'cvc'"
      class="rounded-lg bg-accent/15 px-2 py-1 text-center text-xs text-accent"
    >
      轮到黑棋
    </div>

    <div class="my-1 border-t border-border" />

    <div class="flex items-center gap-3">
      <img
        :src="
          mode === 'pvc' || mode === 'cvc'
            ? '/gomoku/images/computer.png'
            : '/gomoku/images/player2.png'
        "
        alt=""
        class="h-14 w-14 object-contain"
      />
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-medium text-zinc-200">{{ labels.white }}</div>
        <div class="text-xs text-zinc-500">白棋</div>
      </div>
    </div>
    <div class="grid grid-cols-2 gap-2 text-xs text-zinc-400">
      <div>
        <span class="text-zinc-500">步时</span>
        <span class="ml-2 font-mono text-zinc-200">{{ timer.whiteMove }}s</span>
      </div>
      <div>
        <span class="text-zinc-500">局时</span>
        <span class="ml-2 font-mono text-zinc-200">{{ timer.whiteTotal }}s</span>
      </div>
    </div>
    <div
      v-if="activeStone === 2 && mode !== 'cvc'"
      class="rounded-lg bg-accent/15 px-2 py-1 text-center text-xs text-accent"
    >
      {{ aiThinking && mode === 'pvc' ? "电脑思考中…" : "轮到白棋" }}
    </div>
    <div v-if="mode === 'cvc'" class="text-center text-xs text-zinc-500">机机对弈观战中</div>
    <div v-else-if="mode === 'pvn'" class="text-center text-xs text-zinc-500">局域网联机</div>
  </div>
</template>
