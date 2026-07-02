import type { Stone, WinReason } from "./gomoku";
import type { TimerState } from "../utils/gomoku/timer";

export const LAN_PROTOCOL_VERSION = 1;
export const DEFAULT_LAN_PORT = 8765;
export const GOMOKU_LAN_RECONNECT_KEY = "gomoku:lan:reconnect";
export const DEFAULT_RECONNECT_GRACE_SEC = 75;

export type LanRole = "host" | "guest";
export type LanHubPhase = "hub" | "waiting" | "connecting";
export type ConnectionStatus = "idle" | "connecting" | "connected" | "disconnected" | "reconnecting";

export interface LanHostInfo {
  roomId: string;
  port: number;
  addresses: string[];
}

export interface DiscoveredRoom {
  roomId: string;
  host: string;
  port: number;
  nickname: string;
}

export interface LanReconnectSession {
  role: LanRole;
  host: string;
  port: number;
  token: string;
  nickname: string;
}

export interface LanLastMove {
  row: number;
  col: number;
}

export type LanMessage =
  | { version: 1; type: "hello"; role: LanRole; nickname: string; reconnectToken?: string }
  | {
      version: 1;
      type: "lobby_state";
      hostNickname: string;
      guestNickname: string | null;
      canStart: boolean;
      roomId: string;
      port: number;
      addresses: string[];
    }
  | { version: 1; type: "start"; perMoveSec: number; totalSec: number; reconnectToken: string }
  | { version: 1; type: "move"; row: number; col: number }
  | {
      version: 1;
      type: "state";
      board: Stone[][];
      moveCount: number;
      lastMove: LanLastMove | null;
      timer: TimerState;
      finished: boolean;
      winner: Stone | null;
      winReason: WinReason;
      reconnectToken: string;
    }
  | { version: 1; type: "game_over"; winner: Stone | null; reason: WinReason }
  | { version: 1; type: "error"; message: string }
  | { version: 1; type: "peer_left" }
  | { version: 1; type: "peer_disconnected"; graceSec: number }
  | { version: 1; type: "reconnected"; nickname: string }
  | { version: 1; type: "grace_tick"; remainingSec: number };
