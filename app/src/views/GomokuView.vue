<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { Icon } from "@iconify/vue";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import GomokuBoard from "../components/gomoku/GomokuBoard.vue";
import GomokuLanLobby from "../components/gomoku/GomokuLanLobby.vue";
import GomokuModeMenu from "../components/gomoku/GomokuModeMenu.vue";
import GomokuSidePanel from "../components/gomoku/GomokuSidePanel.vue";
import GomokuStoneIcon from "../components/gomoku/GomokuStoneIcon.vue";
import { useAppearanceStore } from "../stores/appearance";
import { useGomokuStore } from "../stores/gomoku";
import { useGomokuLanStore } from "../stores/gomokuLan";
import type { GameMode } from "../types/gomoku";
import { playSound, unlockGomokuAudio } from "../utils/gomoku/sounds";

const btnPrimaryClass =
  "rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black transition duration-200 hover:brightness-110 hover:shadow-md hover:shadow-accent/20 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

const btnGhostClass =
  "rounded-lg px-3 py-2 text-sm text-zinc-400 transition duration-200 hover:bg-white/8 hover:text-accent active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

const router = useRouter();
const appearance = useAppearanceStore();
const store = useGomokuStore();
const lanStore = useGomokuLanStore();
const { phase, winner, winReason, labels, pendingResume, finished, mode } = storeToRefs(store);
const { connectionLabel, isConnected, lastError } = storeToRefs(lanStore);

const isLightUi = computed(
  () => appearance.colorScheme === "light" || appearance.customSkin?.fontColor === "dark",
);

const resultText = computed(() => {
  if (!finished.value) return "";
  if (winReason.value === "timeout") {
    const name = winner.value === 1 ? labels.value.black : labels.value.white;
    const suffix =
      mode.value === "pvn" && winReason.value === "timeout" ? "（含掉线超时）" : "";
    return `${name} 因对手超时获胜${suffix}`;
  }
  if (winReason.value === "draw") return "平局";
  if (winner.value === 1) return `${labels.value.black} 获胜！`;
  if (winner.value === 2) return `${labels.value.white} 获胜！`;
  return "对局结束";
});

function startMode(next: GameMode) {
  unlockGomokuAudio();
  playSound("click");
  store.startGame(next);
}

function openLan() {
  unlockGomokuAudio();
  playSound("click");
  store.enterLanHub();
  void lanStore.enterLanHub();
}

function onLanBack() {
  void lanStore.exitLanHub();
  store.backToMenu();
}

async function onBackClick() {
  if (phase.value === "lan_hub") {
    await lanStore.exitLanHub();
    store.backToMenu();
    return;
  }
  if (phase.value !== "menu") {
    if (mode.value === "pvn") {
      await lanStore.leaveRoom();
      return;
    }
    store.backToMenu();
  } else {
    router.push("/");
  }
}

function onKeydown(event: KeyboardEvent) {
  const tag = (event.target as HTMLElement | null)?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

  if (event.key === "Escape") {
    if (pendingResume.value) {
      store.discardResume();
      return;
    }
    if (phase.value === "lan_hub") {
      void onBackClick();
      return;
    }
    if (phase.value !== "menu") {
      if (mode.value === "pvn") {
        void lanStore.leaveRoom();
        return;
      }
      store.backToMenu();
    } else {
      router.push("/");
    }
    return;
  }
  if (event.key.toLowerCase() === "r" && phase.value !== "menu") {
    store.restart();
  }
}

onMounted(() => {
  store.init();
  window.addEventListener("keydown", onKeydown);
  const unlock = () => {
    unlockGomokuAudio();
    window.removeEventListener("pointerdown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { once: true });
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  store.pauseSession();
  if (phase.value === "lan_hub") {
    void lanStore.exitLanHub();
  } else {
    void lanStore.leaveRoom({ silent: true });
  }
});
</script>

<template>
  <div class="gomoku-view flex h-full min-h-0 flex-1 flex-col overflow-hidden p-4 sm:p-5">
    <!-- 顶栏：左返回，右 logo -->
    <div class="mb-3 flex shrink-0 items-center gap-3">
      <button
        type="button"
        :class="btnGhostClass + ' flex items-center gap-1.5'"
        @click="onBackClick()"
      >
        <Icon icon="mdi:arrow-left" />
        {{ phase === "lan_hub" ? "返回模式" : phase !== "menu" ? "返回模式" : "返回首页" }}
      </button>

      <div class="ml-auto flex items-center gap-3">
        <template v-if="phase !== 'menu' && phase !== 'lan_hub'">
          <span
            v-if="mode === 'pvn'"
            class="hidden items-center gap-1.5 rounded-full px-2 py-0.5 text-xs sm:inline-flex"
            :class="isConnected ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'"
          >
            <span
              class="h-1.5 w-1.5 rounded-full"
              :class="isConnected ? 'bg-emerald-400' : 'bg-amber-400'"
            />
            {{ connectionLabel }}
          </span>
          <button type="button" :class="btnGhostClass + ' hidden sm:inline-flex'" @click="store.restart()">
            重新开始
          </button>
          <span class="hidden text-xs text-zinc-600 sm:inline">Esc · R 重开</span>
        </template>
        <div
          class="flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium text-zinc-400 transition hover:bg-white/5"
        >
          <div
            class="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10 ring-1 ring-accent/20"
          >
            <GomokuStoneIcon variant="card" :size="18" />
          </div>
          <span>五子棋</span>
        </div>
      </div>
    </div>

    <!-- 模式选择：2×3 网格 -->
    <div
      v-if="phase === 'menu'"
      class="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto py-4"
    >
      <GomokuModeMenu @start="startMode" @lan="openLan" />
    </div>

    <div
      v-else-if="phase === 'lan_hub'"
      class="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto py-4"
    >
      <GomokuLanLobby @back="onLanBack" />
    </div>

    <!-- 对局 -->
    <div v-else class="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
      <aside class="hidden w-56 shrink-0 lg:block">
        <GomokuSidePanel />
      </aside>
      <section
        class="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border"
        :class="isLightUi ? 'bg-zinc-900/30 ring-1 ring-black/10' : 'bg-black/20'"
        style="min-height: 24rem"
      >
        <GomokuBoard />
        <p
          v-if="mode === 'pvn' && lastError && !finished"
          class="pointer-events-none absolute inset-x-0 top-2 z-10 text-center text-xs text-amber-400"
        >
          {{ lastError }}
        </p>
        <div
          v-if="finished"
          class="absolute inset-0 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
        >
          <div class="ui-card max-w-sm p-6 text-center">
            <p class="text-lg font-medium text-zinc-100">{{ resultText }}</p>
            <div class="mt-4 flex justify-center gap-3">
              <button
                v-if="mode !== 'pvn'"
                type="button"
                :class="btnPrimaryClass"
                @click="store.restart()"
              >
                再来一局
              </button>
              <button
                type="button"
                :class="btnPrimaryClass"
                @click="mode === 'pvn' ? lanStore.leaveRoom() : store.backToMenu()"
              >
                {{ mode === "pvn" ? "离开房间" : "换模式" }}
              </button>
            </div>
          </div>
        </div>
      </section>
      <aside class="shrink-0 lg:hidden">
        <GomokuSidePanel />
      </aside>
    </div>

    <div
      v-if="pendingResume"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <div class="ui-card w-full max-w-md p-6">
        <h3 class="text-base font-medium text-zinc-100">检测到未完成的对局</h3>
        <p class="mt-2 text-sm text-zinc-400">
          模式：{{
            pendingResume.mode === "pvc"
              ? "人机"
              : pendingResume.mode === "pvp"
                ? "双人"
                : pendingResume.mode === "pvn"
                  ? "联机"
                  : "机机"
          }}，
          已下 {{ pendingResume.moveCount }} 手
        </p>
        <div class="mt-5 flex justify-end gap-3">
          <button type="button" :class="btnGhostClass + ' px-4 py-2'" @click="store.discardResume()">
            放弃
          </button>
          <button type="button" :class="btnPrimaryClass" @click="store.resumeGame()">
            继续对局
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
