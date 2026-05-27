<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import OverlayPreview from "./components/OverlayPreview.vue";
import { ASR_ENGINE_OPTIONS } from "./engines";
import { DEFAULT_OVERLAY_BG_LAYOUT } from "./overlayBgLayout";
import { OVERLAY_PLACEMENT_OPTIONS } from "./overlayLayout";
import { applyAppTheme, normalizeSettings } from "./theme";
import { defaultOverlayWaveColor, normalizeOverlayWaveColor } from "./overlayTheme";
import type { AsrEngineId, AudioDeviceInfo, EngineStatus, SettingsTab, SrSettings } from "./types";

const defaultSettings = (): SrSettings => ({
  enabled: true,
  hotkey: "Alt+V",
  confirmHotkey: "Alt+Enter",
  bubbleTriggerMode: "click",
  asrEngine: "sherpa-onnx",
  modelDir: "",
  audioDeviceName: null,
  outputMode: "paste",
  restoreClipboard: true,
  appTheme: "light",
  launchAtStartup: false,
  clearLogOnStartup: true,
  overlayOpacity: 88,
  overlayBackground: "",
  overlayBgLayout: { ...DEFAULT_OVERLAY_BG_LAYOUT },
  overlayTextColor: "",
  overlayWaveColor: "",
  overlayPlacement: "bottom-center",
  overlayEdgeMargin: 12,
  overlayTrayGap: 72,
});

const placementOptions = OVERLAY_PLACEMENT_OPTIONS;

const settings = ref<SrSettings>(defaultSettings());
const engine = ref<EngineStatus>({ state: "loading" });
const devices = ref<AudioDeviceInfo[]>([]);
const devicesRefreshing = ref(false);
const saving = ref(false);
const message = ref("");
const activeTab = ref<SettingsTab>("engine");
const bgLocalPath = ref<string | null>(null);
const overlayPreviewRef = ref<InstanceType<typeof OverlayPreview> | null>(null);
const previewHover = ref(false);
const settingsBodyRef = ref<HTMLElement | null>(null);
const debugLogPath = ref("");
const debugLogText = ref("");
const debugLogLoading = ref(false);

const tabs: { id: SettingsTab; label: string }[] = [
  { id: "engine", label: "引擎" },
  { id: "input", label: "输入" },
  { id: "appearance", label: "外观" },
  { id: "diag", label: "诊断" },
];

const waveColorPicker = computed(() =>
  settings.value.overlayWaveColor.trim() || defaultOverlayWaveColor(settings.value.appTheme),
);

const systemDefaultMic = computed(() => devices.value.find((d) => d.isDefault));

const autoMicLabel = computed(() => {
  const name = systemDefaultMic.value?.name;
  if (!name) return "自动";
  const short = name.length > 22 ? `${name.slice(0, 20)}…` : name;
  return `自动（${short}）`;
});

let unlistenEngine: (() => void) | undefined;
let unlistenSettings: (() => void) | undefined;
let unlistenWindowFocus: (() => void) | undefined;

function selectEngine(id: AsrEngineId) {
  const opt = ASR_ENGINE_OPTIONS.find((e) => e.id === id);
  if (!opt?.available) return;
  settings.value.asrEngine = id;
}

function onWaveColorPick(e: Event) {
  settings.value.overlayWaveColor = normalizeOverlayWaveColor(
    (e.target as HTMLInputElement).value,
  );
}

function resetWaveColor() {
  settings.value.overlayWaveColor = "";
}

async function loadDebugLog() {
  debugLogLoading.value = true;
  try {
    debugLogPath.value = await invoke<string>("sr_debug_log_path");
    debugLogText.value = await invoke<string>("sr_read_debug_log", { maxLines: 300 });
  } catch (e) {
    debugLogText.value = String(e);
  } finally {
    debugLogLoading.value = false;
  }
}

async function clearDebugLog() {
  try {
    await invoke("sr_clear_debug_log");
    debugLogText.value = "";
    message.value = "日志已清除";
  } catch (e) {
    message.value = String(e);
  }
}

async function refreshAudioDevices() {
  if (devicesRefreshing.value) return;
  devicesRefreshing.value = true;
  try {
    devices.value = await invoke<AudioDeviceInfo[]>("sr_list_audio_devices");
  } catch (e) {
    message.value = String(e);
  } finally {
    devicesRefreshing.value = false;
  }
}

function onMicSelectInteract() {
  void refreshAudioDevices();
}

async function load() {
  settings.value = normalizeSettings({
    ...defaultSettings(),
    ...(await invoke<SrSettings>("sr_get_settings")),
  });
  applyAppTheme(settings.value);
  engine.value = await invoke<EngineStatus>("sr_engine_status");
  await refreshAudioDevices();
}

async function save() {
  saving.value = true;
  message.value = "";
  try {
    await invoke("sr_save_settings", { settings: settings.value });
    applyAppTheme(settings.value);
    message.value = "已保存";
    engine.value = await invoke<EngineStatus>("sr_engine_status");
  } catch (e) {
    message.value = String(e);
  } finally {
    saving.value = false;
  }
}

async function testOverlay() {
  message.value = "";
  try {
    await invoke("sr_test_overlay");
    message.value = "已显示测试悬浮条";
  } catch (e) {
    message.value = String(e);
  }
}

async function pickOverlayBackground() {
  try {
    const picked = await invoke<{ filename: string; fullPath: string }>(
      "pick_overlay_background",
    );
    bgLocalPath.value = picked.fullPath;
    settings.value = {
      ...settings.value,
      overlayBackground: picked.filename,
      overlayBgLayout: { ...DEFAULT_OVERLAY_BG_LAYOUT },
    };
    await overlayPreviewRef.value?.reloadBackground();
  } catch (e) {
    message.value = String(e);
  }
}

async function clearOverlayBackground() {
  try {
    await invoke("clear_overlay_background");
    bgLocalPath.value = null;
    settings.value = {
      ...settings.value,
      overlayBackground: "",
      overlayBgLayout: { ...DEFAULT_OVERLAY_BG_LAYOUT },
    };
    await overlayPreviewRef.value?.reloadBackground();
  } catch (e) {
    message.value = String(e);
  }
}

function onPreviewHoverChange(inside: boolean) {
  previewHover.value = inside;
}

function onSettingsWheelCapture(e: WheelEvent) {
  if (!previewHover.value) return;
  e.preventDefault();
}

async function hideToTray() {
  await invoke("sr_hide_to_tray");
}

async function startDrag(e: MouseEvent) {
  if (e.button !== 0) return;
  const t = e.target as HTMLElement;
  if (t.closest("button, a, input, select, .tab-bar, .footer-bar")) return;
  try {
    await getCurrentWindow().startDragging();
  } catch {
    /* ignore */
  }
}

function engineLabel(state: EngineStatus["state"]) {
  switch (state) {
    case "ready":
      return "就绪";
    case "loading":
      return "加载中";
    case "error":
      return "错误";
    default:
      return "空闲";
  }
}

watch(
  () => settings.value.appTheme,
  () => applyAppTheme(settings.value),
);

watch(activeTab, (tab) => {
  if (tab === "input") void refreshAudioDevices();
  if (tab === "diag" && !debugLogText.value) void loadDebugLog();
});

onMounted(async () => {
  await load();
  await nextTick();
  const opts: AddEventListenerOptions = { passive: false, capture: true };
  settingsBodyRef.value?.addEventListener("wheel", onSettingsWheelCapture, opts);
  unlistenEngine = await listen<EngineStatus>("sr:engine", (e) => {
    engine.value = e.payload;
  });
  unlistenSettings = await listen<SrSettings>("settings:updated", (e) => {
    settings.value = normalizeSettings({ ...settings.value, ...e.payload });
    applyAppTheme(settings.value);
    void overlayPreviewRef.value?.reloadBackground();
  });
  unlistenWindowFocus = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    if (focused) void refreshAudioDevices();
  });
});

onUnmounted(() => {
  settingsBodyRef.value?.removeEventListener("wheel", onSettingsWheelCapture, {
    capture: true,
  } as EventListenerOptions);
  unlistenEngine?.();
  unlistenSettings?.();
  unlistenWindowFocus?.();
});
</script>

<template>
  <div class="app-shell">
    <header
      class="titlebar"
      @mousedown="startDrag"
    >
      <div class="brand">
        <span class="brand-art">SR</span>
      </div>
      <button
        type="button"
        class="icon-btn"
        title="隐藏到托盘"
        aria-label="关闭"
        @click.stop="hideToTray"
      >
        ×
      </button>
    </header>

    <nav
      class="tab-bar"
      role="tablist"
    >
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        role="tab"
        class="tab"
        :class="{ active: activeTab === t.id }"
        :aria-selected="activeTab === t.id"
        :title="t.label"
        :aria-label="t.label"
        @click="activeTab = t.id"
      >
        <svg
          v-if="t.id === 'engine'"
          class="tab-ico"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2M8 8h8v8H8V8z"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
          />
        </svg>
        <svg
          v-else-if="t.id === 'input'"
          class="tab-ico"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm0 0v3m-5 2h10"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
          />
        </svg>
        <svg
          v-else-if="t.id === 'appearance'"
          class="tab-ico"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M12 3a9 9 0 1 0 9 9c0-1.2-.24-2.34-.68-3.38M12 3v9m0 0L8.5 8.5M12 12l3.5-3.5"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <svg
          v-else
          class="tab-ico"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linejoin="round"
          />
          <path
            d="M14 2v6h6M8 13h8M8 17h5"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </nav>

    <main
      ref="settingsBodyRef"
      class="scroll-main"
    >
      <!-- 引擎 -->
      <section
        v-show="activeTab === 'engine'"
        class="panel"
      >
        <div class="engine-list">
          <button
            v-for="opt in ASR_ENGINE_OPTIONS"
            :key="opt.id"
            type="button"
            class="engine-card"
            :class="{
              active: settings.asrEngine === opt.id,
              disabled: !opt.available,
            }"
            :disabled="!opt.available"
            @click="selectEngine(opt.id as AsrEngineId)"
          >
            <span class="engine-card__name">{{ opt.name }}</span>
            <span
              v-if="opt.badge"
              class="engine-card__badge"
            >{{ opt.badge }}</span>
            <span
              v-else-if="settings.asrEngine === opt.id"
              class="badge"
              :class="engine.state"
            >{{ engineLabel(engine.state) }}</span>
          </button>
        </div>
        <p
          v-if="engine.message"
          class="status-msg"
        >
          {{ engine.message }}
        </p>
      </section>

      <!-- 输入 -->
      <section
        v-show="activeTab === 'input'"
        class="panel"
      >
        <label class="field row">
          <input
            v-model="settings.enabled"
            type="checkbox"
          />
          <span>启用快捷键</span>
        </label>
        <label class="field">
          <span>触发</span>
          <select v-model="settings.bubbleTriggerMode">
            <option value="click">
              单击
            </option>
            <option value="hold">
              长按
            </option>
          </select>
        </label>
        <div class="field-grid">
          <label class="field">
            <span>说话</span>
            <input
              v-model="settings.hotkey"
              type="text"
              spellcheck="false"
            />
          </label>
          <label class="field">
            <span>确认</span>
            <input
              v-model="settings.confirmHotkey"
              type="text"
              spellcheck="false"
            />
          </label>
        </div>
        <label class="field">
          <span>麦克风</span>
          <div class="row gap">
            <select
              v-model="settings.audioDeviceName"
              class="mic-select"
              @focus="onMicSelectInteract"
              @click="onMicSelectInteract"
            >
              <option :value="null">
                {{ autoMicLabel }}
              </option>
              <option
                v-for="d in devices"
                :key="d.name"
                :value="d.name"
              >
                {{ d.name }}
              </option>
            </select>
            <button
              type="button"
              class="btn icon-only"
              title="刷新设备"
              :disabled="devicesRefreshing"
              @click="refreshAudioDevices"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                width="14"
                height="14"
              >
                <path
                  d="M4 12a8 8 0 0 1 13.66-5.66M20 12a8 8 0 0 1-13.66 5.66M20 4v5h-5M4 20v-5h5"
                  stroke="currentColor"
                  stroke-width="1.75"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          </div>
        </label>
        <label class="field">
          <span>输出</span>
          <select v-model="settings.outputMode">
            <option value="paste">
              粘贴
            </option>
            <option value="clipboard">
              剪贴板
            </option>
          </select>
        </label>
        <label
          v-if="settings.outputMode === 'paste'"
          class="field row"
        >
          <input
            v-model="settings.restoreClipboard"
            type="checkbox"
          />
          <span>恢复原剪贴板</span>
        </label>
        <label class="field row">
          <input
            v-model="settings.launchAtStartup"
            type="checkbox"
          />
          <span>开机启动</span>
        </label>
      </section>

      <!-- 外观 -->
      <section
        v-show="activeTab === 'appearance'"
        class="panel"
      >
        <div class="theme-picker">
          <button
            type="button"
            class="theme-card"
            :class="{ active: settings.appTheme === 'light' }"
            title="浅色"
            @click="settings.appTheme = 'light'"
          >
            <span class="theme-swatch light" />
          </button>
          <button
            type="button"
            class="theme-card"
            :class="{ active: settings.appTheme === 'dark' }"
            title="深色"
            @click="settings.appTheme = 'dark'"
          >
            <span class="theme-swatch dark" />
          </button>
        </div>

        <OverlayPreview
          ref="overlayPreviewRef"
          v-model:layout="settings.overlayBgLayout"
          :settings="settings"
          :local-image-path="bgLocalPath"
          @hover-change="onPreviewHoverChange"
        />

        <label class="field compact">
          <span>不透明度 {{ settings.overlayOpacity }}%</span>
          <input
            v-model.number="settings.overlayOpacity"
            type="range"
            min="50"
            max="100"
            step="1"
          />
        </label>
        <label class="field compact">
          <span>音波</span>
          <div class="row gap wave-color-row">
            <input
              class="wave-color-swatch"
              type="color"
              :value="waveColorPicker"
              title="音波颜色"
              @input="onWaveColorPick"
            />
            <button
              type="button"
              class="btn secondary sm"
              :disabled="!settings.overlayWaveColor"
              @click="resetWaveColor"
            >
              默认
            </button>
          </div>
        </label>

        <div class="row gap">
          <button
            type="button"
            class="btn secondary sm"
            @click="pickOverlayBackground"
          >
            背景图
          </button>
          <button
            type="button"
            class="btn secondary sm"
            :disabled="!settings.overlayBackground && !bgLocalPath"
            @click="clearOverlayBackground"
          >
            清除
          </button>
          <button
            type="button"
            class="btn secondary sm"
            @click="testOverlay"
          >
            预览
          </button>
        </div>

        <label class="field compact">
          <span>位置</span>
          <select v-model="settings.overlayPlacement">
            <option
              v-for="p in placementOptions"
              :key="p.value"
              :value="p.value"
            >
              {{ p.label }}
            </option>
          </select>
        </label>
        <label class="field compact">
          <span>边距 {{ settings.overlayEdgeMargin }}px</span>
          <input
            v-model.number="settings.overlayEdgeMargin"
            type="range"
            min="0"
            max="80"
            step="2"
          />
        </label>
        <label
          v-if="settings.overlayPlacement.startsWith('bottom')"
          class="field compact"
        >
          <span>托盘间距 {{ settings.overlayTrayGap }}px</span>
          <input
            v-model.number="settings.overlayTrayGap"
            type="range"
            min="40"
            max="140"
            step="4"
          />
        </label>
      </section>

      <!-- 诊断 -->
      <section
        v-show="activeTab === 'diag'"
        class="panel"
      >
        <label class="field row">
          <input
            v-model="settings.clearLogOnStartup"
            type="checkbox"
          />
          <span>启动时清除日志</span>
        </label>
        <div class="row gap">
          <button
            type="button"
            class="btn secondary sm"
            :disabled="debugLogLoading"
            @click="loadDebugLog"
          >
            {{ debugLogLoading ? "…" : "刷新日志" }}
          </button>
          <button
            type="button"
            class="btn secondary sm"
            @click="clearDebugLog"
          >
            立即清除
          </button>
        </div>
        <p
          v-if="debugLogPath"
          class="log-path"
        >
          {{ debugLogPath }}
        </p>
        <pre
          v-if="debugLogText"
          class="debug-log"
        >{{ debugLogText }}</pre>
      </section>
    </main>

    <footer class="footer-bar">
      <p
        v-if="message"
        class="footer-msg"
        :class="{ error: /失败|错误/.test(message) }"
      >
        {{ message }}
      </p>
      <button
        type="button"
        class="btn primary save-btn"
        :disabled="saving"
        @click="save"
      >
        {{ saving ? "…" : "保存" }}
      </button>
    </footer>
  </div>
</template>

<style scoped>
.app-shell {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--shell-bg);
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 10px;
}

.titlebar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 10px 8px 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  user-select: none;
  cursor: default;
}

.brand-art {
  font-family: "Orbitron", "Segoe UI", sans-serif;
  font-size: 1.1rem;
  font-weight: 800;
  letter-spacing: 0.2em;
  background: linear-gradient(120deg, #5b8def 0%, #7ee8fa 45%, #c4b5fd 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.icon-btn {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font-size: 1.1rem;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-btn:hover {
  background: var(--btn-ghost-hover);
  color: var(--text);
}

.tab-bar {
  flex-shrink: 0;
  display: flex;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  padding: 8px;
  background: transparent;
  color: var(--muted);
}

.tab.active {
  background: var(--tab-active);
  color: var(--accent);
}

.tab-ico {
  width: 18px;
  height: 18px;
}

.scroll-main {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 10px;
}

.scroll-main::-webkit-scrollbar {
  width: 5px;
}

.scroll-main::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.engine-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.engine-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  font-size: 0.78rem;
  text-align: left;
}

.engine-card.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

.engine-card.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.engine-card__name {
  font-weight: 600;
}

.engine-card__badge {
  font-size: 0.62rem;
  color: var(--muted);
}

.status-msg {
  margin: 0;
  font-size: 0.68rem;
  color: var(--danger);
  line-height: 1.4;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.7rem;
  color: var(--muted);
}

.field.compact {
  gap: 3px;
}

.field.row {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  color: var(--text);
  font-size: 0.74rem;
}

.field input[type="text"],
.field select {
  padding: 7px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--input-bg);
  color: var(--text);
  font-size: 0.75rem;
}

.field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.row {
  display: flex;
  align-items: center;
}

.row.gap {
  gap: 6px;
}

.row.gap select.mic-select {
  flex: 1;
  min-width: 0;
}

.wave-color-row {
  align-items: center;
}

.wave-color-swatch {
  flex: 0 0 32px;
  width: 32px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
}

.field input[type="range"] {
  width: 100%;
  accent-color: var(--accent);
}

.badge {
  font-size: 0.65rem;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--btn-ghost-hover);
}

.badge.ready {
  color: var(--ok);
}

.badge.error {
  color: var(--danger);
}

.badge.loading {
  color: var(--warn);
}

.btn {
  border: none;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 0.72rem;
}

.btn.sm {
  padding: 5px 8px;
  font-size: 0.68rem;
}

.btn.icon-only {
  padding: 6px;
  flex-shrink: 0;
  background: var(--btn-ghost-hover);
  color: var(--text);
}

.btn.primary {
  background: var(--accent);
  color: var(--accent-text);
}

.btn.secondary {
  background: var(--btn-ghost-hover);
  color: var(--text);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.theme-picker {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.theme-card {
  padding: 6px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--panel);
}

.theme-card.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

.theme-swatch {
  display: block;
  width: 100%;
  height: 24px;
  border-radius: 5px;
  border: 1px solid var(--border);
}

.theme-swatch.light {
  background: linear-gradient(180deg, #f8f8fc, #e8e8f0);
}

.theme-swatch.dark {
  background: linear-gradient(180deg, #2a2a34, #14141a);
}

.log-path {
  margin: 0;
  font-size: 0.6rem;
  color: var(--muted);
  word-break: break-all;
  font-family: ui-monospace, Consolas, monospace;
}

.debug-log {
  margin: 0;
  padding: 8px;
  max-height: 240px;
  overflow: auto;
  font-size: 0.6rem;
  line-height: 1.4;
  font-family: ui-monospace, Consolas, monospace;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text);
}

.footer-bar {
  flex-shrink: 0;
  padding: 8px 10px 10px;
  border-top: 1px solid var(--border);
  background: var(--surface);
}

.footer-msg {
  margin: 0 0 6px;
  font-size: 0.66rem;
  color: var(--muted);
}

.footer-msg.error {
  color: var(--danger);
}

.save-btn {
  width: 100%;
}
</style>
