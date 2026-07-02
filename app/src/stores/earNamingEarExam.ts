import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type {
  EarExamAnswerEvent,
  EarExamInProgressSubPhase,
  EarExamPhase,
  EarExamPlan,
  EarExamRecord,
  EarExamReviewPhase,
  EarExamReviewRedoResult,
  EarTrainingDifficulty,
  EarTrainingPrompt,
} from "../types/earNaming";
import {
  EAR_EXAM_HISTORY_KEY,
  EAR_EXAM_HISTORY_MAX,
  EAR_EXAM_PASS_COUNT,
  EAR_EXAM_TIME_LIMIT_SEC,
  EAR_EXAM_TOTAL_QUESTIONS,
  EAR_TRAINING_DIFFICULTY_LABELS,
} from "../types/earNaming";
import {
  buildEarExamPlan,
  canBuildEarExamPlan,
  doMidiForQuestion,
  doStringForQuestion,
  doFretForQuestion,
  isDoSegmentStart,
} from "../utils/earNaming/earExamPlan";
import {
  computeEarTrainingRoundStats,
  generateEarTrainingQuestion,
} from "../utils/earNaming/earTrainingGenerator";
import { playEarNamingMidi } from "../utils/earNaming/sampler";
import { solfegeAnswersMatch, targetSolfegeForMidi } from "../utils/earNaming/solfegeMatch";
import { pushDebugLine } from "../utils/mediaDebug";

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function loadHistoryRecords(): EarExamRecord[] {
  try {
    const raw = localStorage.getItem(EAR_EXAM_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as EarExamRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistoryRecords(records: EarExamRecord[]) {
  localStorage.setItem(EAR_EXAM_HISTORY_KEY, JSON.stringify(records));
}

export const useEarNamingEarExamStore = defineStore("earNamingEarExam", () => {
  const examPhase = ref<EarExamPhase>("level-select");
  const selectedDifficulty = ref<EarTrainingDifficulty | null>(null);
  const examPlan = ref<EarExamPlan | null>(null);
  const inProgressSubPhase = ref<EarExamInProgressSubPhase>("playing-cue");
  const currentPrompt = ref<EarTrainingPrompt | null>(null);
  const answerEvents = ref<EarExamAnswerEvent[]>([]);
  const recentSolfege = ref<string[]>([]);
  const isPlayingCue = ref(false);
  const showDoUpdatedHint = ref(false);
  const timerRemainingSec = ref<number | null>(null);
  const examStartedAt = ref(0);
  const examFinishedAt = ref(0);
  const questionAnswerStartedAt = ref(0);

  const reviewPhase = ref<EarExamReviewPhase>("idle");
  const reviewPrompt = ref<EarTrainingPrompt | null>(null);
  const reviewRedoResults = ref<EarExamReviewRedoResult[]>([]);
  const reviewingQuestionIndex = ref<number | null>(null);
  const reviewAnswerStartedAt = ref(0);
  const historyRecords = ref<EarExamRecord[]>(loadHistoryRecords());

  let answerTimerId: ReturnType<typeof setInterval> | null = null;
  let answerDeadlineAt = 0;
  let doHintTimerId: ReturnType<typeof setTimeout> | null = null;
  let advancing = false;

  const difficultyLabel = computed(() =>
    selectedDifficulty.value ? EAR_TRAINING_DIFFICULTY_LABELS[selectedDifficulty.value] : "",
  );

  const canStartExam = computed(() =>
    selectedDifficulty.value ? canBuildEarExamPlan(selectedDifficulty.value) : false,
  );

  const questionProgress = computed(() => {
    if (examPhase.value !== "in-progress") {
      return { current: 0, total: EAR_EXAM_TOTAL_QUESTIONS };
    }
    const answered = answerEvents.value.length;
    const current =
      currentPrompt.value?.questionIndex ?? Math.min(answered + 1, EAR_EXAM_TOTAL_QUESTIONS);
    return { current, total: EAR_EXAM_TOTAL_QUESTIONS };
  });

  const examStats = computed(() =>
    computeEarTrainingRoundStats(
      answerEvents.value.map((event) => ({
        correct: event.correct,
        responseMs: event.responseMs,
        targetSolfege: event.targetSolfege,
      })),
    ),
  );

  const examScore = computed(() => {
    const { total, correct, accuracy, avgResponseMs } = examStats.value;
    return {
      total,
      correct,
      accuracy,
      passed: correct >= EAR_EXAM_PASS_COUNT,
      avgResponseMs,
    };
  });

  const examDurationMs = computed(() => {
    if (!examStartedAt.value || !examFinishedAt.value) return 0;
    return Math.max(0, Math.round(examFinishedAt.value - examStartedAt.value));
  });

  const wrongAnswers = computed(() => answerEvents.value.filter((event) => !event.correct));

  const timeLimitSec = computed(() =>
    selectedDifficulty.value ? EAR_EXAM_TIME_LIMIT_SEC[selectedDifficulty.value] : null,
  );

  function clearReviewState() {
    reviewPhase.value = "idle";
    reviewPrompt.value = null;
    reviewingQuestionIndex.value = null;
    reviewAnswerStartedAt.value = 0;
  }

  function clearAnswerTimer() {
    if (answerTimerId !== null) {
      clearInterval(answerTimerId);
      answerTimerId = null;
    }
    timerRemainingSec.value = null;
  }

  function clearDoHintTimer() {
    if (doHintTimerId !== null) {
      clearTimeout(doHintTimerId);
      doHintTimerId = null;
    }
    showDoUpdatedHint.value = false;
  }

  function clearTimers() {
    clearAnswerTimer();
    clearDoHintTimer();
  }

  function selectLevel(difficulty: EarTrainingDifficulty) {
    selectedDifficulty.value = difficulty;
    examPhase.value = "briefing";
    pushDebugLine("听力考试", "select-level", EAR_TRAINING_DIFFICULTY_LABELS[difficulty]);
  }

  function backToLevelSelect() {
    clearTimers();
    clearReviewState();
    examPhase.value = "level-select";
    selectedDifficulty.value = null;
    examPlan.value = null;
    currentPrompt.value = null;
    answerEvents.value = [];
    recentSolfege.value = [];
    reviewRedoResults.value = [];
    inProgressSubPhase.value = "playing-cue";
    isPlayingCue.value = false;
    examStartedAt.value = 0;
    examFinishedAt.value = 0;
    pushDebugLine("听力考试", "back-to-level-select");
  }

  function reset() {
    clearTimers();
    clearReviewState();
    examPhase.value = "level-select";
    selectedDifficulty.value = null;
    examPlan.value = null;
    currentPrompt.value = null;
    answerEvents.value = [];
    recentSolfege.value = [];
    reviewRedoResults.value = [];
    inProgressSubPhase.value = "playing-cue";
    isPlayingCue.value = false;
    examStartedAt.value = 0;
    examFinishedAt.value = 0;
    questionAnswerStartedAt.value = 0;
    advancing = false;
    pushDebugLine("听力考试", "reset");
  }

  function showDoUpdatedNotice() {
    clearDoHintTimer();
    showDoUpdatedHint.value = true;
    doHintTimerId = window.setTimeout(() => {
      showDoUpdatedHint.value = false;
      doHintTimerId = null;
    }, 2800);
  }

  function startAnswerTimer() {
    clearAnswerTimer();
    const limit = timeLimitSec.value;
    if (limit === null) return;

    answerDeadlineAt = performance.now() + limit * 1000;
    timerRemainingSec.value = limit;
    answerTimerId = window.setInterval(() => {
      const remaining = Math.ceil((answerDeadlineAt - performance.now()) / 1000);
      timerRemainingSec.value = Math.max(0, remaining);
      if (remaining <= 0) {
        clearAnswerTimer();
        void handleTimeout();
      }
    }, 200);
  }

  async function playPromptCues(prompt: EarTrainingPrompt) {
    isPlayingCue.value = true;
    try {
      await playEarNamingMidi(prompt.doMidi);
      await delay(400);
      await playEarNamingMidi(prompt.targetMidi);
    } finally {
      isPlayingCue.value = false;
    }
  }

  async function playQuestionCues(prompt: EarTrainingPrompt) {
    inProgressSubPhase.value = "playing-cue";
    await playPromptCues(prompt);
  }

  function recordAnswer(pickedSolfege: string | null, timedOut: boolean) {
    const prompt = currentPrompt.value;
    if (!prompt || !examPlan.value) return;

    const correct = timedOut
      ? false
      : solfegeAnswersMatch(pickedSolfege ?? "", prompt.targetMidi, prompt.doMidi);
    const responseMs = timedOut
      ? (timeLimitSec.value ?? 0) * 1000
      : Math.round(performance.now() - questionAnswerStartedAt.value);

    const event: EarExamAnswerEvent = {
      questionIndex: prompt.questionIndex,
      targetMidi: prompt.targetMidi,
      targetSolfege: targetSolfegeForMidi(prompt.targetMidi, prompt.doMidi),
      targetNoteName: prompt.targetNoteName,
      pickedSolfege,
      correct,
      responseMs,
      timedOut,
      doMidi: prompt.doMidi,
      promptSnapshot: { ...prompt },
    };

    answerEvents.value.push(event);
    recentSolfege.value.push(event.targetSolfege);
    pushDebugLine(
      "听力考试",
      timedOut ? "timeout" : "answer",
      `第 ${event.questionIndex} 题 · ${correct ? "对" : "错"}`,
    );
  }

  async function advanceAfterAnswer() {
    if (advancing) return;
    advancing = true;
    await delay(180);
    advancing = false;
    void nextQuestion();
  }

  function submitAnswer(pickedSolfege: string) {
    if (examPhase.value !== "in-progress" || inProgressSubPhase.value !== "answering") return;
    if (!currentPrompt.value) return;

    clearAnswerTimer();
    recordAnswer(pickedSolfege, false);
    currentPrompt.value = null;
    inProgressSubPhase.value = "playing-cue";
    void advanceAfterAnswer();
  }

  async function handleTimeout() {
    if (examPhase.value !== "in-progress" || inProgressSubPhase.value !== "answering") return;
    if (!currentPrompt.value) return;

    recordAnswer(null, true);
    currentPrompt.value = null;
    inProgressSubPhase.value = "playing-cue";
    await advanceAfterAnswer();
  }

  function persistExamRecord() {
    if (!selectedDifficulty.value) return;

    const stats = examStats.value;
    const score = examScore.value;
    const record: EarExamRecord = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      difficulty: selectedDifficulty.value,
      correct: score.correct,
      total: score.total,
      accuracy: score.accuracy,
      passed: score.passed,
      avgResponseMs: score.avgResponseMs,
      durationMs: examDurationMs.value,
      bySolfege: stats.bySolfege,
    };

    historyRecords.value = [record, ...historyRecords.value].slice(0, EAR_EXAM_HISTORY_MAX);
    saveHistoryRecords(historyRecords.value);
    pushDebugLine("听力考试", "history-save", `${score.correct}/${score.total}`);
  }

  function openHistory() {
    examPhase.value = "history";
    pushDebugLine("听力考试", "open-history");
  }

  function backFromHistory() {
    examPhase.value = "level-select";
    pushDebugLine("听力考试", "back-from-history");
  }
  function finishExam() {
    clearTimers();
    currentPrompt.value = null;
    examFinishedAt.value = performance.now();
    persistExamRecord();
    examPhase.value = "report";
    pushDebugLine(
      "听力考试",
      "report",
      `${examScore.value.correct}/${examScore.value.total} · ${examScore.value.passed ? "通过" : "未通过"}`,
    );
  }

  async function nextQuestion() {
    const plan = examPlan.value;
    if (!plan || examPhase.value !== "in-progress") return;

    const index = answerEvents.value.length + 1;
    if (index > EAR_EXAM_TOTAL_QUESTIONS) {
      finishExam();
      return;
    }

    if (index > 1 && isDoSegmentStart(plan, index)) {
      showDoUpdatedNotice();
    }

    const doMidi = doMidiForQuestion(plan, index);
    const doStringNo = doStringForQuestion(plan, index);
    const doFret = doFretForQuestion(plan, index);
    const prompt = generateEarTrainingQuestion({
      doMidi,
      doStringNo,
      doFret,
      difficulty: plan.difficulty,
      useDoReference: true,
      questionIndex: index,
      totalQuestions: EAR_EXAM_TOTAL_QUESTIONS,
      recentSolfege: recentSolfege.value,
      enabledSolfege: plan.enabledSolfege,
    });

    currentPrompt.value = prompt;
    await playQuestionCues(prompt);
    if (examPhase.value !== "in-progress") return;

    inProgressSubPhase.value = "answering";
    questionAnswerStartedAt.value = performance.now();
    startAnswerTimer();
  }

  function startExam() {
    if (!selectedDifficulty.value || !canStartExam.value) return;

    clearTimers();
    clearReviewState();
    examPlan.value = buildEarExamPlan(selectedDifficulty.value);
    answerEvents.value = [];
    recentSolfege.value = [];
    reviewRedoResults.value = [];
    currentPrompt.value = null;
    examStartedAt.value = performance.now();
    examFinishedAt.value = 0;
    examPhase.value = "in-progress";
    inProgressSubPhase.value = "playing-cue";
    pushDebugLine("听力考试", "start", difficultyLabel.value);
    void nextQuestion();
  }

  function requestAbandon(): boolean {
    if (examPhase.value !== "in-progress") return true;
    return window.confirm("未交卷，退出将丢弃本次考试进度。确定离开？");
  }

  async function replayWrongAnswer(event: EarExamAnswerEvent) {
    pushDebugLine("听力考试", "replay-wrong", `第 ${event.questionIndex} 题`);
    await playPromptCues(event.promptSnapshot);
  }

  function isReviewRedoCorrect(questionIndex: number) {
    return reviewRedoResults.value.some((item) => item.questionIndex === questionIndex && item.correct);
  }

  async function startWrongRedo(event: EarExamAnswerEvent) {
    reviewPrompt.value = { ...event.promptSnapshot };
    reviewingQuestionIndex.value = event.questionIndex;
    reviewPhase.value = "redo-prompt";
    reviewAnswerStartedAt.value = performance.now();
    pushDebugLine("听力考试", "redo-start", `第 ${event.questionIndex} 题`);
    await playPromptCues(reviewPrompt.value);
  }

  function submitReviewAnswer(pickedSolfege: string) {
    if (reviewPhase.value !== "redo-prompt" || !reviewPrompt.value) return;

    const prompt = reviewPrompt.value;
    const correct = solfegeAnswersMatch(pickedSolfege, prompt.targetMidi, prompt.doMidi);
    const questionIndex = reviewingQuestionIndex.value ?? prompt.questionIndex;

    reviewRedoResults.value = reviewRedoResults.value.filter((item) => item.questionIndex !== questionIndex);
    reviewRedoResults.value.push({ questionIndex, correct });
    reviewPhase.value = "redo-feedback";
    pushDebugLine("听力考试", "redo-answer", `第 ${questionIndex} 题 · ${correct ? "对" : "错"}`);
  }

  function finishReviewRedo() {
    clearReviewState();
    pushDebugLine("听力考试", "redo-done");
  }

  function cancelReviewRedo() {
    if (reviewPhase.value === "idle") return;
    clearReviewState();
    pushDebugLine("听力考试", "redo-cancel");
  }

  return {
    examPhase,
    selectedDifficulty,
    examPlan,
    inProgressSubPhase,
    currentPrompt,
    answerEvents,
    isPlayingCue,
    showDoUpdatedHint,
    timerRemainingSec,
    examStartedAt,
    examFinishedAt,
    examDurationMs,
    difficultyLabel,
    canStartExam,
    questionProgress,
    examScore,
    examStats,
    wrongAnswers,
    timeLimitSec,
    reviewPhase,
    reviewPrompt,
    reviewRedoResults,
    reviewingQuestionIndex,
    historyRecords,
    selectLevel,
    backToLevelSelect,
    reset,
    startExam,
    submitAnswer,
    requestAbandon,
    replayWrongAnswer,
    startWrongRedo,
    submitReviewAnswer,
    finishReviewRedo,
    cancelReviewRedo,
    isReviewRedoCorrect,
    openHistory,
    backFromHistory,
  };
});
