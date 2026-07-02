<script setup lang="ts">
import { Icon } from "@iconify/vue";
import { invoke } from "@tauri-apps/api/core";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import SitePicker from "../components/speedPlayer/SitePicker.vue";
import { useSpeedPlayerWebview } from "../composables/useSpeedPlayerWebview";
import {
  SPEED_PLAYER_SITES,
  type SpeedPlayerAction,
  type SpeedPlayerPhase,
  type SpeedPlayerSiteId,
} from "../types/speedPlayer";

const btnGhostClass =
  "rounded-lg px-3 py-2 text-sm text-zinc-400 transition duration-200 hover:bg-white/8 hover:text-accent active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

const router = useRouter();
const phase = ref<SpeedPlayerPhase>("picker");
const activeSiteId = ref<SpeedPlayerSiteId | null>(null);
const hostRef = ref<HTMLElement | null>(null);

const activeSite = computed(() =>
  SPEED_PLAYER_SITES.find((s) => s.id === activeSiteId.value) ?? null,
);

const { tauriReady, attached, diagnostics, attach, detach, focusWebview, startWatch, stopWatch } =
  useSpeedPlayerWebview(hostRef, activeSiteId);

const statusHint = computed(() => {
  const d = diagnostics.value;
  if (!attached.value || !d?.videoId) return "";
  const corrections = d.rateCorrections ?? 0;
  if (corrections > 0) return `倍速已自动纠正 ${corrections} 次`;
  return `当前 ${d.targetRate.toFixed(2)}×`;
});

function onSelectSite(siteId: SpeedPlayerSiteId) {
  activeSiteId.value = siteId;
  phase.value = "site";
}

async function onBackClick() {
  if (phase.value === "site") {
    stopWatch();
    await detach();
    phase.value = "picker";
    activeSiteId.value = null;
    return;
  }
  router.push("/");
}

async function sendAction(action: SpeedPlayerAction) {
  if (!tauriReady || !attached.value) return;
  try {
    await invoke("speed_player_send_action", { action });
  } catch {
    /* ignore */
  }
}

function onKeydown(event: KeyboardEvent) {
  if (phase.value !== "site" || !attached.value) return;
  const tag = (event.target as HTMLElement | null)?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

  if (event.key === "[" && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    void sendAction("rate-dec");
    return;
  }
  if (event.key === "]" && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    void sendAction("rate-inc");
    return;
  }
  if (event.shiftKey && (event.key === "A" || event.key === "a")) {
    event.preventDefault();
    void sendAction("set-a");
    return;
  }
  if (event.shiftKey && (event.key === "B" || event.key === "b")) {
    event.preventDefault();
    void sendAction("set-b");
    return;
  }
  if (event.shiftKey && (event.key === "L" || event.key === "l")) {
    event.preventDefault();
    void sendAction("toggle-ab");
    return;
  }
  if ((event.key === "m" || event.key === "M") && !event.shiftKey && !event.ctrlKey) {
    event.preventDefault();
    void sendAction("add-marker");
  }
}

watch(
  () => phase.value,
  async (next, prev) => {
    if (next === "site" && prev === "picker") {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
      startWatch();
      await attach();
    }
  },
);

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  stopWatch();
  void detach();
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden p-4 sm:p-5">
    <div class="mb-3 flex shrink-0 items-center gap-3">
      <button type="button" :class="btnGhostClass + ' flex items-center gap-1.5'" @click="onBackClick()">
        <Icon icon="mdi:arrow-left" />
        {{ phase === "site" ? "返回站点" : "返回首页" }}
      </button>
      <button
        v-if="phase === 'site' && tauriReady"
        type="button"
        :class="btnGhostClass + ' ml-1'"
        title="聚焦 B 站页面"
        @click="focusWebview()"
      >
        <Icon icon="mdi:cursor-default-click" class="text-base" />
      </button>
      <div class="ml-auto flex items-center gap-2 text-sm text-zinc-500">
        <Icon icon="mdi:speedometer" class="text-lg text-accent" />
        <span>{{ phase === "picker" ? "倍速播放器" : activeSite?.name }}</span>
        <span v-if="statusHint" class="text-xs text-amber-400/90">{{ statusHint }}</span>
      </div>
    </div>

    <div v-if="phase === 'picker'" class="min-h-0 flex-1 overflow-y-auto">
      <p class="mb-4 text-sm text-zinc-500">
        选择视频网站，在页面内登录后即可跟弹；播放时底部会出现倍速控制条，同一视频会记住上次倍速。
      </p>
      <SitePicker @select="onSelectSite" />
    </div>

    <div v-else class="pointer-events-none flex min-h-0 flex-1 flex-col gap-2">
      <p v-if="!tauriReady" class="pointer-events-auto rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
        请在桌面客户端中使用倍速播放器（内嵌 B 站网页）。
      </p>
      <div
        ref="hostRef"
        class="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-white/10 bg-transparent"
      />
    </div>
  </div>
</template>
