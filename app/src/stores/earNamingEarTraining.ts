import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import type {
  EarTrainingAnswerEvent,
  EarTrainingDifficulty,
  EarTrainingPhase,
  EarTrainingPrompt,
  ReviewRedoResult,
} from "../types/earNaming";
import { DEFAULT_EAR_TRAINING_QUESTIONS } from "../types/earNaming";
import type { EarTrainingSolfegeName } from "../types/earNaming";
import { DEFAULT_ENABLED_EAR_TRAINING_SOLFEGE } from "../types/earNaming";
import { generateEarTrainingQuestion, computeEarTrainingRoundStats } from "../utils/earNaming/earTrainingGenerator";
import { collectMidiPool } from "../utils/earNaming/earTrainingDifficulty";
import { normalizeEnabledSolfege, preferredSolfegeLabel, toggleEnabledSolfegeList } from "../utils/earNaming/earTrainingSolfege";
import {
  findSamePitchClassPositions,
  getFretMidi,
  getFretPoint,
  pickRandomSamePitchClassPosition,
} from "../utils/earNaming/fretboard";
import { playEarNamingMidi } from "../utils/earNaming/sampler";
import { solfegeAnswersMatch, targetSolfegeForMidi } from "../utils/earNaming/solfegeMatch";

const SETTINGS_KEY = "earNaming.earTraining.settings";

interface EarTrainingSettings {
  doString: number;
  doFret: number;
  useDoReference: boolean;
  difficulty: EarTrainingDifficulty;
  questionsPerRound: number;
  enabledSolfege: EarTrainingSolfegeName[];
}

const DEFAULT_SETTINGS: EarTrainingSettings = {
  doString: 6,
  doFret: 8,
  useDoReference: true,
  difficulty: "beginner",
  questionsPerRound: DEFAULT_EAR_TRAINING_QUESTIONS,
  enabledSolfege: [...DEFAULT_ENABLED_EAR_TRAINING_SOLFEGE],
};

function loadSettings(): EarTrainingSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<EarTrainingSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      enabledSolfege: normalizeEnabledSolfege(parsed.enabledSolfege),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings: EarTrainingSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export const useEarNamingEarTrainingStore = defineStore("earNamingEarTraining", () => {
  const saved = loadSettings();

  const doString = ref(saved.doString);
  const doFret = ref(saved.doFret);
  const useDoReference = ref(saved.useDoReference);
  const difficulty = ref<EarTrainingDifficulty>(saved.difficulty);
  const questionsPerRound = ref(saved.questionsPerRound);
  const enabledSolfege = ref<EarTrainingSolfegeName[]>([...saved.enabledSolfege]);

  const trainingPhase = ref<EarTrainingPhase>("idle");
  const currentPrompt = ref<EarTrainingPrompt | null>(null);
  const roundEvents = ref<EarTrainingAnswerEvent[]>([]);
  const lastAnswer = ref<EarTrainingAnswerEvent | null>(null);
  const recentSolfege = ref<string[]>([]);
  const questionStartedAt = ref(0);
  const isPlayingCue = ref(false);
  const revealedSolfege = ref<string | null>(null);

  const reviewRedoResults = ref<ReviewRedoResult[]>([]);
  const reviewingWrongIndex = ref<number | null>(null);

  const wrongAnswers = computed(() => roundEvents.value.filter((e) => !e.correct));

  const doMidi = computed(() => getFretMidi(doString.value, doFret.value));
  const doReferencePoint = computed(() => getFretPoint(doString.value, doFret.value));
  const doReferenceSummary = computed(
    () =>
      `${doReferencePoint.value.stringNo}弦 ${doReferencePoint.value.fret}品 · ${doReferencePoint.value.noteName}`,
  );
  const canRandomizeDoReference = computed(
    () =>
      findSamePitchClassPositions(doMidi.value, {
        exclude: { stringNo: doString.value, fret: doFret.value },
      }).length > 0,
  );
  const questionPool = computed(() =>
    collectMidiPool(doMidi.value, difficulty.value, enabledSolfege.value, doString.value, doFret.value),
  );
  const canStartRound = computed(() => questionPool.value.length > 0);
  const roundStats = computed(() => computeEarTrainingRoundStats(roundEvents.value));
  const questionProgress = computed(() => {
    if (!currentPrompt.value) {
      return { current: 0, total: questionsPerRound.value };
    }
    return {
      current: currentPrompt.value.questionIndex,
      total: currentPrompt.value.totalQuestions,
    };
  });

  function snapshotSettings(): EarTrainingSettings {
    return {
      doString: doString.value,
      doFret: doFret.value,
      useDoReference: useDoReference.value,
      difficulty: difficulty.value,
      questionsPerRound: questionsPerRound.value,
      enabledSolfege: [...enabledSolfege.value],
    };
  }

  function reloadSettings() {
    const settings = loadSettings();
    doString.value = settings.doString;
    doFret.value = settings.doFret;
    useDoReference.value = settings.useDoReference;
    difficulty.value = settings.difficulty;
    questionsPerRound.value = settings.questionsPerRound;
    enabledSolfege.value = [...settings.enabledSolfege];
  }

  function toggleEnabledSolfege(name: EarTrainingSolfegeName, checked: boolean) {
    enabledSolfege.value = toggleEnabledSolfegeList(enabledSolfege.value, name, checked);
  }

  function setDoReference(stringNo: number, fret: number) {
    doString.value = stringNo;
    doFret.value = Math.max(0, Math.min(22, Math.round(fret)));
  }

  function randomizeDoReferencePosition() {
    const picked = pickRandomSamePitchClassPosition(doString.value, doFret.value);
    if (!picked) return;
    setDoReference(picked.stringNo, picked.fret);
  }

  watch([doString, doFret, useDoReference, difficulty, questionsPerRound, enabledSolfege], () => {
    saveSettings(snapshotSettings());
  }, { deep: true });

  function resetTraining() {
    trainingPhase.value = "idle";
    currentPrompt.value = null;
    roundEvents.value = [];
    lastAnswer.value = null;
    recentSolfege.value = [];
    questionStartedAt.value = 0;
    isPlayingCue.value = false;
    revealedSolfege.value = null;
    reviewRedoResults.value = [];
    reviewingWrongIndex.value = null;
  }

  function promptFromWrongEvent(event: EarTrainingAnswerEvent): EarTrainingPrompt {
    return {
      questionIndex: event.questionIndex,
      totalQuestions: questionsPerRound.value,
      targetMidi: event.targetMidi,
      targetSolfege: event.targetSolfege,
      targetNoteName: event.targetNoteName,
      useDoReference: useDoReference.value,
      doMidi: doMidi.value,
      difficulty: difficulty.value,
    };
  }

  async function playQuestionCues(prompt: EarTrainingPrompt) {
    isPlayingCue.value = true;
    try {
      if (prompt.useDoReference) {
        await playEarNamingMidi(prompt.doMidi);
        await delay(400);
      }
      await playEarNamingMidi(prompt.targetMidi);
    } finally {
      isPlayingCue.value = false;
    }
  }

  async function replayDo() {
    if (!currentPrompt.value) return;
    isPlayingCue.value = true;
    try {
      await playEarNamingMidi(currentPrompt.value.doMidi);
    } finally {
      isPlayingCue.value = false;
    }
  }

  async function replayTarget() {
    if (!currentPrompt.value) return;
    isPlayingCue.value = true;
    try {
      await playEarNamingMidi(currentPrompt.value.targetMidi);
    } finally {
      isPlayingCue.value = false;
    }
  }

  function revealAnswer() {
    if (!currentPrompt.value) return;
    revealedSolfege.value = preferredSolfegeLabel(
      currentPrompt.value.targetSolfege,
      enabledSolfege.value,
    );
  }

  function nextQuestion() {
    const index = roundEvents.value.length + 1;
    if (index > questionsPerRound.value) {
      trainingPhase.value = "round-complete";
      return;
    }

    const prompt = generateEarTrainingQuestion({
      doMidi: doMidi.value,
      doStringNo: doString.value,
      doFret: doFret.value,
      difficulty: difficulty.value,
      useDoReference: useDoReference.value,
      questionIndex: index,
      totalQuestions: questionsPerRound.value,
      recentSolfege: recentSolfege.value,
      enabledSolfege: enabledSolfege.value,
    });

    currentPrompt.value = prompt;
    lastAnswer.value = null;
    revealedSolfege.value = null;
    trainingPhase.value = "prompt";
    questionStartedAt.value = performance.now();
    void playQuestionCues(prompt);
  }

  function startRound() {
    if (!canStartRound.value) return;
    roundEvents.value = [];
    recentSolfege.value = [];
    lastAnswer.value = null;
    reviewRedoResults.value = [];
    reviewingWrongIndex.value = null;
    nextQuestion();
  }

  function submitAnswer(pickedSolfege: string) {
    const phase = trainingPhase.value;
    if ((phase !== "prompt" && phase !== "review-prompt") || !currentPrompt.value) return;

    const prompt = currentPrompt.value;
    const correct = solfegeAnswersMatch(pickedSolfege, prompt.targetMidi, prompt.doMidi);
    const event: EarTrainingAnswerEvent = {
      questionIndex: prompt.questionIndex,
      targetMidi: prompt.targetMidi,
      targetSolfege: targetSolfegeForMidi(prompt.targetMidi, prompt.doMidi),
      targetNoteName: prompt.targetNoteName,
      pickedSolfege,
      correct,
      responseMs: Math.round(performance.now() - questionStartedAt.value),
      timestamp: Date.now(),
    };

    lastAnswer.value = event;

    if (phase === "review-prompt") {
      reviewRedoResults.value.push({
        questionIndex: event.questionIndex,
        correct: event.correct,
        summary: `第 ${event.questionIndex} 题 · ${event.targetSolfege} · ${event.targetNoteName}`,
      });
      trainingPhase.value = "review-feedback";
      return;
    }

    roundEvents.value.push(event);
    recentSolfege.value.push(event.targetSolfege);
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

  async function replayWrongAnswer(event: EarTrainingAnswerEvent) {
    const prompt = promptFromWrongEvent(event);
    isPlayingCue.value = true;
    try {
      if (prompt.useDoReference) {
        await playEarNamingMidi(prompt.doMidi);
        await delay(400);
      }
      await playEarNamingMidi(prompt.targetMidi);
    } finally {
      isPlayingCue.value = false;
    }
  }

  function startWrongRedo(event: EarTrainingAnswerEvent) {
    currentPrompt.value = promptFromWrongEvent(event);
    lastAnswer.value = null;
    revealedSolfege.value = null;
    reviewingWrongIndex.value = event.questionIndex;
    trainingPhase.value = "review-prompt";
    questionStartedAt.value = performance.now();
    void playQuestionCues(currentPrompt.value);
  }

  function finishWrongRedo() {
    trainingPhase.value = "round-complete";
    currentPrompt.value = null;
    lastAnswer.value = null;
    revealedSolfege.value = null;
    reviewingWrongIndex.value = null;
  }

  function isReviewRedoCorrect(questionIndex: number) {
    return reviewRedoResults.value.some((r) => r.questionIndex === questionIndex && r.correct);
  }

  return {
    doString,
    doFret,
    doReferencePoint,
    doReferenceSummary,
    canRandomizeDoReference,
    useDoReference,
    difficulty,
    questionsPerRound,
    enabledSolfege,
    questionPool,
    canStartRound,
    trainingPhase,
    currentPrompt,
    roundEvents,
    lastAnswer,
    isPlayingCue,
    revealedSolfege,
    doMidi,
    roundStats,
    questionProgress,
    wrongAnswers,
    reviewRedoResults,
    reviewingWrongIndex,
    resetTraining,
    reloadSettings,
    toggleEnabledSolfege,
    setDoReference,
    randomizeDoReferencePosition,
    startRound,
    submitAnswer,
    continueAfterFeedback,
    replayDo,
    replayTarget,
    revealAnswer,
    replayWrongAnswer,
    startWrongRedo,
    finishWrongRedo,
    isReviewRedoCorrect,
  };
});
