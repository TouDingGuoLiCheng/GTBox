import type { AiDifficulty, Stone } from "../../types/gomoku";
import {
  BOARD_SIZE,
  CENTER,
  canPlace,
  getStone,
  listOccupied,
} from "./board";
import { scorePattern } from "./patterns";

type BoardGrid = Stone[][];

export interface AiOptions {
  difficulty?: AiDifficulty;
}

function padList(list: number[], target = 7): number[] {
  const out = [...list];
  while (out.length < target) out.push(-1);
  return out;
}

function buildLineLists(
  board: BoardGrid,
  row: number,
  col: number,
  dr: number,
  dc: number,
): { left: number[]; right: number[]; mix: number[] } {
  const left: number[] = [];
  const right: number[] = [];

  if (dr === 0) {
    left.push(getStone(board, row, col + 1));
    right.push(getStone(board, row, col - 1));
  } else if (dc === 0) {
    left.push(getStone(board, row + 1, col));
    right.push(getStone(board, row - 1, col));
  } else if (dr === 1 && dc === 1) {
    left.push(getStone(board, row - 1, col + 1));
    right.push(getStone(board, row + 1, col - 1));
  } else {
    left.push(getStone(board, row + 1, col + 1));
    right.push(getStone(board, row - 1, col - 1));
  }

  let r = row;
  let c = col;
  for (let i = 0; i < 6; i += 1) {
    right.push(getStone(board, r, c));
    r += dr;
    c += dc;
  }

  r = row;
  c = col;
  for (let i = 0; i < 6; i += 1) {
    left.push(getStone(board, r, c));
    r -= dr;
    c -= dc;
  }

  const leftPadded = padList(left);
  const rightPadded = padList(right);
  const mix = [...leftPadded.slice(2, 5).reverse(), 3, ...rightPadded.slice(2, 5)];

  return { left: leftPadded, right: rightPadded, mix };
}

function rowValue(
  board: BoardGrid,
  row: number,
  col: number,
  dr: number,
  dc: number,
  difficulty: AiDifficulty,
): number {
  const { left, right, mix } = buildLineLists(board, row, col, dr, dc);
  return (
    scorePattern(left, difficulty) +
    scorePattern(right, difficulty) +
    scorePattern(mix, difficulty)
  );
}

function cellValue(
  board: BoardGrid,
  row: number,
  col: number,
  difficulty: AiDifficulty,
): number {
  if (!canPlace(board, row, col)) return Number.NEGATIVE_INFINITY;
  return (
    rowValue(board, row, col, 0, 1, difficulty) +
    rowValue(board, row, col, 1, 0, difficulty) +
    rowValue(board, row, col, -1, 1, difficulty) +
    rowValue(board, row, col, 1, 1, difficulty)
  );
}

function hasNeighbor(board: BoardGrid, row: number, col: number, radius = 2): boolean {
  for (let dr = -radius; dr <= radius; dr += 1) {
    for (let dc = -radius; dc <= radius; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] !== 0) {
        return true;
      }
    }
  }
  return false;
}

function candidateCells(board: BoardGrid): Array<[number, number]> {
  const occupied = listOccupied(board);
  if (occupied.length === 0) return [[CENTER, CENTER]];

  const set = new Set<string>();
  for (const [row, col] of occupied) {
    for (let dr = -2; dr <= 2; dr += 1) {
      for (let dc = -2; dc <= 2; dc += 1) {
        const r = row + dr;
        const c = col + dc;
        if (canPlace(board, r, c) && hasNeighbor(board, r, c)) {
          set.add(`${r},${c}`);
        }
      }
    }
  }
  return [...set].map((key) => {
    const [r, c] = key.split(",").map(Number);
    return [r, c] as [number, number];
  });
}

export function pickAiMove(board: BoardGrid, options: AiOptions = {}): [number, number] | null {
  const difficulty = options.difficulty ?? "standard";
  const candidates = candidateCells(board);
  if (candidates.length === 0) return null;

  const ranked = candidates
    .map(([row, col]) => ({ row, col, score: cellValue(board, row, col, difficulty) }))
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) return null;

  if (difficulty === "easy" && ranked.length > 1 && Math.random() < 0.28) {
    const pool = ranked.slice(0, Math.min(3, ranked.length));
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return [pick.row, pick.col];
  }

  return [ranked[0].row, ranked[0].col];
}
