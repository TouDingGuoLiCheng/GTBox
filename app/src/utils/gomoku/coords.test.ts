import { describe, expect, it } from "vitest";
import {
  CELL_SIZE,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Y,
  clientToGrid,
  computeSceneLayout,
  gridToScene,
  sceneToGrid,
} from "./coords";

describe("gomoku coords", () => {
  it("maps center grid to scene coordinates", () => {
    const { x, y } = gridToScene(9, 9);
    expect(x).toBe(GRID_ORIGIN_X + 9 * CELL_SIZE);
    expect(y).toBe(GRID_ORIGIN_Y + 9 * CELL_SIZE);
  });

  it("round-trips grid through scene space", () => {
    for (const row of [0, 9, 18]) {
      for (const col of [0, 9, 18]) {
        const { x, y } = gridToScene(row, col);
        const back = sceneToGrid(x, y);
        expect(back).toEqual({ row, col });
      }
    }
  });

  it("maps client clicks through scaled layout", () => {
    const layout = computeSceneLayout(800, 500);
    const center = gridToScene(9, 9);
    const clientX = layout.offsetX + center.x * layout.scale;
    const clientY = layout.offsetY + center.y * layout.scale;
    const rect = {
      left: 0,
      top: 0,
      width: 800,
      height: 500,
    } as DOMRect;
    const cell = clientToGrid(clientX, clientY, rect, layout);
    expect(cell).toEqual({ row: 9, col: 9 });
  });
});
