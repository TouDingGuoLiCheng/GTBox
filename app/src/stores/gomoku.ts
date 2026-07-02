import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type {
  GameMode,
  GamePhase,
  GomokuSettings,
  GomokuSnapshot,
  PlayerLabels,
  Stone,
  WinReason,
} from "../types/gomoku";
import {
  DEFAULT_GOMOKU_SETTINGS,
  GOMOKU_SETTINGS_KEY,
  GOMOKU_SNAPSHOT_KEY,
} from "../types/gomoku";
import { pickAiMove } from "../utils/gomoku/ai";
import {
  CENTER,
  canPlace,
  checkWin,
  createEmptyBoard,
  isBoardFull,
  placeStone,
  stoneAtMove,
} from "../utils/gomoku/board";
import { randomComputerName } from "../utils/gomoku/names";
import { playSound, setBgmEnabled, setSoundEnabled, syncBgm } from "../utils/gomoku/sounds";
import { pushDebugLine } from "../utils/mediaDebug";
import {
  createTimerState,
  afterMove,
  isTimedOut,
  tickTimer,
  timeoutWinner,
  type TimerState,
} from "../utils/gomoku/timer";

function loadSettings(): GomokuSettings {
  try {
    const raw = localStorage.getItem(GOMOKU_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_GOMOKU_SETTINGS };
    return { ...DEFAULT_GOMOKU_SETTINGS, ...(JSON.parse(raw) as GomokuSettings) };
  } catch {
    return { ...DEFAULT_GOMOKU_SETTINGS };
  }
}

function saveSettings(settings: GomokuSettings) {
  localStorage.setItem(GOMOKU_SETTINGS_KEY, JSON.stringify(settings));
}

function loadSnapshot(): GomokuSnapshot | null {
  try {
    const raw = localStorage.getItem(GOMOKU_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GomokuSnapshot;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveSnapshot(snapshot: GomokuSnapshot | null) {
  if (!snapshot) {
    localStorage.removeItem(GOMOKU_SNAPSHOT_KEY);
    return;
  }
  localStorage.setItem(GOMOKU_SNAPSHOT_KEY, JSON.stringify(snapshot));
}

export const useGomokuStore = defineStore("gomoku", () => {
  const settings = ref<GomokuSettings>(loadSettings());
  const phase = ref<GamePhase>("menu");
  const mode = ref<GameMode>("pvc");
  const board = ref(createEmptyBoard());
  const moveCount = ref(0);
  const finished = ref(false);
  const winner = ref<Stone | null>(null);
  const winReason = ref<WinReason>(null);
  const labels = ref<PlayerLabels>({ black: settings.value.name1, white: randomComputerName() });
  const timer = ref<TimerState>(createTimerState(settings.value.perMoveSec, settings.value.totalSec));
  const hover = ref<{ row: number; col: number } | null>(null);
  const aiThinking = ref(false);
  const pendingResume = ref<GomokuSnapshot | null>(null);
  const lanRole = ref<"host" | "guest" | null>(null);
  const lanConnected = ref(true);
  const lastLanMove = ref<{ row: number; col: number } | null>(null);

  let timerHandle: ReturnType<typeof setInterval> | null = null;
  let aiHandle: ReturnType<typeof setTimeout> | null = null;
  let cvcHandle: ReturnType<typeof setInterval> | null = null;

  const activeStone = computed(() => stoneAtMove(moveCount.value));
  const canHumanPlay = computed(() => {
    if (phase.value !== "playing" || finished.value || aiThinking.value) return false;
    if (mode.value === "cvc") return false;
    if (mode.value === "pvc" && activeStone.value === 2) return false;
    if (mode.value === "pvn") {
      if (!lanConnected.value) return false;
      if (lanRole.value === "host" && activeStone.value !== 1) return false;
      if (lanRole.value === "guest" && activeStone.value !== 2) return false;
    }
    return true;
  });

  function persistSettings() {
    saveSettings(settings.value);
    setSoundEnabled(settings.value.soundEnabled);
    setBgmEnabled(settings.value.bgmEnabled);
  }

  function aiOptions() {
    return { difficulty: settings.value.aiDifficulty };
  }

  function buildSnapshot(): GomokuSnapshot {
    return {
      version: 1,
      mode: mode.value,
      board: board.value,
      moveCount: moveCount.value,
      finished: finished.value,
      winner: winner.value,
      winReason: winReason.value,
      p1MoveTime: timer.value.blackMove,
      p2MoveTime: timer.value.whiteMove,
      p1TotalTime: timer.value.blackTotal,
      p2TotalTime: timer.value.whiteTotal,
      labels: { ...labels.value },
    };
  }

  function persistSnapshot() {
    if (phase.value === "playing" && !finished.value) {
      saveSnapshot(buildSnapshot());
    } else {
      saveSnapshot(null);
    }
  }

  function clearTimers() {
    if (timerHandle) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
    if (aiHandle) {
      clearTimeout(aiHandle);
      aiHandle = null;
    }
    if (cvcHandle) {
      clearInterval(cvcHandle);
      cvcHandle = null;
    }
  }

  function finishGame(nextWinner: Stone, reason: WinReason) {
    finished.value = true;
    winner.value = nextWinner;
    winReason.value = reason;
    phase.value = "ended";
    aiThinking.value = false;
    clearTimers();
    syncBgm(false);
    playSound("gameEnd");
    saveSnapshot(null);
    pushDebugLine("五子棋", "game-end", reason ?? "unknown", {
      winner: nextWinner,
      reason,
      mode: mode.value,
    });
  }

  function applyMove(row: number, col: number, stone: Stone, options?: { sfx?: boolean }) {
    const playSfx = options?.sfx !== false;
    board.value = placeStone(board.value, row, col, stone);
    moveCount.value += 1;
    timer.value = afterMove(timer.value, stone, settings.value.perMoveSec);
    if (playSfx) playSound("place");

    if (checkWin(board.value, row, col)) {
      finishGame(stone, "five");
      return;
    }
    if (isBoardFull(board.value)) {
      finished.value = true;
      winner.value = null;
      winReason.value = "draw";
      phase.value = "ended";
      clearTimers();
      syncBgm(false);
      playSound("gameEnd");
      saveSnapshot(null);
      return;
    }
    persistSnapshot();
  }

  function scheduleAiTurn() {
    if (mode.value !== "pvc" || finished.value || activeStone.value !== 2) return;
    aiThinking.value = true;
    aiHandle = setTimeout(() => {
      aiHandle = null;
      if (finished.value || activeStone.value !== 2) {
        aiThinking.value = false;
        return;
      }
      const move = pickAiMove(board.value, aiOptions());
      aiThinking.value = false;
      if (!move) return;
      applyMove(move[0], move[1], 2);
      if (!finished.value) scheduleAiTurn();
    }, settings.value.aiDelayMs);
  }

  function scheduleCvcLoop() {
    if (mode.value !== "cvc" || finished.value) return;
    clearTimers();
    cvcHandle = setInterval(() => {
      if (finished.value || phase.value !== "playing") {
        clearTimers();
        return;
      }
      const stone = activeStone.value;
      const move = pickAiMove(board.value, aiOptions());
      if (!move) return;
      applyMove(move[0], move[1], stone);
    }, settings.value.cvcIntervalMs);
  }

  function startTimerLoop() {
    if (timerHandle) clearInterval(timerHandle);
    timerHandle = setInterval(() => {
      if (phase.value !== "playing" || finished.value || mode.value === "cvc") return;
      const stone = activeStone.value;
      timer.value = tickTimer(timer.value, stone);
      if (isTimedOut(timer.value, stone)) {
        finishGame(timeoutWinner(stone), "timeout");
      }
      persistSnapshot();
    }, 1000);
  }

  function setupLabels(nextMode: GameMode) {
    if (nextMode === "pvc") {
      labels.value = {
        black: settings.value.name1,
        white: randomComputerName(),
      };
    } else if (nextMode === "pvp" || nextMode === "pvn") {
      labels.value = {
        black: settings.value.name1,
        white: settings.value.name2,
      };
    } else {
      labels.value = {
        black: randomComputerName(),
        white: randomComputerName(),
      };
    }
  }

  function startGame(nextMode: GameMode) {
    pushDebugLine("五子棋", "start-game", nextMode, { mode: nextMode });
    clearTimers();
    persistSettings();
    mode.value = nextMode;
    phase.value = "playing";
    board.value = createEmptyBoard();
    moveCount.value = 0;
    finished.value = false;
    winner.value = null;
    winReason.value = null;
    hover.value = null;
    aiThinking.value = false;
    timer.value = createTimerState(settings.value.perMoveSec, settings.value.totalSec);
    setupLabels(nextMode);
    playSound("click");
    syncBgm(true);

    if (nextMode === "cvc") {
      board.value = placeStone(board.value, CENTER, CENTER, 1);
      moveCount.value = 1;
      scheduleCvcLoop();
    } else {
      startTimerLoop();
    }

    persistSnapshot();
    if (nextMode === "pvc" && activeStone.value === 2) scheduleAiTurn();
    pushDebugLine("五子棋", "game-start", nextMode);
  }

  function humanMove(row: number, col: number): boolean {
    if (!canHumanPlay.value) return false;
    if (!canPlace(board.value, row, col)) return false;
    const stone = activeStone.value;
    applyMove(row, col, stone, { sfx: false });
    if (!finished.value && mode.value === "pvc" && activeStone.value === 2) {
      scheduleAiTurn();
    }
    return true;
  }

  function startLanGame(side: "host" | "guest", nextLabels: PlayerLabels) {
    clearTimers();
    persistSettings();
    mode.value = "pvn";
    lanRole.value = side;
    lanConnected.value = true;
    phase.value = "playing";
    board.value = createEmptyBoard();
    moveCount.value = 0;
    finished.value = false;
    winner.value = null;
    winReason.value = null;
    hover.value = null;
    aiThinking.value = false;
    lastLanMove.value = null;
    timer.value = createTimerState(settings.value.perMoveSec, settings.value.totalSec);
    labels.value = { ...nextLabels };
    playSound("click");
    syncBgm(true);
    saveSnapshot(null);
    pushDebugLine("五子棋", "lan-game-start", side);
  }

  function applyLanState(payload: {
    board: Stone[][];
    moveCount: number;
    timer: TimerState;
    finished: boolean;
    winner: Stone | null;
    winReason: WinReason;
    lastMove: { row: number; col: number } | null;
  }) {
    const prevMoveCount = moveCount.value;
    board.value = payload.board;
    moveCount.value = payload.moveCount;
    timer.value = payload.timer;
    finished.value = payload.finished;
    winner.value = payload.winner;
    winReason.value = payload.winReason;
    lastLanMove.value = payload.lastMove;
    if (payload.moveCount > prevMoveCount) {
      playSound("place");
    }
    if (payload.finished) {
      phase.value = "ended";
      clearTimers();
      syncBgm(false);
      playSound("gameEnd");
      saveSnapshot(null);
    }
  }

  function finishLanGame(nextWinner: Stone | null, reason: WinReason) {
    finishGame(nextWinner ?? 1, reason);
  }

  function setLanConnected(connected: boolean) {
    lanConnected.value = connected;
  }

  function setHover(cell: { row: number; col: number } | null) {
    hover.value = cell;
  }

  function updateSettings(partial: Partial<GomokuSettings>) {
    settings.value = { ...settings.value, ...partial };
    persistSettings();
  }

  function restart() {
    if (mode.value === "pvn") {
      backToMenu();
      return;
    }
    pushDebugLine("五子棋", "game-restart", mode.value);
    startGame(mode.value);
  }

  function pauseSession() {
    clearTimers();
    syncBgm(false);
    aiThinking.value = false;
    persistSnapshot();
  }

  function enterLanHub() {
    phase.value = "lan_hub";
    pushDebugLine("五子棋", "enter-lan-hub");
  }

  function backToMenu() {
    pushDebugLine("五子棋", "back-to-menu");
    clearTimers();
    syncBgm(false);
    phase.value = "menu";
    hover.value = null;
    aiThinking.value = false;
    lanRole.value = null;
    lanConnected.value = true;
    lastLanMove.value = null;
    saveSnapshot(null);
  }

  function checkPendingResume() {
    const snap = loadSnapshot();
    if (snap && !snap.finished) pendingResume.value = snap;
  }

  function resumeGame() {
    const snap = pendingResume.value;
    if (!snap) return;
    clearTimers();
    mode.value = snap.mode;
    board.value = snap.board;
    moveCount.value = snap.moveCount;
    finished.value = snap.finished;
    winner.value = snap.winner;
    winReason.value = snap.winReason;
    labels.value = { ...snap.labels };
    timer.value = {
      blackMove: snap.p1MoveTime,
      whiteMove: snap.p2MoveTime,
      blackTotal: snap.p1TotalTime,
      whiteTotal: snap.p2TotalTime,
    };
    phase.value = snap.finished ? "ended" : "playing";
    pendingResume.value = null;
    hover.value = null;
    aiThinking.value = false;

    if (phase.value === "playing") {
      syncBgm(true);
      if (mode.value === "cvc") scheduleCvcLoop();
      else startTimerLoop();
      if (mode.value === "pvc" && activeStone.value === 2 && !finished.value) scheduleAiTurn();
    }
  }

  function discardResume() {
    pendingResume.value = null;
    saveSnapshot(null);
  }

  function init() {
    settings.value = loadSettings();
    setSoundEnabled(settings.value.soundEnabled);
    setBgmEnabled(settings.value.bgmEnabled);
    checkPendingResume();
  }

  return {
    settings,
    phase,
    mode,
    board,
    moveCount,
    finished,
    winner,
    winReason,
    labels,
    timer,
    hover,
    aiThinking,
    pendingResume,
    lanRole,
    lanConnected,
    lastLanMove,
    activeStone,
    canHumanPlay,
    startGame,
    humanMove,
    setHover,
    updateSettings,
    restart,
    backToMenu,
    enterLanHub,
    resumeGame,
    discardResume,
    init,
    pauseSession,
    startLanGame,
    applyLanState,
    finishLanGame,
    setLanConnected,
  };
});
