<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { computed, onMounted, onUnmounted, ref } from "vue";
import OverlayBar, { type OverlayPhase } from "./components/OverlayBar.vue";
import {
  OVERLAY_BAR_COUNT,
  OVERLAY_IDLE_BAR_HEIGHT,
  OVERLAY_SILENT_RMS,
} from "./overlayLayout";
import {
  overlayAppearanceFromSettings,
  applyOverlayTheme,
} from "./overlayTheme";
import type { OverlayAppearance, SrSettings } from "./types";

interface OverlayAppearanceEvent extends OverlayAppearance {
  backgroundDataUrl?: string | null;
}

interface OverlayUiState {
  phase: OverlayPhase;
  displayText: string;
  sessionId: string;
}

interface OverlayBootstrap {
  ui: OverlayUiState;
  settings: SrSettings;
  backgroundDataUrl?: string | null;
}

const VOICE_HOLD_MS = 2000;

const displayText = ref("");
const phase = ref<OverlayPhase>("listening");
const textEditedByUser = ref(false);
const levels = ref<number[]>(
  Array.from({ length: OVERLAY_BAR_COUNT }, () => OVERLAY_IDLE_BAR_HEIGHT),
);
const appearance = ref<OverlayAppearance>(
  overlayAppearanceFromSettings({
    appTheme: "dark",
    overlayOpacity: 88,
    overlayBackground: "",
    overlayBgLayout: { posX: 50, posY: 50, zoom: 100 },
    overlayTextColor: "",
    overlayWaveColor: "",
  } as SrSettings),
);
const bgDataUrl = ref<string | null>(null);
const writing = ref(false);
const voiceActive = ref(false);

applyOverlayTheme(appearance.value);

let voiceOffTimer: ReturnType<typeof setTimeout> | undefined;

const streamAnimate = computed(
  () => phase.value === "listening" && !textEditedByUser.value,
);

let unlistenPartial: (() => void) | undefined;
let unlistenStart: (() => void) | undefined;
let unlistenEnd: (() => void) | undefined;
let unlistenManualEnter: (() => void) | undefined;
let unlistenManualExit: (() => void) | undefined;
let unlistenReset: (() => void) | undefined;
let unlistenWritten: (() => void) | undefined;
let unlistenWriteResult: (() => void) | undefined;
let unlistenLevel: (() => void) | undefined;
let unlistenAppearance: (() => void) | undefined;
let unlistenSettings: (() => void) | undefined;
let unlistenOverlayState: (() => void) | undefined;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
const overlayWindow = getCurrentWindow();

function applyUiState(ui: OverlayUiState, fromUser = false) {
  phase.value = (ui.phase as OverlayPhase) ?? "listening";
  if (!fromUser && !textEditedByUser.value) {
    displayText.value = ui.displayText ?? "";
  }
  if (phase.value === "editing") {
    textEditedByUser.value = true;
    voiceActive.value = false;
    if (voiceOffTimer) {
      clearTimeout(voiceOffTimer);
      voiceOffTimer = undefined;
    }
  }
}

function applyAppearancePayload(p: OverlayAppearanceEvent) {
  appearance.value = {
    appTheme: p.appTheme === "light" ? "light" : "dark",
    overlayOpacity: p.overlayOpacity ?? 88,
    overlayBgLayout: p.overlayBgLayout ?? { posX: 50, posY: 50, zoom: 100 },
    overlayTextColor: p.overlayTextColor ?? "",
    overlayWaveColor: p.overlayWaveColor ?? "",
  };
  if (p.backgroundDataUrl !== undefined) {
    bgDataUrl.value = p.backgroundDataUrl;
  }
  applyOverlayTheme(appearance.value);
}

async function bootstrapFromBackend() {
  try {
    const boot = await invoke<OverlayBootstrap>("sr_overlay_bootstrap");
    applyAppearancePayload({
      ...overlayAppearanceFromSettings(boot.settings),
      backgroundDataUrl: boot.backgroundDataUrl ?? null,
    });
    applyUiState(boot.ui);
  } catch {
    /* ignore */
  }
}

function resetOverlay() {
  displayText.value = "";
  textEditedByUser.value = false;
  writing.value = false;
  voiceActive.value = false;
  if (voiceOffTimer) {
    clearTimeout(voiceOffTimer);
    voiceOffTimer = undefined;
  }
  phase.value = "listening";
  levels.value = Array.from({ length: OVERLAY_BAR_COUNT }, () => OVERLAY_IDLE_BAR_HEIGHT);
}

function setSilentLevels() {
  levels.value = Array.from({ length: OVERLAY_BAR_COUNT }, () => OVERLAY_IDLE_BAR_HEIGHT);
}

function updateLevels(rms: number) {
  if (phase.value === "editing") {
    return;
  }

  if (rms >= OVERLAY_SILENT_RMS) {
    if (voiceOffTimer) {
      clearTimeout(voiceOffTimer);
      voiceOffTimer = undefined;
    }
    voiceActive.value = true;
  } else if (!voiceOffTimer) {
    voiceOffTimer = setTimeout(() => {
      voiceActive.value = false;
      voiceOffTimer = undefined;
    }, VOICE_HOLD_MS);
  }

  if (rms < OVERLAY_SILENT_RMS) {
    setSilentLevels();
    return;
  }
  const t = Date.now() / 70;
  levels.value = Array.from({ length: OVERLAY_BAR_COUNT }, (_, i) => {
    const band = Math.sin(t * 1.6 + i * 0.42) * 0.35 + 0.65;
    const h = OVERLAY_IDLE_BAR_HEIGHT + rms * band * 28;
    return Math.max(OVERLAY_IDLE_BAR_HEIGHT, Math.min(32, h));
  });
}

function scheduleSyncText(text: string) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    void invoke("sr_sync_overlay_text", { text }).catch(() => {});
  }, 120);
}

async function onOverlayResize(height: number) {
  try {
    await invoke("sr_overlay_set_height", { height });
  } catch {
    /* ignore */
  }
}

async function saveOverlayPosition() {
  try {
    const pos = await overlayWindow.outerPosition();
    await invoke("sr_overlay_set_position", {
      x: Math.round(pos.x),
      y: Math.round(pos.y),
    });
  } catch {
    /* ignore */
  }
}

async function onOverlayDragStart() {
  try {
    await overlayWindow.startDragging();
  } catch {
    /* ignore */
  }
}

function onTextEdit() {
  textEditedByUser.value = true;
  scheduleSyncText(displayText.value);
}

async function enterManualEdit() {
  try {
    await invoke("sr_enter_manual_edit", { text: displayText.value });
    textEditedByUser.value = true;
    phase.value = "editing";
    voiceActive.value = false;
    if (voiceOffTimer) {
      clearTimeout(voiceOffTimer);
      voiceOffTimer = undefined;
    }
  } catch (e) {
    phase.value = "error";
    displayText.value = String(e);
  }
}

async function commitManualEdit() {
  try {
    await invoke("sr_exit_manual_edit", { text: displayText.value });
    textEditedByUser.value = false;
    phase.value = "listening";
  } catch (e) {
    phase.value = "error";
    displayText.value = String(e);
  }
}

async function writeSession() {
  if (writing.value || phase.value === "editing") return;
  writing.value = true;
  try {
    await invoke("sr_write_session", { text: displayText.value });
  } catch (e) {
    phase.value = "error";
    displayText.value = String(e);
  } finally {
    writing.value = false;
  }
}

async function copySession() {
  const text = displayText.value.trim();
  if (!text) return;
  await writeText(text);
}

async function closeOverlay() {
  await saveOverlayPosition();
  await invoke("sr_hide_overlay");
}

onMounted(async () => {
  await bootstrapFromBackend();

  unlistenOverlayState = await listen<OverlayUiState>("sr:overlay-state", (e) => {
    applyUiState(e.payload);
  });
  unlistenAppearance = await listen<OverlayAppearanceEvent>(
    "sr:overlay-appearance",
    (e) => applyAppearancePayload(e.payload),
  );
  unlistenSettings = await listen<SrSettings>("settings:updated", async (e) => {
    const s = e.payload;
    let url: string | null = null;
    try {
      url = await invoke<string | null>("get_overlay_background_data_url");
    } catch {
      /* ignore */
    }
    applyAppearancePayload({
      ...overlayAppearanceFromSettings(s),
      backgroundDataUrl: url,
    });
  });

  unlistenStart = await listen("sr:session-start", () => {
    resetOverlay();
  });
  unlistenPartial = await listen<{ text: string }>("sr:partial", (e) => {
    if (phase.value === "editing") return;
    const text = e.payload.text ?? "";
    if (!textEditedByUser.value) {
      displayText.value = text;
    }
    phase.value = "listening";
  });
  unlistenEnd = await listen<{ ok: boolean; text?: string; error?: string }>(
    "sr:session-end",
    (e) => {
      if (!e.payload.ok) {
        phase.value = "error";
        displayText.value = e.payload.error ?? "";
        textEditedByUser.value = false;
      }
    },
  );
  unlistenManualEnter = await listen<{ text: string }>("sr:manual-edit-enter", (e) => {
    displayText.value = e.payload.text ?? displayText.value;
    textEditedByUser.value = true;
    phase.value = "editing";
    voiceActive.value = false;
    if (voiceOffTimer) {
      clearTimeout(voiceOffTimer);
      voiceOffTimer = undefined;
    }
  });
  unlistenManualExit = await listen<{ text: string }>("sr:manual-edit-exit", (e) => {
    displayText.value = e.payload.text ?? displayText.value;
    textEditedByUser.value = false;
    phase.value = "listening";
  });
  unlistenReset = await listen("sr:session-reset", () => {
    resetOverlay();
  });
  unlistenWritten = await listen("sr:text-written", () => {
    writing.value = false;
    resetOverlay();
  });
  unlistenWriteResult = await listen<{ ok: boolean; error?: string }>(
    "sr:write-result",
    (e) => {
      writing.value = false;
      if (!e.payload.ok && e.payload.error) {
        phase.value = "error";
        displayText.value = e.payload.error;
      }
    },
  );
  unlistenLevel = await listen<{ rms: number }>("sr:level", (e) => {
    if (phase.value === "listening") {
      updateLevels(Math.min(1, Math.max(0, e.payload.rms ?? 0)));
    }
  });
});

onUnmounted(() => {
  if (syncTimer) clearTimeout(syncTimer);
  if (voiceOffTimer) clearTimeout(voiceOffTimer);
  unlistenPartial?.();
  unlistenStart?.();
  unlistenEnd?.();
  unlistenManualEnter?.();
  unlistenManualExit?.();
  unlistenReset?.();
  unlistenWritten?.();
  unlistenWriteResult?.();
  unlistenLevel?.();
  unlistenAppearance?.();
  unlistenSettings?.();
  unlistenOverlayState?.();
});
</script>

<template>
  <div class="overlay-stage">
    <OverlayBar
      v-model="displayText"
      :appearance="appearance"
      :background-data-url="bgDataUrl"
      :levels="levels"
      :phase="phase"
      :stream-animate="streamAnimate"
      :writing="writing"
      :voice-active="voiceActive"
      show-close
      @close="closeOverlay"
      @copy="copySession"
      @write="writeSession"
      @commit-edit="commitManualEdit"
      @enter-edit="enterManualEdit"
      @edit="onTextEdit"
      @resize="onOverlayResize"
      @drag-start="onOverlayDragStart"
    />
  </div>
</template>
