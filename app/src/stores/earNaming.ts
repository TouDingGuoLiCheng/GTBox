import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import type {
  AnswerEvent,
  DictationNoteLog,
  EarNamingPhase,
  FretboardSubview,
  ReviewRedoResult,
  TrainingMode,
  TrainingPrompt,
} from "../types/earNaming";
import { DEFAULT_DICTATION_NOTE_COUNT, DEFAULT_QUESTIONS_PER_ROUND } from "../types/earNaming";
import { getFretMidi, toSolfegeName, type FretPoint } from "../utils/earNaming/fretboard";
import {
  buildPromptSummary,
  generateQuestion,
  getCorrectPoints,
  isPitchClassMatch,
} from "../utils/earNaming/questionGenerator";
import { appendAnswerLog, computeSessionStats, degreeLabelForMidi } from "../utils/earNaming/stats";
import { playEarNamingMidi } from "../utils/earNaming/sampler";

export type TrainingPhase =
  | "idle"
  | "prompt"
  | "feedback"
  | "round-complete"
  | "review-prompt"
  | "review-feedback";

const EXPLORE_SETTINGS_KEY = "earNaming.explore.settings";
const FRETBOARD_SETTINGS_KEY = "earNaming.fretboard.settings";

interface ExploreSettings {
  doString: number;
  doFret: number;
  showEnharmonic: boolean;
  enabledStrings: number[];
  maxFret: number;
}

interface FretboardSettings {
  doString: number;
  doFret: number;
  enabledStrings: number[];
  maxFret: number;
  showEnharmonic: boolean;
  questionsPerRound: number;
  dictationNoteCount: number;
  trainingMode: TrainingMode;
}

const DEFAULT_EXPLORE: ExploreSettings = {
  doString: 6,
  doFret: 8,
  showEnharmonic: true,
  enabledStrings: [1, 2, 3, 4, 5, 6],
  maxFret: 22,
};

const DEFAULT_FRETBOARD: FretboardSettings = {
  doString: 6,
  doFret: 8,
  enabledStrings: [1, 2, 3, 4, 5, 6],
  maxFret: 22,
  showEnharmonic: true,
  questionsPerRound: DEFAULT_QUESTIONS_PER_ROUND,
  dictationNoteCount: DEFAULT_DICTATION_NOTE_COUNT,
  trainingMode: "degree-locate",
};

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...fallback };
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    return { ...fallback };
  }
}

function saveJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

export const useEarNamingStore = defineStore("earNaming", () => {
  const phase = ref<EarNamingPhase>("menu");
  const fretboardSubview = ref<FretboardSubview>("mode-menu");

  const trainingMode = ref<TrainingMode>(DEFAULT_FRETBOARD.trainingMode);
  const trainingPhase = ref<TrainingPhase>("idle");
  const questionsPerRound = ref(DEFAULT_FRETBOARD.questionsPerRound);
  const dictationNoteCount = ref(DEFAULT_FRETBOARD.dictationNoteCount);

  const doString = ref(DEFAULT_FRETBOARD.doString);
  const doFret = ref(DEFAULT_FRETBOARD.doFret);
  const enabledStrings = ref<number[]>([...DEFAULT_FRETBOARD.enabledStrings]);
  const maxFret = ref(DEFAULT_FRETBOARD.maxFret);
  const showEnharmonic = ref(DEFAULT_FRETBOARD.showEnharmonic);

  const exploreDoString = ref(DEFAULT_EXPLORE.doString);
  const exploreDoFret = ref(DEFAULT_EXPLORE.doFret);
  const exploreShowEnharmonic = ref(DEFAULT_EXPLORE.showEnharmonic);
  const exploreEnabledStrings = ref<number[]>([...DEFAULT_EXPLORE.enabledStrings]);
  const exploreMaxFret = ref(DEFAULT_EXPLORE.maxFret);

  const currentPrompt = ref<TrainingPrompt | null>(null);
  const roundEvents = ref<AnswerEvent[]>([]);
  const recentAnchors = ref<FretPoint[]>([]);
  const lastAnswer = ref<AnswerEvent | null>(null);
  const correctPoints = ref<FretPoint[]>([]);
  const questionStartedAt = ref(0);
  const isPlayingCue = ref(false);

  const dictationIndex = ref(0);
  const dictationLog = ref<DictationNoteLog[]>([]);
  const dictationAttempts = ref(0);
  const dictationWrongHint = ref("");

  const reviewRedoResults = ref<ReviewRedoResult[]>([]);
  const reviewingWrongIndex = ref<number | null>(null);

  const wrongAnswers = computed(() => roundEvents.value.filter((e) => !e.correct));

  const doMidi = computed(() => getFretMidi(doString.value, doFret.value));
  const exploreDoMidi = computed(() => getFretMidi(exploreDoString.value, exploreDoFret.value));
  const isDictationMode = computed(() => trainingMode.value === "naming-dictation");

  const dictationNotes = computed(() => currentPrompt.value?.dictationNotes ?? []);
  const dictationCurrentNote = computed(() => dictationNotes.value[dictationIndex.value] ?? null);

  const roundStats = computed(() => computeSessionStats(roundEvents.value));
  const questionProgress = computed(() => {
    if (!currentPrompt.value) return { current: 0, total: questionsPerRound.value };
    return {
      current: currentPrompt.value.questionIndex,
      total: currentPrompt.value.totalQuestions,
    };
  });

  function applyExploreSettings(settings: ExploreSettings) {
    exploreDoString.value = settings.doString;
    exploreDoFret.value = settings.doFret;
    exploreShowEnharmonic.value = settings.showEnharmonic;
    exploreEnabledStrings.value = [...settings.enabledStrings];
    exploreMaxFret.value = settings.maxFret;
  }

  function snapshotExploreSettings(): ExploreSettings {
    return {
      doString: exploreDoString.value,
      doFret: exploreDoFret.value,
      showEnharmonic: exploreShowEnharmonic.value,
      enabledStrings: [...exploreEnabledStrings.value],
      maxFret: exploreMaxFret.value,
    };
  }

  function applyFretboardSettings(settings: FretboardSettings) {
    doString.value = settings.doString;
    doFret.value = settings.doFret;
    enabledStrings.value = [...settings.enabledStrings];
    maxFret.value = settings.maxFret;
    showEnharmonic.value = settings.showEnharmonic;
    questionsPerRound.value = settings.questionsPerRound;
    dictationNoteCount.value = settings.dictationNoteCount;
    trainingMode.value = settings.trainingMode;
  }

  function snapshotFretboardSettings(): FretboardSettings {
    return {
      doString: doString.value,
      doFret: doFret.value,
      enabledStrings: [...enabledStrings.value],
      maxFret: maxFret.value,
      showEnharmonic: showEnharmonic.value,
      questionsPerRound: questionsPerRound.value,
      dictationNoteCount: dictationNoteCount.value,
      trainingMode: trainingMode.value,
    };
  }

  function loadExploreSettings() {
    applyExploreSettings(loadJson(EXPLORE_SETTINGS_KEY, DEFAULT_EXPLORE));
  }

  function saveExploreSettings() {
    saveJson(EXPLORE_SETTINGS_KEY, snapshotExploreSettings());
  }

  function loadFretboardSettings() {
    applyFretboardSettings(loadJson(FRETBOARD_SETTINGS_KEY, DEFAULT_FRETBOARD));
  }

  function saveFretboardSettings() {
    saveJson(FRETBOARD_SETTINGS_KEY, snapshotFretboardSettings());
  }

  watch(
    [exploreDoString, exploreDoFret, exploreShowEnharmonic, exploreEnabledStrings, exploreMaxFret],
    () => {
      if (phase.value === "explore" || phase.value === "settings") {
        saveExploreSettings();
      }
    },
    { deep: true },
  );

  watch(
    [
      doString,
      doFret,
      enabledStrings,
      maxFret,
      showEnharmonic,
      questionsPerRound,
      dictationNoteCount,
      trainingMode,
    ],
    () => {
      if (phase.value === "fretboard-memory" || phase.value === "settings") {
        saveFretboardSettings();
      }
    },
    { deep: true },
  );

  function enterPhase(next: EarNamingPhase) {
    if (phase.value === "explore") {
      saveExploreSettings();
    }
    if (phase.value === "fretboard-memory") {
      saveFretboardSettings();
    }
    if (phase.value === "settings") {
      saveExploreSettings();
      saveFretboardSettings();
    }

    phase.value = next;

    if (next === "explore") {
      loadExploreSettings();
    }
    if (next === "fretboard-memory") {
      loadFretboardSettings();
      fretboardSubview.value = "mode-menu";
      resetTraining();
    }
    if (next === "settings") {
      loadExploreSettings();
      loadFretboardSettings();
    }
  }

  function backToMenu() {
    if (phase.value === "explore" || phase.value === "settings") {
      saveExploreSettings();
    }
    if (phase.value === "fretboard-memory" || phase.value === "settings") {
      saveFretboardSettings();
    }
    resetTraining();
    fretboardSubview.value = "mode-menu";
    phase.value = "menu";
  }

  function backToFretboardMenu() {
    saveFretboardSettings();
    resetTraining();
    fretboardSubview.value = "mode-menu";
  }

  function startFretboardMode(mode: TrainingMode) {
    trainingMode.value = mode;
    saveFretboardSettings();
    resetTraining();
    fretboardSubview.value = "training";
  }

  function toggleString(stringNo: number, checked: boolean) {
    const next = new Set(enabledStrings.value);
    if (checked) {
      next.add(stringNo);
    } else if (next.size > 1) {
      next.delete(stringNo);
    }
    enabledStrings.value = [1, 2, 3, 4, 5, 6].filter((no) => next.has(no));
  }

  function resetDictationState() {
    dictationIndex.value = 0;
    dictationLog.value = [];
    dictationAttempts.value = 0;
    dictationWrongHint.value = "";
  }

  function resetTraining() {
    trainingPhase.value = "idle";
    currentPrompt.value = null;
    roundEvents.value = [];
    recentAnchors.value = [];
    lastAnswer.value = null;
    correctPoints.value = [];
    questionStartedAt.value = 0;
    reviewRedoResults.value = [];
    reviewingWrongIndex.value = null;
    resetDictationState();
  }

  async function replayPromptCues(prompt: TrainingPrompt) {
    isPlayingCue.value = true;
    try {
      if (prompt.mode === "degree-locate") {
        await playEarNamingMidi(prompt.doMidi);
        await delay(350);
      } else if (prompt.mode === "interval-locate" && prompt.referencePoint) {
        await playEarNamingMidi(prompt.referencePoint.midi);
        await delay(450);
      } else if (prompt.mode === "naming-dictation" && prompt.dictationNotes?.length) {
        for (const note of prompt.dictationNotes) {
          await playEarNamingMidi(note.midi);
          await delay(520);
        }
      }
    } finally {
      isPlayingCue.value = false;
    }
  }

  async function playPromptCues(prompt: TrainingPrompt) {
    await replayPromptCues(prompt);
  }

  async function playDictationCurrentNote() {
    const note = dictationCurrentNote.value;
    if (!note) return;
    isPlayingCue.value = true;
    try {
      await playEarNamingMidi(note.midi);
    } finally {
      isPlayingCue.value = false;
    }
  }

  function delay(ms: number) {
    return new Promise<void>((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function nextQuestion() {
    const index = roundEvents.value.length + 1;
    if (index > questionsPerRound.value) {
      trainingPhase.value = "round-complete";
      appendAnswerLog(roundEvents.value);
      return;
    }

    const prompt = generateQuestion({
      mode: trainingMode.value,
      doMidi: doMidi.value,
      maxFret: maxFret.value,
      enabledStrings: enabledStrings.value,
      questionIndex: index,
      totalQuestions: questionsPerRound.value,
      recentAnchors: recentAnchors.value,
      dictationNoteCount: dictationNoteCount.value,
    });

    currentPrompt.value = prompt;
    correctPoints.value = getCorrectPoints(prompt, maxFret.value, enabledStrings.value);
    lastAnswer.value = null;
    resetDictationState();
    trainingPhase.value = "prompt";
    questionStartedAt.value = performance.now();
    void playPromptCues(prompt);
  }

  function startRound() {
    roundEvents.value = [];
    recentAnchors.value = [];
    lastAnswer.value = null;
    nextQuestion();
  }

  function finishDictationQuestion() {
    if (!currentPrompt.value) return;

    const allCorrect = dictationLog.value.every((n) => n.correct);
    const totalMs = dictationLog.value.reduce((sum, n) => sum + n.responseMs, 0);
    const lastNote = dictationLog.value[dictationLog.value.length - 1];

    const event: AnswerEvent = {
      mode: "naming-dictation",
      questionIndex: currentPrompt.value.questionIndex,
      targetMidi: dictationNotes.value[0]?.midi ?? doMidi.value,
      targetDegreeLabel: lastNote?.degreeLabel,
      picked: lastNote?.picked ?? dictationNotes.value[0]!,
      correct: allCorrect,
      responseMs: totalMs,
      timestamp: Date.now(),
      promptSummary: buildPromptSummary(currentPrompt.value),
      dictationDetails: [...dictationLog.value],
      promptSnapshot: { ...currentPrompt.value },
    };

    lastAnswer.value = event;
    roundEvents.value.push(event);
    if (currentPrompt.value.anchorPoint) {
      recentAnchors.value.push(currentPrompt.value.anchorPoint);
    }
    trainingPhase.value = "feedback";
  }

  async function submitDictationAnswer(picked: FretPoint) {
    const target = dictationCurrentNote.value;
    if (!target || !currentPrompt.value) return;

    await playEarNamingMidi(picked.midi);
    dictationAttempts.value += 1;

    const correct = isPitchClassMatch(picked.midi, target.midi);
    const responseMs = Math.round(performance.now() - questionStartedAt.value);

    if (!correct) {
      dictationWrongHint.value =
        dictationAttempts.value >= 3
          ? `错误。提示：${toSolfegeName(target.midi, doMidi.value)} · ${target.stringNo}弦${target.fret}品`
          : "错误，请重新命名当前音（未正确命名不得下一音）";
      return;
    }

    dictationWrongHint.value = "";
    dictationLog.value.push({
      noteIndex: dictationIndex.value + 1,
      targetMidi: target.midi,
      picked,
      solfege: toSolfegeName(target.midi, doMidi.value),
      degreeLabel: degreeLabelForMidi(target.midi, doMidi.value),
      correct: true,
      responseMs,
      attempts: dictationAttempts.value,
    });

    dictationAttempts.value = 0;
    dictationIndex.value += 1;

    if (dictationIndex.value >= dictationNotes.value.length) {
      finishDictationQuestion();
      return;
    }

    questionStartedAt.value = performance.now();
    await delay(280);
    await playDictationCurrentNote();
  }

  async function submitAnswer(picked: FretPoint) {
    const phase = trainingPhase.value;
    if ((phase !== "prompt" && phase !== "review-prompt") || !currentPrompt.value) return;

    if (isDictationMode.value) {
      await submitDictationAnswer(picked);
      return;
    }

    await playEarNamingMidi(picked.midi);

    const correct = isPitchClassMatch(picked.midi, currentPrompt.value.targetMidi);
    const event: AnswerEvent = {
      mode: currentPrompt.value.mode,
      questionIndex: currentPrompt.value.questionIndex,
      targetMidi: currentPrompt.value.targetMidi,
      targetDegreeLabel: degreeLabelForMidi(currentPrompt.value.targetMidi, currentPrompt.value.doMidi),
      picked,
      correct,
      responseMs: Math.round(performance.now() - questionStartedAt.value),
      timestamp: Date.now(),
      promptSummary: buildPromptSummary(currentPrompt.value),
      promptSnapshot: { ...currentPrompt.value },
    };

    lastAnswer.value = event;
    if (phase === "review-prompt") {
      reviewRedoResults.value.push({
        questionIndex: event.questionIndex,
        correct: event.correct,
        summary: event.promptSummary,
      });
      trainingPhase.value = "review-feedback";
      return;
    }

    roundEvents.value.push(event);
    if (currentPrompt.value.anchorPoint) {
      recentAnchors.value.push(currentPrompt.value.anchorPoint);
    }
    trainingPhase.value = "feedback";
  }

  function continueAfterFeedback() {
    if (trainingPhase.value === "review-feedback") {
      finishWrongRedo();
      return;
    }
    if (trainingPhase.value !== "feedback") return;
    nextQuestion();
  }

  async function replayWrongAnswer(event: AnswerEvent) {
    const prompt = event.promptSnapshot;
    if (!prompt) return;
    await replayPromptCues(prompt);
  }

  function startWrongRedo(event: AnswerEvent) {
    const prompt = event.promptSnapshot;
    if (!prompt || event.mode === "naming-dictation") return;

    currentPrompt.value = { ...prompt };
    correctPoints.value = getCorrectPoints(prompt, maxFret.value, enabledStrings.value);
    lastAnswer.value = null;
    reviewingWrongIndex.value = event.questionIndex;
    trainingPhase.value = "review-prompt";
    questionStartedAt.value = performance.now();
    resetDictationState();
    void replayPromptCues(prompt);
  }

  function finishWrongRedo() {
    trainingPhase.value = "round-complete";
    currentPrompt.value = null;
    lastAnswer.value = null;
    correctPoints.value = [];
    reviewingWrongIndex.value = null;
  }

  function isReviewRedoCorrect(questionIndex: number) {
    return reviewRedoResults.value.some((r) => r.questionIndex === questionIndex && r.correct);
  }

  return {
    phase,
    fretboardSubview,
    trainingMode,
    trainingPhase,
    questionsPerRound,
    dictationNoteCount,
    doString,
    doFret,
    enabledStrings,
    maxFret,
    showEnharmonic,
    exploreDoString,
    exploreDoFret,
    exploreShowEnharmonic,
    exploreEnabledStrings,
    exploreMaxFret,
    currentPrompt,
    roundEvents,
    lastAnswer,
    correctPoints,
    questionStartedAt,
    isPlayingCue,
    dictationIndex,
    dictationLog,
    dictationWrongHint,
    dictationNotes,
    dictationCurrentNote,
    isDictationMode,
    doMidi,
    exploreDoMidi,
    roundStats,
    questionProgress,
    wrongAnswers,
    reviewRedoResults,
    reviewingWrongIndex,
    enterPhase,
    backToMenu,
    backToFretboardMenu,
    startFretboardMode,
    toggleString,
    resetTraining,
    startRound,
    submitAnswer,
    continueAfterFeedback,
    playDictationCurrentNote,
    replayWrongAnswer,
    startWrongRedo,
    finishWrongRedo,
    isReviewRedoCorrect,
    loadExploreSettings,
    loadFretboardSettings,
    saveExploreSettings,
    saveFretboardSettings,
  };
});
