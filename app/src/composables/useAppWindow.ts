import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, type Window } from "@tauri-apps/api/window";

let cached: Window | null = null;

export function appWindow(): Window | null {
  if (!isTauri()) return null;
  cached ??= getCurrentWindow();
  return cached;
}

export async function isAppFullscreen(): Promise<boolean> {
  const win = appWindow();
  if (!win) return false;
  try {
    return await win.isFullscreen();
  } catch {
    return false;
  }
}

export async function setAppFullscreen(fullscreen: boolean): Promise<void> {
  const win = appWindow();
  if (!win) return;
  try {
    await win.setFullscreen(fullscreen);
  } catch (err) {
    console.error("setFullscreen failed:", err);
  }
}

export async function toggleAppFullscreen(): Promise<boolean> {
  const next = !(await isAppFullscreen());
  await setAppFullscreen(next);
  return next;
}

export async function startWindowDrag(e: MouseEvent) {
  const win = appWindow();
  if (!win || e.button !== 0) return;
  if ((e.target as HTMLElement).closest("a, button, input, [data-no-drag]")) return;
  try {
    await win.startDragging();
  } catch (err) {
    console.error("startDragging failed:", err);
  }
}
