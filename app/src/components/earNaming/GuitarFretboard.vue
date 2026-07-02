<script setup lang="ts">

import { computed } from "vue";

import "./guitar-fretboard.css";

import {

  buildFretboard,

  deriveMajorScalePath,

  findSamePitchClass,

  getFretPoint,

  toDegreeName,

  toScaleDegreeDisplay,

  toSolfegeName,

  type FretPoint,

} from "../../utils/earNaming/fretboard";



const props = withDefaults(

  defineProps<{

    maxFret?: number;

    enabledStrings?: number[];

    doMidi: number;

    selectedMidi: number | null;

    showEnharmonic: boolean;

    /** 自由探索：显示级数标签；记忆训练：空白指板 + 品位点 */

    variant?: "explore" | "training";

    /** 训练反馈：用户点选的 midi */

    pickedMidi?: number | null;

    /** 训练反馈：正确答案 midi（高亮所有同音异位） */

    targetMidi?: number | null;

    /** 是否处于已判题反馈态 */
    showAnswerFeedback?: boolean;
    /** 格内标签：级数（默认）或音名 */
    labelMode?: "degree" | "noteName";
    /** 精确高亮某一格（用于 Do 参照选择） */
    anchorString?: number | null;
    anchorFret?: number | null;
    selectionExact?: boolean;
    doAnchorHighlight?: boolean;
    /** 仅 Do 参照选择等场景：只标一条大调推导路线，默认全指板显示级数 */
    useScalePathLabels?: boolean;
  }>(),
  {
    maxFret: 22,
    enabledStrings: () => [1, 2, 3, 4, 5, 6],
    variant: "explore",
    pickedMidi: null,
    targetMidi: null,
    showAnswerFeedback: false,
    labelMode: "degree",
    anchorString: null,
    anchorFret: null,
    selectionExact: false,
    doAnchorHighlight: false,
    useScalePathLabels: false,
  },
);



const emit = defineEmits<{

  pick: [point: FretPoint];

}>();



const isTraining = computed(() => props.variant === "training");

const showLabels = computed(() => !isTraining.value);



const displayStrings = computed(() => [...props.enabledStrings].sort((a, b) => a - b));



const allPoints = computed(() => buildFretboard(props.maxFret, props.enabledStrings));

const scalePath = computed(() => {
  if (!props.useScalePathLabels) return null;
  if (isTraining.value) return null;
  if (props.anchorString == null || props.anchorFret == null) return null;
  return deriveMajorScalePath(
    props.anchorString,
    props.anchorFret,
    props.maxFret,
    props.enabledStrings,
  );
});



const pointsByString = computed(() =>

  displayStrings.value.map((stringNo) => ({

    stringNo,

    open: getFretPoint(stringNo, 0),

    fretted: Array.from({ length: props.maxFret }, (_, i) => getFretPoint(stringNo, i + 1)),

  })),

);



const enharmonicSet = computed(() => {

  if (isTraining.value || !props.showEnharmonic) return new Set<string>();

  const midi = props.showAnswerFeedback && props.targetMidi !== null

    ? props.targetMidi

    : props.selectedMidi;

  if (midi === null) return new Set<string>();

  return new Set(

    findSamePitchClass(allPoints.value, midi).map((point) => `${point.stringNo}-${point.fret}`),

  );

});



const targetPitchClass = computed(() =>

  props.targetMidi !== null ? ((props.targetMidi % 12) + 12) % 12 : null,

);



const pickedPitchClass = computed(() =>

  props.pickedMidi !== null ? ((props.pickedMidi % 12) + 12) % 12 : null,

);



const fretMarkerSet = new Set([3, 5, 7, 9, 12, 15, 17, 19, 21]);



const gridStyle = computed(() => ({

  "--max-fret": String(props.maxFret),

  gridTemplateColumns: `36px 8px repeat(${props.maxFret}, minmax(0, 1fr))`,

  gridTemplateRows: `26px repeat(${displayStrings.value.length}, minmax(0, 1fr))`,

}));



function cellKey(point: FretPoint) {

  return `${point.stringNo}-${point.fret}`;

}



function isSelected(point: FretPoint) {

  if (props.selectionExact && props.anchorString != null && props.anchorFret != null) {

    return point.stringNo === props.anchorString && point.fret === props.anchorFret;

  }

  if (props.showAnswerFeedback && props.pickedMidi !== null) {

    return point.midi === props.pickedMidi;

  }

  return props.selectedMidi !== null && point.midi === props.selectedMidi;

}



function isCorrectTarget(point: FretPoint) {

  if (!props.showAnswerFeedback || targetPitchClass.value === null) return false;

  return ((point.midi % 12) + 12) % 12 === targetPitchClass.value;

}



function isWrongPick(point: FretPoint) {

  if (!props.showAnswerFeedback || pickedPitchClass.value === null || targetPitchClass.value === null) {

    return false;

  }

  return (

    point.midi === props.pickedMidi &&

    pickedPitchClass.value !== targetPitchClass.value

  );

}



function isEnharmonic(point: FretPoint) {

  if (isSelected(point) || isCorrectTarget(point) || isWrongPick(point)) return false;

  return enharmonicSet.value.has(cellKey(point));

}



function cellClass(point: FretPoint) {

  return {

    "fret-cell--selected": isSelected(point) && (!props.showAnswerFeedback || isCorrectTarget(point)),

    "fret-cell--correct": props.showAnswerFeedback && isCorrectTarget(point) && !isSelected(point),

    "fret-cell--wrong": isWrongPick(point),

    "fret-cell--enharmonic": isEnharmonic(point),

    "fret-cell--plain": isTraining.value,

    "fret-cell--do-anchor": props.doAnchorHighlight && isSelected(point),

  };

}



function degreeLabel(point: FretPoint) {

  const pathEntry = scalePath.value?.get(cellKey(point));

  if (pathEntry) {

    return {

      text: String(pathEntry.degree),

      dot: "none" as const,

      diatonic: true,

    };

  }

  if (scalePath.value) {

    const fallback = toScaleDegreeDisplay(point.midi, props.doMidi);

    if (fallback.diatonic) {

      return { text: "", dot: "none" as const, diatonic: true };

    }

    return fallback;

  }

  return toScaleDegreeDisplay(point.midi, props.doMidi);

}



function cellDisplayText(point: FretPoint) {

  if (props.labelMode === "noteName") {

    return point.noteName;

  }

  return degreeLabel(point).text;

}



function cellDisplayChromatic(point: FretPoint) {

  return props.labelMode !== "noteName" && !degreeLabel(point).diatonic;

}



function onPick(point: FretPoint) {

  emit("pick", point);

}



function buildCellTitle(point: FretPoint) {

  if (isTraining.value) return undefined;

  const pathEntry = scalePath.value?.get(cellKey(point));

  const label = degreeLabel(point);

  const solfege = pathEntry?.solfege ?? toSolfegeName(point.midi, props.doMidi);

  const degree = pathEntry

    ? `${pathEntry.degree}级`

    : `${toDegreeName(point.midi, props.doMidi)}级`;

  return `${point.noteName} | ${solfege} | ${degree} | 级数 ${label.text || "—"}`;

}

</script>



<template>

  <div class="fretboard-shell select-none" :class="{ 'fretboard-shell--training': isTraining }">

    <p v-if="showLabels" class="mb-2 shrink-0 text-xs text-zinc-500">

      1弦在上 · 0–{{ maxFret }} 品 · 指板自适应平铺

    </p>

    <p v-else class="mb-2 shrink-0 text-xs text-zinc-500">1弦在上 · 听题后在指板上作答</p>



    <div class="fretboard-scroll">

      <div class="fretboard-board" :style="gridStyle">

        <span class="board-corner" />

        <span class="board-nut-spacer" />

        <span

          v-for="fret in maxFret"

          :key="`head-${fret}`"

          class="fret-head"

          :class="{ 'fret-head--marker': showLabels && fretMarkerSet.has(fret) }"

        >

          <template v-if="showLabels">{{ fret }}</template>

        </span>



        <template v-for="row in pointsByString" :key="`row-${row.stringNo}`">

          <button

            type="button"

            class="fret-cell fret-cell--open"

            :class="cellClass(row.open)"

            :title="buildCellTitle(row.open)"

            @click="onPick(row.open)"

          >

            <span

              v-if="showLabels"

              class="degree-label"

              :class="{ 'degree-label--chromatic': cellDisplayChromatic(row.open), 'degree-label--note': labelMode === 'noteName' }"

            >

              <template v-if="labelMode === 'noteName'">

                <span class="degree-text">{{ cellDisplayText(row.open) }}</span>

              </template>

              <template v-else>

                <span v-if="degreeLabel(row.open).dot === 'above'" class="degree-dot degree-dot--above">·</span>

                <span class="degree-text">{{ cellDisplayText(row.open) }}</span>

                <span v-if="degreeLabel(row.open).dot === 'below'" class="degree-dot degree-dot--below">·</span>

              </template>

            </span>

          </button>

          <span class="board-nut" aria-hidden="true" />

          <button

            v-for="point in row.fretted"

            :key="cellKey(point)"

            type="button"

            class="fret-cell"

            :class="cellClass(point)"

            :title="buildCellTitle(point)"

            @click="onPick(point)"

          >

            <span

              v-if="showLabels"

              class="degree-label"

              :class="{ 'degree-label--chromatic': cellDisplayChromatic(point), 'degree-label--note': labelMode === 'noteName' }"

            >

              <template v-if="labelMode === 'noteName'">

                <span class="degree-text">{{ cellDisplayText(point) }}</span>

              </template>

              <template v-else>

                <span v-if="degreeLabel(point).dot === 'above'" class="degree-dot degree-dot--above">·</span>

                <span class="degree-text">{{ cellDisplayText(point) }}</span>

                <span v-if="degreeLabel(point).dot === 'below'" class="degree-dot degree-dot--below">·</span>

              </template>

            </span>

          </button>

        </template>



        <div v-if="isTraining" class="fret-inlay-layer" aria-hidden="true">

          <div

            v-for="fret in maxFret"

            :key="`inlay-${fret}`"

            class="fret-inlay-col"

            :class="{

              'fret-inlay-col--marker': fretMarkerSet.has(fret),

              'fret-inlay-col--double': fret === 12,

            }"

          >

            <template v-if="fretMarkerSet.has(fret) && fret !== 12">

              <span class="fret-inlay-dot fret-inlay-dot--single" />

            </template>

            <template v-else-if="fret === 12">

              <span class="fret-inlay-dot fret-inlay-dot--octave" />

              <span class="fret-inlay-dot fret-inlay-dot--octave" />

            </template>

          </div>

        </div>

      </div>

    </div>

  </div>

</template>

