import { invoke } from "@tauri-apps/api/core";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type {
  ConnectionStatus,
  DiscoveredRoom,
  LanHostInfo,
  LanHubPhase,
  LanReconnectSession,
  LanRole,
} from "../types/gomokuLan";
import {
  DEFAULT_LAN_PORT,
  DEFAULT_RECONNECT_GRACE_SEC,
  GOMOKU_LAN_RECONNECT_KEY,
} from "../types/gomokuLan";
import { GomokuLanClient } from "../utils/gomoku/lanClient";
import { canPlace } from "../utils/gomoku/board";
import { buildWsUrl } from "../utils/gomoku/lanProtocol";
import {
  createHostSession,
  hostApplyLocalMove,
  hostGraceTick,
  hostGuestJoined,
  hostGuestLeft,
  hostGuestReconnected,
  hostHandleGuestMove,
  hostLobbyState,
  hostStartGame as emitHostStart,
  hostTickTimer,
  type HostSession,
} from "../utils/gomoku/lanHost";
import { playSound } from "../utils/gomoku/sounds";
import { pushDebugLine } from "../utils/mediaDebug";
import { useGomokuStore } from "./gomoku";

function loadReconnectSession(): LanReconnectSession | null {
  try {
    const raw = localStorage.getItem(GOMOKU_LAN_RECONNECT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LanReconnectSession;
  } catch {
    return null;
  }
}

function saveReconnectSession(session: LanReconnectSession | null) {
  if (!session) {
    localStorage.removeItem(GOMOKU_LAN_RECONNECT_KEY);
    return;
  }
  localStorage.setItem(GOMOKU_LAN_RECONNECT_KEY, JSON.stringify(session));
}

function randomToken() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const useGomokuLanStore = defineStore("gomokuLan", () => {
  const hubPhase = ref<LanHubPhase>("hub");
  const role = ref<LanRole | null>(null);
  const connectionStatus = ref<ConnectionStatus>("idle");
  const connectionError = ref<string | null>(null);
  const hostInfo = ref<LanHostInfo | null>(null);
  const discoveredRooms = ref<DiscoveredRoom[]>([]);
  const discovering = ref(false);
  const discoverySettled = ref(false);
  const guestNickname = ref<string | null>(null);
  const hostNickname = ref<string | null>(null);
  const canStart = ref(false);
  const graceRemaining = ref<number | null>(null);
  const lastError = ref<string | null>(null);
  const manualHost = ref("");
  const manualPort = ref(DEFAULT_LAN_PORT);
  const showManual = ref(false);
  const pendingReconnect = ref<LanReconnectSession | null>(loadReconnectSession());

  const client = new GomokuLanClient();
  let hostSession: HostSession | null = null;
  let hostTimerHandle: ReturnType<typeof setInterval> | null = null;
  let graceHandle: ReturnType<typeof setInterval> | null = null;
  let discoveryGeneration = 0;
  let reconnectToken = "";

  const isInLanFlow = computed(() => hubPhase.value !== "hub" || role.value !== null);
  const isHost = computed(() => role.value === "host");
  const isGuest = computed(() => role.value === "guest");
  const isConnected = computed(() => connectionStatus.value === "connected");
  const primaryAddress = computed(() => {
    if (!hostInfo.value?.addresses.length) return "127.0.0.1";
    return hostInfo.value.addresses[0];
  });
  const connectionLabel = computed(() => {
    switch (connectionStatus.value) {
      case "connecting":
        return "连接中…";
      case "connected":
        return "已连接";
      case "disconnected":
        return "已断开";
      case "reconnecting":
        return "重连中…";
      default:
        return "";
    }
  });

  function clearHostTimers() {
    if (hostTimerHandle) {
      clearInterval(hostTimerHandle);
      hostTimerHandle = null;
    }
    if (graceHandle) {
      clearInterval(graceHandle);
      graceHandle = null;
    }
  }

  function broadcastRaw(messages: string[]) {
    for (const raw of messages) {
      client.sendRaw(raw);
    }
  }

  function applyRemoteState(msg: Extract<import("../types/gomokuLan").LanMessage, { type: "state" }>) {
    const gomoku = useGomokuStore();
    gomoku.applyLanState({
      board: msg.board,
      moveCount: msg.moveCount,
      timer: msg.timer,
      finished: msg.finished,
      winner: msg.winner,
      winReason: msg.winReason,
      lastMove: msg.lastMove,
    });
    reconnectToken = msg.reconnectToken;
    persistReconnect();
  }

  function persistReconnect() {
    if (!role.value || !hostInfo.value && !manualHost.value) return;
    if (!reconnectToken) return;
    const gomoku = useGomokuStore();
    if (gomoku.phase !== "playing" && hubPhase.value !== "waiting") return;

    const host = isHost.value
      ? primaryAddress.value
      : manualHost.value.trim() || primaryAddress.value;
    const port = hostInfo.value?.port ?? manualPort.value;

    saveReconnectSession({
      role: role.value,
      host,
      port,
      token: reconnectToken,
      nickname: gomoku.settings.name1,
    });
  }

  function handleHostMessage(msg: import("../types/gomokuLan").LanMessage) {
    if (!hostSession || !hostInfo.value) return;

    if (msg.type === "hello" && msg.role === "guest") {
      if (hostSession.started && msg.reconnectToken === hostSession.reconnectToken) {
        const result = hostGuestReconnected(hostSession, msg.nickname);
        hostSession = result.session;
        guestNickname.value = msg.nickname;
        graceRemaining.value = null;
        broadcastRaw(result.messages);
        connectionStatus.value = "connected";
        playSound("click");
        return;
      }
      if (hostSession.started) {
        client.sendRaw(
          JSON.stringify({
            version: 1,
            type: "error",
            message: "对局进行中，无法加入",
          }),
        );
        return;
      }
      const result = hostGuestJoined(
        hostSession,
        msg.nickname,
        hostInfo.value.roomId,
        hostInfo.value.port,
        hostInfo.value.addresses,
      );
      hostSession = result.session;
      guestNickname.value = msg.nickname;
      canStart.value = true;
      broadcastRaw(result.messages);
      playSound("click");
      return;
    }

    if (msg.type === "move") {
      const result = hostHandleGuestMove(hostSession, msg.row, msg.col);
      hostSession = result.session;
      if (result.error) {
        client.sendRaw(
          JSON.stringify({ version: 1, type: "error", message: result.error }),
        );
        return;
      }
      broadcastRaw(result.messages);
      const stateMsg = result.messages
        .map((m) => JSON.parse(m))
        .find((m) => m.type === "state");
      if (stateMsg) applyRemoteState(stateMsg);
      if (hostSession.finished) {
        clearHostTimers();
        saveReconnectSession(null);
      }
    }
  }

  function handleClientMessage(msg: import("../types/gomokuLan").LanMessage) {
    const gomoku = useGomokuStore();
    lastError.value = null;

    if (msg.type === "error") {
      lastError.value = msg.message;
      return;
    }

    if (isHost.value) {
      handleHostMessage(msg);
      return;
    }

    switch (msg.type) {
      case "lobby_state":
        hostNickname.value = msg.hostNickname;
        guestNickname.value = msg.guestNickname;
        canStart.value = msg.canStart;
        hostInfo.value = {
          roomId: msg.roomId,
          port: msg.port,
          addresses: msg.addresses,
        };
        hubPhase.value = "waiting";
        break;
      case "start":
        reconnectToken = msg.reconnectToken;
        gomoku.startLanGame("guest", {
          black: hostNickname.value ?? "房主",
          white: gomoku.settings.name1,
        });
        hubPhase.value = "waiting";
        persistReconnect();
        playSound("click");
        break;
      case "state":
        applyRemoteState(msg);
        break;
      case "game_over":
        gomoku.finishLanGame(msg.winner, msg.reason);
        saveReconnectSession(null);
        break;
      case "peer_left":
        connectionStatus.value = "disconnected";
        useGomokuStore().setLanConnected(false);
        lastError.value = "对手已离开";
        break;
      case "peer_disconnected":
        graceRemaining.value = msg.graceSec;
        connectionStatus.value = "disconnected";
        lastError.value = `对手掉线，等待重连（${msg.graceSec}s）`;
        break;
      case "grace_tick":
        graceRemaining.value = msg.remainingSec;
        lastError.value = `对手掉线，等待重连（${msg.remainingSec}s）`;
        break;
      case "reconnected":
        graceRemaining.value = null;
        connectionStatus.value = "connected";
        lastError.value = null;
        playSound("click");
        break;
      default:
        break;
    }
  }

  function connectWs(url: string) {
    hubPhase.value = "connecting";
    connectionStatus.value = "connecting";
    connectionError.value = null;
    client.connect(url, {
      onMessage: handleClientMessage,
      onStatus: (status, detail) => {
        if (status === "open") {
          connectionStatus.value = "connected";
          connectionError.value = null;
          pushDebugLine("五子棋", "lan-ws-open", url);
          useGomokuStore().setLanConnected(true);
          const gomoku = useGomokuStore();
          client.sendHello(role.value!, gomoku.settings.name1, reconnectToken || undefined);
          if (isHost.value && hostInfo.value && hostSession) {
            client.sendRaw(
              JSON.stringify(
                hostLobbyState(
                  hostSession,
                  hostInfo.value.roomId,
                  hostInfo.value.port,
                  hostInfo.value.addresses,
                ),
              ),
            );
          }
        } else if (status === "connecting") {
          connectionStatus.value = "connecting";
        } else if (status === "closed") {
          connectionStatus.value = "disconnected";
          pushDebugLine("五子棋", "lan-ws-closed");
          useGomokuStore().setLanConnected(false);
          if (isHost.value && hostSession?.started) {
            startHostGrace();
          }
        } else if (status === "error") {
          connectionStatus.value = "disconnected";
          pushDebugLine("五子棋", "lan-ws-error", detail ?? "连接失败");
          useGomokuStore().setLanConnected(false);
          connectionError.value =
            detail ?? "无法连接，请检查是否同一 WiFi、防火墙是否放行";
          hubPhase.value = "hub";
        }
      },
    });
  }

  function startHostGrace() {
    if (!hostSession?.started || !hostInfo.value) return;
    clearHostTimers();
    const grace = DEFAULT_RECONNECT_GRACE_SEC;
    const result = hostGuestLeft(
      hostSession,
      hostInfo.value.roomId,
      hostInfo.value.port,
      hostInfo.value.addresses,
      grace,
    );
    hostSession = result.session;
    graceRemaining.value = grace;
    broadcastRaw(result.messages);

    graceHandle = setInterval(() => {
      if (!hostSession) return;
      const tick = hostGraceTick(hostSession);
      hostSession = tick.session;
      broadcastRaw(tick.messages);
      graceRemaining.value = hostSession.graceRemaining;
      if (tick.timedOut) {
        clearHostTimers();
        const gomoku = useGomokuStore();
        gomoku.finishLanGame(1, "timeout");
        saveReconnectSession(null);
      }
    }, 1000);
  }

  function startHostTimerLoop() {
    clearHostTimers();
    hostTimerHandle = setInterval(() => {
      if (!hostSession?.started || hostSession.finished) return;
      const result = hostTickTimer(hostSession);
      hostSession = result.session;
      if (result.messages.length) {
        broadcastRaw(result.messages);
        const stateMsg = result.messages
          .map((m) => JSON.parse(m))
          .find((m) => m.type === "state");
        if (stateMsg) applyRemoteState(stateMsg);
      }
      if (hostSession.finished) {
        clearHostTimers();
        saveReconnectSession(null);
      }
    }, 1000);
  }

  async function createRoom() {
    await leaveRoom({ silent: true });
    pushDebugLine("五子棋", "lan-create-room");
    const gomoku = useGomokuStore();
    role.value = "host";
    reconnectToken = randomToken();
    hubPhase.value = "connecting";
    connectionStatus.value = "connecting";

    try {
      const info = await invoke<LanHostInfo>("gomoku_lan_start", {
        port: manualPort.value,
        nickname: gomoku.settings.name1,
      });
      hostInfo.value = info;
      hostSession = createHostSession(
        gomoku.settings.name1,
        gomoku.settings.perMoveSec,
        gomoku.settings.totalSec,
        reconnectToken,
      );
      canStart.value = false;
      guestNickname.value = null;
      hubPhase.value = "waiting";
      const url = buildWsUrl("127.0.0.1", info.port);
      connectWs(url);
      playSound("click");
    } catch (e) {
      connectionError.value = String(e);
      pushDebugLine("五子棋", "lan-create-fail", String(e));
      hubPhase.value = "hub";
      role.value = null;
    }
  }

  async function joinRoom(host: string, port: number) {
    await leaveRoom({ silent: true });
    pushDebugLine("五子棋", "lan-join", `${host}:${port}`, { host, port });
    role.value = "guest";
    manualHost.value = host;
    manualPort.value = port;
    hubPhase.value = "connecting";
    const url = buildWsUrl(host, port);
    connectWs(url);
  }

  async function joinDiscovered(room: DiscoveredRoom) {
    await joinRoom(room.host, room.port);
  }

  async function joinManual() {
    const host = manualHost.value.trim();
    if (!host) {
      connectionError.value = "请输入主机 IP 地址";
      return;
    }
    await joinRoom(host, manualPort.value);
  }

  function cancelDiscovery() {
    discoveryGeneration += 1;
    discovering.value = false;
  }

  async function refreshDiscovery() {
    const gen = discoveryGeneration + 1;
    discoveryGeneration = gen;
    discovering.value = true;
    discoverySettled.value = false;
    pushDebugLine("五子棋", "lan-discover-start");
    try {
      const rooms = await invoke<DiscoveredRoom[]>("gomoku_lan_discover", {
        timeoutMs: 2500,
      });
      if (gen !== discoveryGeneration) return;
      discoveredRooms.value = rooms;
      pushDebugLine("五子棋", "lan-discover-done", `${rooms.length} 个房间`, {
        count: rooms.length,
      });
    } catch (e) {
      if (gen !== discoveryGeneration) return;
      discoveredRooms.value = [];
      pushDebugLine("五子棋", "lan-discover-fail", String(e));
    } finally {
      if (gen !== discoveryGeneration) return;
      discovering.value = false;
      discoverySettled.value = true;
    }
  }

  function hostStartGame() {
    if (!isHost.value || !hostSession || !canStart.value) return;
    pushDebugLine("五子棋", "lan-start-game");
    const gomoku = useGomokuStore();
    const result = emitHostStart(hostSession);
    hostSession = result.session;
    broadcastRaw(result.messages);
    gomoku.startLanGame("host", {
      black: gomoku.settings.name1,
      white: hostSession.guestNickname ?? "对手",
    });
    reconnectToken = hostSession.reconnectToken;
    persistReconnect();
    startHostTimerLoop();
    playSound("click");
  }

  function hostMove(row: number, col: number) {
    if (!isHost.value || !hostSession) return false;
    const result = hostApplyLocalMove(hostSession, row, col);
    hostSession = result.session;
    if (result.error) {
      lastError.value = result.error;
      return false;
    }
    broadcastRaw(result.messages);
    const stateMsg = result.messages
      .map((m) => JSON.parse(m))
      .find((m) => m.type === "state");
    if (stateMsg) applyRemoteState(stateMsg);
    if (hostSession.finished) {
      clearHostTimers();
      saveReconnectSession(null);
    }
    return true;
  }

  function guestMove(row: number, col: number) {
    if (!isGuest.value || !client.isOpen) return false;
    const gomoku = useGomokuStore();
    if (!canPlace(gomoku.board, row, col)) return false;
    client.send({ version: 1, type: "move", row, col });
    return true;
  }

  function tryLanMove(row: number, col: number): boolean {
    if (isHost.value) return hostMove(row, col);
    if (isGuest.value) return guestMove(row, col);
    return false;
  }

  async function leaveRoom(options?: { silent?: boolean }) {
    pushDebugLine("五子棋", "lan-leave", options?.silent ? "silent" : "user");
    clearHostTimers();
    cancelDiscovery();
    client.disconnect();
    try {
      await invoke("gomoku_lan_stop");
    } catch {
      /* ignore */
    }
    hostSession = null;
    role.value = null;
    hubPhase.value = "hub";
    connectionStatus.value = "idle";
    connectionError.value = null;
    hostInfo.value = null;
    guestNickname.value = null;
    canStart.value = false;
    graceRemaining.value = null;
    lastError.value = null;
    if (!options?.silent) {
      const gomoku = useGomokuStore();
      if (gomoku.mode === "pvn") {
        gomoku.backToMenu();
      }
    }
  }

  async function enterLanHub() {
    hubPhase.value = "hub";
    role.value = null;
    discoveredRooms.value = [];
    pushDebugLine("五子棋", "lan-hub-enter");
    await refreshDiscovery();
  }

  async function exitLanHub() {
    pushDebugLine("五子棋", "lan-hub-exit");
    cancelDiscovery();
    discoverySettled.value = false;
    discoveredRooms.value = [];
    await leaveRoom({ silent: true });
  }

  async function tryReconnectPending() {
    const pending = pendingReconnect.value;
    if (!pending) return false;
    pendingReconnect.value = null;
    reconnectToken = pending.token;
    role.value = pending.role;
    manualHost.value = pending.host;
    manualPort.value = pending.port;
    hubPhase.value = "connecting";
    if (pending.role === "host") {
      try {
        const info = await invoke<LanHostInfo>("gomoku_lan_start", {
          port: pending.port,
          nickname: pending.nickname,
        });
        hostInfo.value = info;
        hostSession = createHostSession(
          pending.nickname,
          useGomokuStore().settings.perMoveSec,
          useGomokuStore().settings.totalSec,
          pending.token,
        );
        hostSession.started = true;
      } catch {
        return false;
      }
    }
    connectWs(buildWsUrl(pending.role === "host" ? "127.0.0.1" : pending.host, pending.port));
    return true;
  }

  function dismissReconnect() {
    pendingReconnect.value = null;
    saveReconnectSession(null);
  }

  function copyConnectionInfo() {
    if (!hostInfo.value) return "";
    const addr = primaryAddress.value;
    return `${addr}:${hostInfo.value.port}（房间 ${hostInfo.value.roomId}）`;
  }

  return {
    hubPhase,
    role,
    connectionStatus,
    connectionError,
    hostInfo,
    discoveredRooms,
    discovering,
    discoverySettled,
    guestNickname,
    hostNickname,
    canStart,
    graceRemaining,
    lastError,
    manualHost,
    manualPort,
    showManual,
    pendingReconnect,
    isInLanFlow,
    isHost,
    isGuest,
    isConnected,
    primaryAddress,
    connectionLabel,
    createRoom,
    joinRoom,
    joinDiscovered,
    joinManual,
    refreshDiscovery,
    hostStartGame,
    tryLanMove,
    leaveRoom,
    enterLanHub,
    exitLanHub,
    tryReconnectPending,
    dismissReconnect,
    copyConnectionInfo,
  };
});
