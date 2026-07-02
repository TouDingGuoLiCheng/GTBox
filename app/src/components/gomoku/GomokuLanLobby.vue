<script setup lang="ts">
import { ref } from "vue";
import { Icon } from "@iconify/vue";
import { storeToRefs } from "pinia";
import { useGomokuStore } from "../../stores/gomoku";
import { useGomokuLanStore } from "../../stores/gomokuLan";
import type { DiscoveredRoom } from "../../types/gomokuLan";
import { DEFAULT_LAN_PORT } from "../../types/gomokuLan";
import { playSound } from "../../utils/gomoku/sounds";

const emit = defineEmits<{
  back: [];
}>();

const gomoku = useGomokuStore();
const lan = useGomokuLanStore();
const {
  hubPhase,
  discoveredRooms,
  discovering,
  connectionError,
  connectionStatus,
  hostInfo,
  guestNickname,
  hostNickname,
  canStart,
  isHost,
  isGuest,
  isConnected,
  primaryAddress,
  manualHost,
  manualPort,
  showManual,
  graceRemaining,
  lastError,
  pendingReconnect,
} = storeToRefs(lan);

const copied = ref(false);

const btnPrimary =
  "rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black transition hover:brightness-110 active:scale-[0.98]";
const btnGhost =
  "rounded-lg px-3 py-2 text-sm text-zinc-400 transition hover:bg-white/8 hover:text-accent active:scale-[0.98]";
const cardClass =
  "ui-card rounded-xl border border-border p-4 transition hover:border-accent/30";

async function onCreate() {
  playSound("click");
  await lan.createRoom();
}

async function onJoinRoom(room: DiscoveredRoom) {
  playSound("click");
  await lan.joinDiscovered(room);
}

async function onJoinManual() {
  playSound("click");
  await lan.joinManual();
}

async function onLeave() {
  playSound("click");
  await lan.leaveRoom();
  emit("back");
}

async function onStart() {
  playSound("click");
  lan.hostStartGame();
}

async function copyInfo() {
  const text = lan.copyConnectionInfo();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    /* ignore */
  }
}

async function resumeReconnect() {
  const ok = await lan.tryReconnectPending();
  if (!ok) {
    lan.dismissReconnect();
  }
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-lg flex-col gap-4">
    <!-- 重连提示 -->
    <div
      v-if="pendingReconnect && hubPhase === 'hub'"
      class="ui-card rounded-xl border border-accent/30 bg-accent/5 p-4"
    >
      <p class="text-sm font-medium text-zinc-100">检测到未结束的联机对局</p>
      <p class="mt-1 text-xs text-zinc-400">宽限内可尝试回到上一局</p>
      <div class="mt-3 flex justify-end gap-2">
        <button type="button" :class="btnGhost" @click="lan.dismissReconnect()">放弃</button>
        <button type="button" :class="btnPrimary" @click="resumeReconnect">回到对局</button>
      </div>
    </div>

    <!-- 大厅 -->
    <template v-if="hubPhase === 'hub'">
      <div class="text-center">
        <h2 class="text-lg font-medium text-zinc-100">局域网联机</h2>
        <p class="mt-1 text-xs text-zinc-500">同一 WiFi 下自动发现房间，或使用手动 IP</p>
      </div>

      <button type="button" :class="btnPrimary + ' w-full py-3'" @click="onCreate">
        <Icon icon="mdi:plus-circle-outline" class="mr-1.5 inline text-lg align-[-2px]" />
        创建房间
      </button>

      <div :class="cardClass">
        <div class="mb-3 flex items-center justify-between">
          <span class="text-sm font-medium text-zinc-200">附近房间</span>
          <button
            type="button"
            :class="btnGhost + ' !px-2 !py-1 text-xs'"
            :disabled="discovering"
            @click="lan.refreshDiscovery()"
          >
            <Icon
              icon="mdi:refresh"
              class="mr-1 inline"
              :class="discovering ? 'animate-spin' : ''"
            />
            刷新
          </button>
        </div>

        <div class="min-h-[2.5rem]">
          <ul v-if="discoveredRooms.length" class="flex flex-col gap-2">
            <li v-for="room in discoveredRooms" :key="room.roomId">
              <button
                type="button"
                class="flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition hover:border-accent/40 hover:bg-accent/5"
                @click="onJoinRoom(room)"
              >
                <Icon icon="mdi:wifi" class="shrink-0 text-lg text-accent" />
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm text-zinc-200">{{ room.nickname }}</div>
                  <div class="text-xs text-zinc-500">{{ room.host }}:{{ room.port }}</div>
                </div>
                <Icon icon="mdi:chevron-right" class="text-zinc-600" />
              </button>
            </li>
          </ul>
          <p v-else-if="discovering" class="text-center text-sm text-zinc-500">
            正在搜索局域网房间…
          </p>
          <p v-else class="text-center text-sm text-zinc-500">
            暂无发现房间，可创建房间或用手动连接
          </p>
        </div>
      </div>

      <div :class="cardClass">
        <button
          type="button"
          class="flex w-full items-center justify-between text-sm text-zinc-300"
          @click="showManual = !showManual"
        >
          <span>手动连接</span>
          <Icon :icon="showManual ? 'mdi:chevron-up' : 'mdi:chevron-down'" />
        </button>
        <div v-if="showManual" class="mt-3 flex flex-col gap-2">
          <input
            v-model="manualHost"
            type="text"
            placeholder="主机 IP，如 192.168.1.23"
            class="w-full rounded-lg border border-border bg-black/20 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-accent/50"
          />
          <input
            v-model.number="manualPort"
            type="number"
            :placeholder="String(DEFAULT_LAN_PORT)"
            class="w-full rounded-lg border border-border bg-black/20 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-accent/50"
          />
          <button type="button" :class="btnPrimary" @click="onJoinManual">连接</button>
          <p class="text-xs text-zinc-500">
            若无法连接：确认同一 WiFi、Windows 防火墙已允许本程序、主机仍在等候室
          </p>
        </div>
      </div>

      <p v-if="connectionError" class="text-center text-sm text-red-400">{{ connectionError }}</p>

      <button type="button" :class="btnGhost + ' w-full'" @click="emit('back')">返回模式选择</button>
    </template>

    <!-- 连接中 -->
    <div v-else-if="hubPhase === 'connecting'" class="py-12 text-center">
      <Icon icon="mdi:lan-connect" class="mx-auto text-4xl text-accent animate-pulse" />
      <p class="mt-3 text-sm text-zinc-300">正在连接…</p>
      <p v-if="connectionError" class="mt-2 text-sm text-red-400">{{ connectionError }}</p>
    </div>

    <!-- 等候室 -->
    <template v-else-if="hubPhase === 'waiting'">
      <div class="text-center">
        <div
          class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs"
          :class="
            isConnected
              ? 'bg-emerald-500/15 text-emerald-400'
              : 'bg-amber-500/15 text-amber-400'
          "
        >
          <span
            class="h-1.5 w-1.5 rounded-full"
            :class="isConnected ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'"
          />
          {{ isConnected ? "已连接" : connectionStatus === "connecting" ? "连接中…" : "已断开" }}
        </div>
        <h2 class="mt-3 text-lg font-medium text-zinc-100">等候室</h2>
        <p v-if="hostInfo" class="mt-1 text-xs text-zinc-500">房间号 {{ hostInfo.roomId }}</p>
      </div>

      <div :class="cardClass + ' flex flex-col gap-3'">
        <div class="flex items-center gap-3">
          <span class="h-3 w-3 rounded-full bg-zinc-900 ring-2 ring-zinc-600" />
          <div class="flex-1">
            <div class="text-sm text-zinc-200">
              {{ isHost ? gomoku.settings.name1 : hostNickname ?? "房主" }}
            </div>
            <div class="text-xs text-zinc-500">黑棋 · 房主</div>
          </div>
          <span v-if="isHost" class="text-xs text-accent">你</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="h-3 w-3 rounded-full bg-zinc-100 ring-2 ring-zinc-400" />
          <div class="flex-1">
            <div class="text-sm text-zinc-200">
              {{
                guestNickname ??
                (isGuest ? gomoku.settings.name1 : "等待对手加入…")
              }}
            </div>
            <div class="text-xs text-zinc-500">白棋 · 加入者</div>
          </div>
          <span v-if="isGuest" class="text-xs text-accent">你</span>
        </div>
      </div>

      <div v-if="isHost && hostInfo" :class="cardClass">
        <p class="text-xs text-zinc-500">分享连接信息</p>
        <p class="mt-1 font-mono text-sm text-zinc-200">
          {{ primaryAddress }}:{{ hostInfo.port }}
        </p>
        <button type="button" :class="btnGhost + ' mt-2 text-xs'" @click="copyInfo">
          {{ copied ? "已复制" : "复制连接信息" }}
        </button>
        <p class="mt-2 text-xs text-zinc-500">
          若对方连不上，请在 Windows 防火墙中允许本程序访问网络
        </p>
      </div>

      <p v-if="lastError" class="text-center text-sm text-amber-400">{{ lastError }}</p>
      <p v-if="graceRemaining !== null" class="text-center text-sm text-amber-400">
        等待对手重连（{{ graceRemaining }}s）
      </p>

      <div class="flex flex-col gap-2">
        <button
          v-if="isHost && canStart"
          type="button"
          :class="btnPrimary + ' w-full py-3'"
          @click="onStart"
        >
          开始游戏
        </button>
        <button type="button" :class="btnGhost + ' w-full'" @click="onLeave">离开房间</button>
      </div>
    </template>
  </div>
</template>
