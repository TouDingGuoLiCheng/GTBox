/** 原 Tk 版棋盘区参考尺寸与网格参数 */
export const SCENE_WIDTH = 1450;
export const SCENE_HEIGHT = 880;
export const GRID_ORIGIN_X = 325;
export const GRID_ORIGIN_Y = 35;
export const CELL_SIZE = 45;
export const BOARD_IMAGE_X = 300;
export const BOARD_IMAGE_Y = 10;
export const STONE_RADIUS = 20;

export interface SceneLayout {
  scale: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export function computeSceneLayout(containerWidth: number, containerHeight: number): SceneLayout {
  const scale = Math.min(containerWidth / SCENE_WIDTH, containerHeight / SCENE_HEIGHT);
  const width = SCENE_WIDTH * scale;
  const height = SCENE_HEIGHT * scale;
  const offsetX = (containerWidth - width) / 2;
  const offsetY = (containerHeight - height) / 2;
  return { scale, offsetX, offsetY, width, height };
}

export function gridToScene(row: number, col: number): { x: number; y: number } {
  return {
    x: GRID_ORIGIN_X + col * CELL_SIZE,
    y: GRID_ORIGIN_Y + row * CELL_SIZE,
  };
}

export function sceneToGrid(x: number, y: number): { row: number; col: number } | null {
  const col = Math.round((x - GRID_ORIGIN_X) / CELL_SIZE);
  const row = Math.round((y - GRID_ORIGIN_Y) / CELL_SIZE);
  if (row < 0 || row > 18 || col < 0 || col > 18) return null;
  return { row, col };
}

export function clientToScene(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  layout: SceneLayout,
): { x: number; y: number } | null {
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  if (
    localX < layout.offsetX ||
    localY < layout.offsetY ||
    localX > layout.offsetX + layout.width ||
    localY > layout.offsetY + layout.height
  ) {
    return null;
  }
  return {
    x: (localX - layout.offsetX) / layout.scale,
    y: (localY - layout.offsetY) / layout.scale,
  };
}

export function clientToGrid(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  layout: SceneLayout,
): { row: number; col: number } | null {
  const scene = clientToScene(clientX, clientY, rect, layout);
  if (!scene) return null;
  return sceneToGrid(scene.x, scene.y);
}
