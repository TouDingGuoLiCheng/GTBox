import type { IntervalKind, TrainingMode, TrainingPrompt } from "../../types/earNaming";
import {
  buildFretboard,
  findSamePitchClass,
  getFretPoint,
  toSolfegeName,
  type FretPoint,
} from "./fretboard";

const MAJOR_DEGREES = [1, 2, 3, 4, 5, 6, 7] as const;
const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11] as const;
const INTERVAL_KINDS: IntervalKind[] = ["whole-up", "whole-down", "half-up", "half-down"];

export function pointKey(point: FretPoint): string {
  return `${point.stringNo}-${point.fret}`;
}

export function intervalSemitones(kind: IntervalKind): number {
  switch (kind) {
    case "whole-up":
      return 2;
    case "whole-down":
      return -2;
    case "half-up":
      return 1;
    case "half-down":
      return -1;
  }
}

export function isPitchClassMatch(pickedMidi: number, targetMidi: number): boolean {
  return ((pickedMidi % 12) + 12) % 12 === ((targetMidi % 12) + 12) % 12;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pickRandomPoint(
  points: FretPoint[],
  excludeKeys: Set<string>,
  recentAnchors: FretPoint[],
  historyWindow = 5,
): FretPoint {
  const recentKeys = new Set(recentAnchors.slice(-historyWindow).map(pointKey));
  const candidates = points.filter((p) => !excludeKeys.has(pointKey(p)) && !recentKeys.has(pointKey(p)));
  const pool = candidates.length > 0 ? candidates : points.filter((p) => !excludeKeys.has(pointKey(p)));
  const finalPool = pool.length > 0 ? pool : points;
  return finalPool[Math.floor(Math.random() * finalPool.length)];
}

function pickDegreeTargetMidi(doMidi: number, degree: number): number {
  const semitones = MAJOR_INTERVALS[degree - 1];
  return doMidi + semitones;
}

function pointsForTargetMidi(
  maxFret: number,
  enabledStrings: number[],
  targetMidi: number,
): FretPoint[] {
  const board = buildFretboard(maxFret, enabledStrings);
  return findSamePitchClass(board, targetMidi);
}

export interface GenerateQuestionInput {
  mode: TrainingMode;
  doMidi: number;
  maxFret: number;
  enabledStrings: number[];
  questionIndex: number;
  totalQuestions: number;
  recentAnchors?: FretPoint[];
  dictationNoteCount?: number;
}

export function generateQuestion(input: GenerateQuestionInput): TrainingPrompt {
  const {
    mode,
    doMidi,
    maxFret,
    enabledStrings,
    questionIndex,
    totalQuestions,
    recentAnchors = [],
    dictationNoteCount = 3,
  } = input;
  const board = buildFretboard(maxFret, enabledStrings);

  if (mode === "naming-dictation") {
    const count = Math.min(5, Math.max(3, dictationNoteCount));
    const usedKeys = new Set<string>();
    const notes: FretPoint[] = [];
    let guard = 0;
    while (notes.length < count && guard < 80) {
      guard += 1;
      const point = pickRandomPoint(board, usedKeys, recentAnchors);
      const key = pointKey(point);
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      notes.push(point);
    }
    return {
      mode,
      questionIndex,
      totalQuestions,
      doMidi,
      targetMidi: notes[0]?.midi ?? doMidi,
      dictationNotes: notes,
      anchorPoint: notes[0],
    };
  }

  if (mode === "degree-locate") {
    const degree = MAJOR_DEGREES[Math.floor(Math.random() * MAJOR_DEGREES.length)];
    const targetMidi = pickDegreeTargetMidi(doMidi, degree);
    const validPoints = pointsForTargetMidi(maxFret, enabledStrings, targetMidi);
    const anchorPoint = pickRandomPoint(validPoints, new Set(), recentAnchors);
    return {
      mode,
      questionIndex,
      totalQuestions,
      doMidi,
      targetDegree: degree,
      targetMidi,
      anchorPoint,
    };
  }

  if (mode === "solfege-locate") {
    const anchorPoint = pickRandomPoint(board, new Set(), recentAnchors);
    const targetMidi = anchorPoint.midi;
    return {
      mode,
      questionIndex,
      totalQuestions,
      doMidi,
      targetSolfege: toSolfegeName(targetMidi, doMidi),
      targetMidi,
      anchorPoint,
    };
  }

  const referencePoint = pickRandomPoint(board, new Set(), recentAnchors);
  let intervalKind = INTERVAL_KINDS[Math.floor(Math.random() * INTERVAL_KINDS.length)];
  let targetMidi = referencePoint.midi + intervalSemitones(intervalKind);
  let attempts = 0;
  while (attempts < 12) {
    const matches = pointsForTargetMidi(maxFret, enabledStrings, targetMidi);
    if (matches.length > 0) break;
    intervalKind = INTERVAL_KINDS[Math.floor(Math.random() * INTERVAL_KINDS.length)];
    targetMidi = referencePoint.midi + intervalSemitones(intervalKind);
    attempts += 1;
  }

  return {
    mode,
    questionIndex,
    totalQuestions,
    doMidi,
    referencePoint,
    intervalKind,
    targetMidi,
    anchorPoint: referencePoint,
  };
}

export function buildPromptSummary(prompt: TrainingPrompt): string {
  if (prompt.mode === "naming-dictation") {
    const count = prompt.dictationNotes?.length ?? 0;
    return `${count}音片段`;
  }
  if (prompt.mode === "degree-locate") {
    return `级数 ${prompt.targetDegree}`;
  }
  if (prompt.mode === "solfege-locate") {
    return `唱名 ${prompt.targetSolfege}`;
  }
  const ref = prompt.referencePoint ?? getFretPoint(6, 0);
  return `${ref.stringNo}弦${ref.fret}品 → ${prompt.intervalKind}`;
}

export function getCorrectPoints(
  prompt: TrainingPrompt,
  maxFret: number,
  enabledStrings: number[],
): FretPoint[] {
  return pointsForTargetMidi(maxFret, enabledStrings, prompt.targetMidi);
}

export function pickDegreesForTest(): number[] {
  return shuffle([...MAJOR_DEGREES]);
}
