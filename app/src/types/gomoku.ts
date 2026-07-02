export type Stone = 0 | 1 | 2;

export type GameMode = "pvc" | "pvp" | "cvc" | "pvn";

export type GamePhase = "menu" | "lan_hub" | "playing" | "ended";

export type WinReason = "five" | "timeout" | "draw" | null;

export type AiDifficulty = "easy" | "standard";

export interface GomokuSettings {
  perMoveSec: number;
  totalSec: number;
  name1: string;
  name2: string;
  soundEnabled: boolean;
  bgmEnabled: boolean;
  aiDifficulty: AiDifficulty;
  aiDelayMs: number;
  cvcIntervalMs: number;
}

export interface PlayerLabels {
  black: string;
  white: string;
}

export interface GomokuSnapshot {
  version: 1;
  mode: GameMode;
  board: Stone[][];
  moveCount: number;
  finished: boolean;
  winner: Stone | null;
  winReason: WinReason;
  p1MoveTime: number;
  p2MoveTime: number;
  p1TotalTime: number;
  p2TotalTime: number;
  labels: PlayerLabels;
}

export const DEFAULT_GOMOKU_SETTINGS: GomokuSettings = {
  perMoveSec: 60,
  totalSec: 600,
  name1: "头顶果粒橙",
  name2: "吃个太空人",
  soundEnabled: true,
  bgmEnabled: false,
  aiDifficulty: "standard",
  aiDelayMs: 500,
  cvcIntervalMs: 400,
};

export const GOMOKU_SETTINGS_KEY = "gomoku:settings";
export const GOMOKU_SNAPSHOT_KEY = "gomoku:snapshot";
