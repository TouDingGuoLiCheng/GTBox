import { describe, expect, it } from "vitest";
import { ATTACK3, DEFENSE, scorePattern } from "./patterns";
import { pickAiMove } from "./ai";
import { CENTER, canPlace, createEmptyBoard, placeStone } from "./board";

describe("gomoku patterns", () => {
  it("scores defense patterns higher than default", () => {
    expect(scorePattern(DEFENSE[0], "standard")).toBeGreaterThan(1_000_000);
  });

  it("lowers mid-tier attack bias in easy mode", () => {
    const sample = ATTACK3[0];
    expect(scorePattern(sample, "easy")).toBeLessThan(scorePattern(sample, "standard"));
  });

  it("keeps critical defense in easy mode", () => {
    expect(scorePattern(DEFENSE[0], "easy")).toBeGreaterThan(1_000_000);
  });
});

describe("gomoku ai", () => {
  it("opens at center on empty board", () => {
    expect(pickAiMove(createEmptyBoard())).toEqual([CENTER, CENTER]);
  });

  it("plays a legal move adjacent to existing stones", () => {
    const board = placeStone(createEmptyBoard(), 9, 9, 1);
    const move = pickAiMove(board, { difficulty: "standard" });
    expect(move).not.toBeNull();
    if (!move) return;
    const [row, col] = move;
    expect(canPlace(board, row, col)).toBe(true);
    const near =
      Math.abs(row - 9) <= 2 &&
      Math.abs(col - 9) <= 2 &&
      !(row === 9 && col === 9);
    expect(near).toBe(true);
  });
});
