import {
  ALL_EAR_TRAINING_SOLFEGE,
  DEFAULT_ENABLED_EAR_TRAINING_SOLFEGE,
  EAR_EXAM_TOTAL_QUESTIONS,
  type EarExamDoSegment,
  type EarExamPlan,
  type EarTrainingDifficulty,
  type EarTrainingSolfegeName,
} from "../../types/earNaming";
import { collectMidiPool } from "./earTrainingDifficulty";
import { buildFretboard, type FretPoint } from "./fretboard";

const MAX_FRET = 22;

const DIFFICULTY_STRINGS: Record<EarTrainingDifficulty, number[]> = {
  beginner: [6, 5, 4, 3],
  intermediate: [6, 5, 4, 3, 2],
  advanced: [6, 5, 4, 3, 2, 1],
};

export function defaultSolfegeForExam(difficulty: EarTrainingDifficulty): EarTrainingSolfegeName[] {
  if (difficulty === "beginner") {
    return [...DEFAULT_ENABLED_EAR_TRAINING_SOLFEGE];
  }
  return [...ALL_EAR_TRAINING_SOLFEGE];
}

function segmentStartsForDifficulty(difficulty: EarTrainingDifficulty): number[] {
  if (difficulty === "beginner") return [1];
  if (difficulty === "intermediate") return [1, 11];
  return [1, 5, 9, 13, 17];
}

function pickRandomDoPoint(difficulty: EarTrainingDifficulty): FretPoint {
  const points = buildFretboard(MAX_FRET, DIFFICULTY_STRINGS[difficulty]);
  return points[Math.floor(Math.random() * points.length)]!;
}

function pickDoWithValidPool(
  difficulty: EarTrainingDifficulty,
  enabledSolfege: EarTrainingSolfegeName[],
  excludeMidis: number[] = [],
): { doMidi: number; doStringNo: number; doFret: number } {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const point = pickRandomDoPoint(difficulty);
    if (excludeMidis.includes(point.midi)) continue;
    const pool = collectMidiPool(
      point.midi,
      difficulty,
      enabledSolfege,
      point.stringNo,
      point.fret,
    );
    if (pool.length > 0) {
      return { doMidi: point.midi, doStringNo: point.stringNo, doFret: point.fret };
    }
  }
  throw new Error("ear exam: cannot pick valid Do reference");
}

export function buildEarExamPlan(difficulty: EarTrainingDifficulty): EarExamPlan {
  const enabledSolfege = defaultSolfegeForExam(difficulty);
  const starts = segmentStartsForDifficulty(difficulty);
  const doSegments: EarExamDoSegment[] = [];
  const usedDoMidis: number[] = [];

  for (let i = 0; i < starts.length; i += 1) {
    const startQuestion = starts[i]!;
    const endQuestion = i < starts.length - 1 ? starts[i + 1]! - 1 : EAR_EXAM_TOTAL_QUESTIONS;
    const exclude = i > 0 ? usedDoMidis : [];
    const { doMidi, doStringNo, doFret } = pickDoWithValidPool(difficulty, enabledSolfege, exclude);
    usedDoMidis.push(doMidi);
    doSegments.push({ startQuestion, endQuestion, doMidi, doStringNo, doFret });
  }

  return {
    difficulty,
    totalQuestions: EAR_EXAM_TOTAL_QUESTIONS,
    doSegments,
    enabledSolfege,
  };
}

export function doMidiForQuestion(plan: EarExamPlan, questionIndex: number): number {
  return doSegmentForQuestion(plan, questionIndex).doMidi;
}

export function doStringForQuestion(plan: EarExamPlan, questionIndex: number): number {
  return doSegmentForQuestion(plan, questionIndex).doStringNo;
}

export function doFretForQuestion(plan: EarExamPlan, questionIndex: number): number {
  return doSegmentForQuestion(plan, questionIndex).doFret;
}

function doSegmentForQuestion(plan: EarExamPlan, questionIndex: number): EarExamDoSegment {
  const segment = plan.doSegments.find(
    (item) => questionIndex >= item.startQuestion && questionIndex <= item.endQuestion,
  );
  if (!segment) {
    return plan.doSegments[plan.doSegments.length - 1]!;
  }
  return segment;
}

export function isDoSegmentStart(plan: EarExamPlan, questionIndex: number): boolean {
  return plan.doSegments.some((segment) => segment.startQuestion === questionIndex);
}

export function canBuildEarExamPlan(difficulty: EarTrainingDifficulty): boolean {
  try {
    buildEarExamPlan(difficulty);
    return true;
  } catch {
    return false;
  }
}
