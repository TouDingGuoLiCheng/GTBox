import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { onBeforeUnmount, ref, type Ref } from "vue";
import { pushDebugLine } from "../utils/mediaDebug";
import type { SpeedPlayerDiagnostics, SpeedPlayerSiteId } from "../types/speedPlayer";

async function measureHostRect(host: HTMLElement) {
  const rect = host.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function boundsKey(bounds: { x: number; y: number; width: number; height: number }) {
  return [
    Math.round(bounds.x),
    Math.round(bounds.y),
    Math.round(bounds.width),
    Math.round(bounds.height),
  ].join(":");
}

export function useSpeedPlayerWebview(
  hostRef: Ref<HTMLElement | null>,
  siteId: Ref<SpeedPlayerSiteId | null>,
) {
  const attached = ref(false);
  const tauriReady = isTauri();
  const diagnostics = ref<SpeedPlayerDiagnostics | null>(null);

  let resizeObserver: ResizeObserver | null = null;
  let unlistenResize: (() => void) | null = null;
  let unlistenMove: (() => void) | null = null;
  let syncTimer: ReturnType<typeof setInterval> | null = null;
  let diagTimer: ReturnType<typeof setInterval> | null = null;
  let lastBoundsKey = "";
  let lastLoggedVideoId = "";

  async function pollDiagnostics() {
    if (!tauriReady || !attached.value) return;
    try {
      const diag = await invoke<SpeedPlayerDiagnostics | null>("speed_player_diagnostics");
      diagnostics.value = diag;
      if (!diag) return;
      if (!diag.injected) {
        pushDebugLine("倍速播放器", "inject-fail", diag.error ?? "unknown");
        return;
      }
      if (diag.videoId && diag.videoId !== lastLoggedVideoId) {
        lastLoggedVideoId = diag.videoId;
        pushDebugLine("倍速播放器", "video", diag.videoId, {
          target: diag.targetRate,
          actual: diag.actualRate,
          corrections: diag.rateCorrections ?? 0,
        });
      }
      if (diag.drift) {
        pushDebugLine("倍速播放器", "rate-drift", diag.videoId ?? "", {
          target: diag.targetRate,
          actual: diag.actualRate,
        });
      }
    } catch (err) {
      pushDebugLine("倍速播放器", "diag-fail", String(err));
    }
  }

  async function syncBounds() {
    const host = hostRef.value;
    const site = siteId.value;
    if (!host || !site || !tauriReady) return;
    const bounds = await measureHostRect(host);
    if (bounds.width < 8 || bounds.height < 8) return;

    const key = boundsKey(bounds);
    if (key === lastBoundsKey && attached.value) return;
    lastBoundsKey = key;

    try {
      if (!attached.value) {
        await invoke("speed_player_attach", {
          site,
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        });
        attached.value = true;
        pushDebugLine("倍速播放器", "attach", site, bounds);
        void pollDiagnostics();
      } else {
        await invoke("speed_player_resize", bounds);
      }
    } catch (err) {
      pushDebugLine("倍速播放器", "sync-fail", String(err));
    }
  }

  async function attach() {
    attached.value = false;
    lastBoundsKey = "";
    await syncBounds();
  }

  async function detach() {
    if (!tauriReady || !attached.value) return;
    try {
      await invoke("speed_player_detach");
      pushDebugLine("倍速播放器", "detach");
    } catch (err) {
      pushDebugLine("倍速播放器", "detach-fail", String(err));
    } finally {
      attached.value = false;
      lastBoundsKey = "";
      diagnostics.value = null;
    }
  }

  async function focusWebview() {
    if (!tauriReady || !attached.value) return;
    try {
      await invoke("speed_player_focus");
    } catch {
      /* ignore */
    }
  }

  function startWatch() {
    const host = hostRef.value;
    if (!host) return;

    resizeObserver = new ResizeObserver(() => {
      void syncBounds();
    });
    resizeObserver.observe(host);

    if (tauriReady) {
      const win = getCurrentWindow();
      void win.onResized(() => {
        lastBoundsKey = "";
        void syncBounds();
      }).then((fn) => {
        unlistenResize = fn;
      });
      void win.onMoved(() => {
        lastBoundsKey = "";
        void syncBounds();
      }).then((fn) => {
        unlistenMove = fn;
      });
    }

    syncTimer = setInterval(() => {
      void syncBounds();
    }, 1000);

    diagTimer = setInterval(() => {
      void pollDiagnostics();
    }, 12000);
  }

  function stopWatch() {
    resizeObserver?.disconnect();
    resizeObserver = null;
    unlistenResize?.();
    unlistenResize = null;
    unlistenMove?.();
    unlistenMove = null;
    if (syncTimer) {
      clearInterval(syncTimer);
      syncTimer = null;
    }
    if (diagTimer) {
      clearInterval(diagTimer);
      diagTimer = null;
    }
  }

  onBeforeUnmount(() => {
    stopWatch();
    void detach();
  });

  return {
    tauriReady,
    attached,
    diagnostics,
    attach,
    detach,
    syncBounds,
    focusWebview,
    pollDiagnostics,
    startWatch,
    stopWatch,
  };
}
