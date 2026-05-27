<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
  overlayBgImageStyle,
  overlayCssVars,
  overlayGlassStyle,
} from "../overlayTheme";
import {
  OVERLAY_FOOTER_HEIGHT,
  OVERLAY_MAX_TEXT_HEIGHT,
  OVERLAY_TEXT_PADDING_Y,
  clampOverlayHeight,
} from "../overlayLayout";
import {
  diffAnimatedChars,
  resetAnimatedCharKeys,
  type AnimatedChar,
} from "../overlayTextAnimate";
import type { OverlayAppearance } from "../types";

export type OverlayPhase = "listening" | "editing" | "error" | "preview";

const props = withDefaults(
  defineProps<{
    appearance: OverlayAppearance;
    backgroundDataUrl?: string | null;
    levels: number[];
    modelValue?: string;
    phase?: OverlayPhase;
    showClose?: boolean;
    editable?: boolean;
    streamAnimate?: boolean;
    writing?: boolean;
    voiceActive?: boolean;
  }>(),
  {
    modelValue: "",
    phase: "listening",
    showClose: false,
    editable: true,
    streamAnimate: false,
    writing: false,
    voiceActive: false,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
  close: [];
  copy: [];
  write: [];
  commitEdit: [];
  enterEdit: [];
  resize: [height: number];
  edit: [];
  dragStart: [event: MouseEvent];
}>();

const textRef = ref<HTMLTextAreaElement | HTMLDivElement | null>(null);
const measuredTextHeight = ref(0);
const animatedChars = ref<AnimatedChar[]>([]);

const isListening = computed(() => props.phase === "listening");
const isEditing = computed(() => props.phase === "editing");

const useAnimatedStream = computed(
  () =>
    props.streamAnimate &&
    isListening.value &&
    props.modelValue.length > 0,
);

const cssVars = computed(() => overlayCssVars(props.appearance));
const glassStyle = computed(() => overlayGlassStyle(props.appearance));
const bgStyle = computed(() =>
  overlayBgImageStyle(props.appearance, props.backgroundDataUrl),
);

const cardStyle = computed(() => ({
  ...cssVars.value,
  ...glassStyle.value,
  border: "none",
  boxShadow: "none",
  height: `${totalHeight.value}px`,
}));

const showTextArea = computed(
  () => props.modelValue.length > 0 || props.phase === "error",
);

const showLiveDot = computed(() => isListening.value && props.voiceActive);
const showEditDot = computed(() => isEditing.value);
const showSessionDot = computed(() => showLiveDot.value || showEditDot.value);

const showWave = computed(
  () => isListening.value || props.phase === "preview",
);

const showTextActions = computed(
  () =>
    props.phase !== "error" &&
    (isListening.value || isEditing.value || props.modelValue.length > 0),
);

const confirmTitle = computed(() =>
  isEditing.value ? "完成编辑" : "确认写入",
);

const textAreaStyle = computed(() => {
  const h = showTextArea.value
    ? Math.min(
        OVERLAY_MAX_TEXT_HEIGHT,
        Math.max(
          OVERLAY_TEXT_PADDING_Y * 2 + 20,
          measuredTextHeight.value || OVERLAY_TEXT_PADDING_Y * 2 + 20,
        ),
      )
    : 0;
  return {
    maxHeight: `${OVERLAY_MAX_TEXT_HEIGHT}px`,
    height: `${h}px`,
  };
});

const totalHeight = computed(() => {
  if (!showTextArea.value) return OVERLAY_FOOTER_HEIGHT;
  const textBlock = Math.min(
    OVERLAY_MAX_TEXT_HEIGHT,
    Math.max(
      OVERLAY_TEXT_PADDING_Y * 2 + 20,
      measuredTextHeight.value || OVERLAY_TEXT_PADDING_Y * 2 + 20,
    ),
  );
  return clampOverlayHeight(OVERLAY_FOOTER_HEIGHT + textBlock);
});

async function measureAndEmitResize() {
  await nextTick();
  const el = textRef.value;
  if (el && showTextArea.value) {
    el.style.height = "auto";
    measuredTextHeight.value = el.scrollHeight;
    el.style.height = `${Math.min(OVERLAY_MAX_TEXT_HEIGHT, el.scrollHeight)}px`;
  } else {
    measuredTextHeight.value = 0;
  }
  emit("resize", totalHeight.value);
}

function onTextInput(e: Event) {
  let value = (e.target as HTMLTextAreaElement).value;
  if (isEditing.value) {
    value = value.replace(/\r?\n/g, "");
  }
  emit("update:modelValue", value);
  emit("edit");
  void measureAndEmitResize();
}

function onTextKeydown(e: KeyboardEvent) {
  if (isEditing.value && e.key === "Enter") {
    e.preventDefault();
  }
}

function onTextClick() {
  if (isListening.value && props.modelValue.trim()) {
    emit("enterEdit");
  }
}

function onConfirmClick() {
  if (isEditing.value) {
    emit("commitEdit");
  } else {
    emit("write");
  }
}

function onFooterMouseDown(e: MouseEvent) {
  if (e.button !== 0) return;
  const t = e.target as HTMLElement;
  if (t.closest("button,textarea,input,select,a")) return;
  emit("dragStart", e);
}

watch(
  () => props.modelValue,
  (text) => {
    if (useAnimatedStream.value) {
      animatedChars.value = diffAnimatedChars(animatedChars.value, text);
    }
    void measureAndEmitResize();
  },
);

watch(useAnimatedStream, (on) => {
  if (on) {
    animatedChars.value = diffAnimatedChars([], props.modelValue);
  } else {
    animatedChars.value = [];
    resetAnimatedCharKeys();
  }
  void measureAndEmitResize();
});

watch(
  () => props.phase,
  () => {
    if (!useAnimatedStream.value) {
      animatedChars.value = [];
      resetAnimatedCharKeys();
    }
    void measureAndEmitResize();
  },
);

onMounted(() => {
  void measureAndEmitResize();
});

defineExpose({ remeasure: measureAndEmitResize });
</script>

<template>
<div
    class="overlay-bar"
    :style="cardStyle"
  >
    <div
      v-if="bgStyle"
      class="overlay-bar__bg"
      :style="bgStyle"
    />
    <div
      class="overlay-bar__glass"
      :style="glassStyle"
    />
    <div
      v-if="showTextArea && useAnimatedStream"
      ref="textRef"
      class="overlay-bar__text overlay-bar__text--stream overlay-bar__text--clickable"
      :style="textAreaStyle"
      title="点击编辑文字"
      aria-live="polite"
      @click="onTextClick"
    >
      <template
        v-for="item in animatedChars"
        :key="item.key"
      >
        <br v-if="item.char === '\n'" />
        <span
          v-else
          class="overlay-bar__char"
          :class="{ 'overlay-bar__char--enter': item.enter }"
        >{{ item.char }}</span>
      </template>
    </div>
    <textarea
      v-else-if="showTextArea"
      ref="textRef"
      class="overlay-bar__text"
      :class="{
        'overlay-bar__text--error': phase === 'error',
        'overlay-bar__text--clickable': isListening && modelValue.trim(),
      }"
      :value="modelValue"
      :readonly="phase === 'error' || (isListening && !isEditing)"
      :style="textAreaStyle"
      :title="isListening && modelValue.trim() ? '点击编辑文字' : undefined"
      placeholder=""
      spellcheck="false"
      @click="onTextClick"
      @keydown="onTextKeydown"
      @input="onTextInput"
    />
    <div
      class="overlay-bar__footer"
      @mousedown="onFooterMouseDown"
    >
      <div class="overlay-bar__footer-left">
        <div
          class="overlay-bar__brand-wrap"
          title="SR"
        >
          <span
            v-if="showSessionDot"
            class="overlay-bar__rec-dot"
            :class="{
              'overlay-bar__rec-dot--live': showLiveDot,
              'overlay-bar__rec-dot--edit': showEditDot,
            }"
            aria-hidden="true"
          />
          <span class="overlay-bar__brand">SR</span>
        </div>
      </div>
      <div class="overlay-bar__footer-mid">
        <div
          v-if="showWave"
          class="overlay-bar__wave"
          aria-hidden="true"
        >
          <span
            v-for="(h, i) in levels"
            :key="i"
            :style="{ height: `${h}px` }"
          />
        </div>
      </div>
      <div class="overlay-bar__footer-right">
        <div
          v-if="showTextActions"
          class="overlay-bar__actions"
        >
          <button
            type="button"
            class="overlay-bar__icon-btn overlay-bar__icon-btn--ghost"
            title="复制"
            aria-label="复制"
            @click.stop="emit('copy')"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
            >
              <rect
                x="9"
                y="9"
                width="11"
                height="11"
                rx="2"
                stroke="currentColor"
                stroke-width="2"
              />
              <path
                d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1"
                stroke="currentColor"
                stroke-width="2"
              />
            </svg>
          </button>
          <button
            type="button"
            class="overlay-bar__icon-btn overlay-bar__icon-btn--ghost"
            :title="confirmTitle"
            :aria-label="confirmTitle"
            :disabled="writing || !modelValue.trim()"
            @click.stop="onConfirmClick"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                d="M5 12l5 5L19 7"
                stroke="currentColor"
                stroke-width="2.25"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>
        <button
          v-if="showClose"
          type="button"
          class="overlay-bar__icon-btn overlay-bar__icon-btn--ghost"
          title="关闭"
          aria-label="关闭"
          @click.stop="emit('close')"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
          >
            <path
              d="M7 7l10 10M17 7L7 17"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style>
@import "../assets/overlay-bar.css";
</style>
