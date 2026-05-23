import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { canDesktopPeek, type DesktopPeekPrefs } from "../utils/desktopPeek";

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 同步 WebView 透明底；控件保持不透明，不调节整窗 HWND alpha */
export async function syncDesktopPeekWindow(
  scheme: string,
  hasCustomWallpaper: boolean,
  prefs: DesktopPeekPrefs,
  surfaceHex: string,
): Promise<void> {
  if (!isTauri()) return;

  const active = canDesktopPeek(scheme, hasCustomWallpaper, prefs);
  const win = getCurrentWindow();

  try {
    if (active) {
      await win.setBackgroundColor({ red: 0, green: 0, blue: 0, alpha: 0 });
      await invoke("set_window_desktop_peek", {
        enabled: true,
        opacityPercent: 255,
      });
    } else {
      const [r, g, b] = hexToRgb(surfaceHex);
      await win.setBackgroundColor({
        red: r / 255,
        green: g / 255,
        blue: b / 255,
        alpha: 1,
      });
      await invoke("set_window_desktop_peek", {
        enabled: false,
        opacityPercent: 255,
      });
    }
  } catch (err) {
    console.warn("syncDesktopPeekWindow:", err);
  }
}
