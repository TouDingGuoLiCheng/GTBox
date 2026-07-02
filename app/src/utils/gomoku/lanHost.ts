import type { Stone, WinReason } from "../../types/gomoku";
import type { LanMessage } from "../../types/gomokuLan";
import type { TimerState } from "./timer";
import {
  checkWin,
  createEmptyBoard,
  isBoardFull,
  placeStone,
  stoneAtMove,
} from "./board";
import {
  afterMove,
  createTimerState,
  isTimedOut,
  tickTimer,
  timeoutWinner,
} from "./timer";
import { serializeLanMessage } from "./lanProtocol";

export interface HostSession {
  board: Stone[][];
  moveCount: number;
  finished: boolean;
  winner: Stone | null;
  winReason: WinReason;
  timer: TimerState;
  perMoveSec: number;
  totalSec: number;
  hostNickname: string;
  guestNickname: string | null;
  started: boolean;
  reconnectToken: string;
  lastMove: { row: number; col: number } | null;
  graceRemaining: number | null;
}

export function createHostSession(
  hostNickname: string,
  perMoveSec: number,
  totalSec: number,
  reconnectToken: string,
): HostSession {
  return {
    board: createEmptyBoard(),
    moveCount: 0,
    finished: false,
    winner: null,
    winReason: null,
    timer: createTimerState(perMoveSec, totalSec),
    perMoveSec,
    totalSec,
    hostNickname,
    guestNickname: null,
    started: false,
    reconnectToken,
    lastMove: null,
    graceRemaining: null,
  };
}

export function hostLobbyState(
  session: HostSession,
  roomId: string,
  port: number,
  addresses: string[],
): LanMessage {
  return {
    version: 1,
    type: "lobby_state",
    hostNickname: session.hostNickname,
    guestNickname: session.guestNickname,
    canStart: session.guestNickname !== null && !session.started,
    roomId,
    port,
    addresses,
  };
}

export function hostStartGame(session: HostSession): { session: HostSession; messages: string[] } {
  const next = { ...session, started: true };
  return {
    session: next,
    messages: [
      serializeLanMessage({
        version: 1,
        type: "start",
        perMoveSec: next.perMoveSec,
        totalSec: next.totalSec,
        reconnectToken: next.reconnectToken,
      }),
      serializeLanMessage(hostStateMessage(next)),
    ],
  };
}

export function hostStateMessage(session: HostSession): LanMessage {
  return {
    version: 1,
    type: "state",
    board: session.board,
    moveCount: session.moveCount,
    lastMove: session.lastMove,
    timer: session.timer,
    finished: session.finished,
    winner: session.winner,
    winReason: session.winReason,
    reconnectToken: session.reconnectToken,
  };
}

function finishHostSession(
  session: HostSession,
  winner: Stone | null,
  reason: WinReason,
): { session: HostSession; messages: string[] } {
  const next: HostSession = {
    ...session,
    finished: true,
    winner,
    winReason: reason,
  };
  return {
    session: next,
    messages: [
      serializeLanMessage(hostStateMessage(next)),
      serializeLanMessage({
        version: 1,
        type: "game_over",
        winner,
        reason,
      }),
    ],
  };
}

export function hostApplyLocalMove(
  session: HostSession,
  row: number,
  col: number,
): { session: HostSession; messages: string[]; error?: string } {
  if (!session.started || session.finished) {
    return { session, messages: [], error: "对局未开始或已结束" };
  }
  if (session.graceRemaining !== null) {
    return { session, messages: [], error: "等待对手重连中" };
  }
  const stone: Stone = 1;
  if (stoneAtMove(session.moveCount) !== stone) {
    return { session, messages: [], error: "尚未轮到您落子" };
  }
  if (session.board[row]?.[col] !== 0) {
    return { session, messages: [], error: "该位置已有棋子" };
  }

  const board = placeStone(session.board, row, col, stone);
  const moveCount = session.moveCount + 1;
  const timer = afterMove(session.timer, stone, session.perMoveSec);
  let next: HostSession = {
    ...session,
    board,
    moveCount,
    timer,
    lastMove: { row, col },
  };

  if (checkWin(board, row, col)) {
    return finishHostSession(next, stone, "five");
  }
  if (isBoardFull(board)) {
    return finishHostSession(next, null, "draw");
  }

  return {
    session: next,
    messages: [serializeLanMessage(hostStateMessage(next))],
  };
}

export function hostHandleGuestMove(
  session: HostSession,
  row: number,
  col: number,
): { session: HostSession; messages: string[]; error?: string } {
  if (!session.started || session.finished) {
    return { session, messages: [], error: "对局未开始或已结束" };
  }
  if (session.graceRemaining !== null) {
    return { session, messages: [], error: "等待对手重连中" };
  }
  const stone: Stone = 2;
  if (stoneAtMove(session.moveCount) !== stone) {
    return { session, messages: [], error: "尚未轮到对方落子" };
  }
  if (session.board[row]?.[col] !== 0) {
    return { session, messages: [], error: "该位置已有棋子" };
  }

  const board = placeStone(session.board, row, col, stone);
  const moveCount = session.moveCount + 1;
  const timer = afterMove(session.timer, stone, session.perMoveSec);
  let next: HostSession = {
    ...session,
    board,
    moveCount,
    timer,
    lastMove: { row, col },
  };

  if (checkWin(board, row, col)) {
    return finishHostSession(next, stone, "five");
  }
  if (isBoardFull(board)) {
    return finishHostSession(next, null, "draw");
  }

  return {
    session: next,
    messages: [serializeLanMessage(hostStateMessage(next))],
  };
}

export function hostTickTimer(session: HostSession): {
  session: HostSession;
  messages: string[];
} {
  if (!session.started || session.finished || session.graceRemaining !== null) {
    return { session, messages: [] };
  }
  const active = stoneAtMove(session.moveCount);
  const timer = tickTimer(session.timer, active);
  const next = { ...session, timer };
  if (isTimedOut(timer, active)) {
    const result = finishHostSession(next, timeoutWinner(active), "timeout");
    return result;
  }
  return {
    session: next,
    messages: [serializeLanMessage(hostStateMessage(next))],
  };
}

export function hostGuestJoined(
  session: HostSession,
  nickname: string,
  roomId: string,
  port: number,
  addresses: string[],
): { session: HostSession; messages: string[] } {
  const next = { ...session, guestNickname: nickname };
  return {
    session: next,
    messages: [serializeLanMessage(hostLobbyState(next, roomId, port, addresses))],
  };
}

export function hostGuestLeft(
  session: HostSession,
  roomId: string,
  port: number,
  addresses: string[],
  graceSec: number,
): { session: HostSession; messages: string[] } {
  if (!session.started) {
    const next = { ...session, guestNickname: null };
    return {
      session: next,
      messages: [serializeLanMessage(hostLobbyState(next, roomId, port, addresses))],
    };
  }
  const next = { ...session, graceRemaining: graceSec };
  return {
    session: next,
    messages: [
      serializeLanMessage({
        version: 1,
        type: "peer_disconnected",
        graceSec,
      }),
      serializeLanMessage({
        version: 1,
        type: "grace_tick",
        remainingSec: graceSec,
      }),
    ],
  };
}

export function hostGraceTick(session: HostSession): {
  session: HostSession;
  messages: string[];
  timedOut: boolean;
} {
  if (session.graceRemaining === null) {
    return { session, messages: [], timedOut: false };
  }
  const remaining = session.graceRemaining - 1;
  if (remaining <= 0) {
    const result = finishHostSession(session, 1, "timeout");
    return { ...result, timedOut: true };
  }
  const next = { ...session, graceRemaining: remaining };
  return {
    session: next,
    messages: [
      serializeLanMessage({
        version: 1,
        type: "grace_tick",
        remainingSec: remaining,
      }),
    ],
    timedOut: false,
  };
}

export function hostGuestReconnected(
  session: HostSession,
  nickname: string,
): { session: HostSession; messages: string[] } {
  const next = {
    ...session,
    guestNickname: nickname,
    graceRemaining: null,
  };
  const messages = [
    serializeLanMessage({
      version: 1,
      type: "reconnected",
      nickname,
    }),
  ];
  if (next.started) {
    messages.push(serializeLanMessage(hostStateMessage(next)));
  }
  return { session: next, messages };
}
