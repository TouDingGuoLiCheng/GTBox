import type { Stone } from "../../types/gomoku";

export const BOARD_SIZE = 19;
export const CENTER = 9;

const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
] as const;

export function createEmptyBoard(): Stone[][] {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => 0 as Stone),
  );
}

export function cloneBoard(board: Stone[][]): Stone[][] {
  return board.map((row) => [...row]);
}

export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

export function getStone(board: Stone[][], row: number, col: number): number {
  if (!inBounds(row, col)) return -1;
  return board[row][col];
}

export function stoneAtMove(moveCount: number): Stone {
  return moveCount % 2 === 0 ? 1 : 2;
}

export function canPlace(board: Stone[][], row: number, col: number): boolean {
  return inBounds(row, col) && board[row][col] === 0;
}

export function placeStone(
  board: Stone[][],
  row: number,
  col: number,
  stone: Stone,
): Stone[][] {
  if (!canPlace(board, row, col)) {
    throw new Error(`Invalid move at (${row}, ${col})`);
  }
  const next = cloneBoard(board);
  next[row][col] = stone;
  return next;
}

export function countLine(
  board: Stone[][],
  row: number,
  col: number,
  stone: Stone,
  dr: number,
  dc: number,
): number {
  let count = 1;
  let r = row + dr;
  let c = col + dc;
  while (getStone(board, r, c) === stone) {
    count += 1;
    r += dr;
    c += dc;
  }
  r = row - dr;
  c = col - dc;
  while (getStone(board, r, c) === stone) {
    count += 1;
    r -= dr;
    c -= dc;
  }
  return count;
}

export function checkWin(board: Stone[][], row: number, col: number): boolean {
  const stone = board[row][col];
  if (stone === 0) return false;
  return DIRECTIONS.some(([dr, dc]) => countLine(board, row, col, stone, dr, dc) >= 5);
}

export function isBoardFull(board: Stone[][]): boolean {
  return board.every((row) => row.every((cell) => cell !== 0));
}

export function listOccupied(board: Stone[][]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let r = 0; r < BOARD_SIZE; r += 1) {
    for (let c = 0; c < BOARD_SIZE; c += 1) {
      if (board[r][c] !== 0) out.push([r, c]);
    }
  }
  return out;
}
