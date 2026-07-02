import { describe, expect, it } from "vitest";
import {
  BOARD_SIZE,
  CENTER,
  checkWin,
  createEmptyBoard,
  placeStone,
  stoneAtMove,
} from "./board";

describe("gomoku board", () => {
  it("creates empty 19x19 board", () => {
    const board = createEmptyBoard();
    expect(board.length).toBe(BOARD_SIZE);
    expect(board[0].length).toBe(BOARD_SIZE);
    expect(board[CENTER][CENTER]).toBe(0);
  });

  it("alternates stone color by move count", () => {
    expect(stoneAtMove(0)).toBe(1);
    expect(stoneAtMove(1)).toBe(2);
    expect(stoneAtMove(2)).toBe(1);
  });

  it("detects horizontal five", () => {
    let board = createEmptyBoard();
    for (let c = 0; c < 5; c += 1) {
      board = placeStone(board, 9, c, 1);
    }
    expect(checkWin(board, 9, 4)).toBe(true);
  });

  it("detects vertical five", () => {
    let board = createEmptyBoard();
    for (let r = 0; r < 5; r += 1) {
      board = placeStone(board, r, 9, 2);
    }
    expect(checkWin(board, 4, 9)).toBe(true);
  });

  it("detects diagonal five", () => {
    let board = createEmptyBoard();
    for (let i = 0; i < 5; i += 1) {
      board = placeStone(board, i, i, 1);
    }
    expect(checkWin(board, 4, 4)).toBe(true);
  });

  it("rejects invalid placement", () => {
    const board = placeStone(createEmptyBoard(), 3, 3, 1);
    expect(() => placeStone(board, 3, 3, 2)).toThrow();
  });
});
