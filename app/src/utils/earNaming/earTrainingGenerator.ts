import type { EarTrainingDifficulty, EarTrainingPrompt } from "../../types/earNaming";
import { collectMidiPool } from "./earTrainingDifficulty";
import { midiToNoteName } from "./fretboard";
import { targetSolfegeForMidi } from "./solfegeMatch";

export interface GenerateEarTrainingInput {
  doMidi: number;
  doStringNo?: number;
  doFret?: number;
  difficulty: EarTrainingDifficulty;
  useDoReference: boolean;
  questionIndex: number;
  totalQuestions: number;
  recentSolfege?: string[];
  enabledSolfege?: string[];
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pickMidi(
  pool: number[],
  doMidi: number,
  recentSolfege: string[],
  difficulty: EarTrainingDifficulty,
): number {
  const lastSolfege = recentSolfege[recentSolfege.length - 1];
  const avoidRepeat = difficulty === "advanced" && lastSolfege;

  const bySolfege = new Map<string, number[]>();
  for (const midi of pool) {
    const name = targetSolfegeForMidi(midi, doMidi);
    const list = bySolfege.get(name);
    if (list) list.push(midi);
    else bySolfege.set(name, [midi]);
  }

  let solfegeNames = [...bySolfege.keys()];
  if (avoidRepeat && solfegeNames.length > 1) {
    const filtered = solfegeNames.filter((name) => name !== lastSolfege);
    if (filtered.length > 0) solfegeNames = filtered;
  }

  const pickedSolfege = shuffle(solfegeNames)[0];
  if (!pickedSolfege) return pool[0] ?? doMidi;
  const midis = bySolfege.get(pickedSolfege) ?? pool;
  return shuffle(midis)[0] ?? pool[0] ?? doMidi;
}

export function generateEarTrainingQuestion(input: GenerateEarTrainingInput): EarTrainingPrompt {
  const pool = collectMidiPool(
    input.doMidi,
    input.difficulty,
    input.enabledSolfege,
    input.doStringNo,
    input.doFret,
  );
  if (pool.length === 0) {
    throw new Error("ear training midi pool is empty for selected solfege");
  }

  const targetMidi = pickMidi(pool, input.doMidi, input.recentSolfege ?? [], input.difficulty);
  const targetSolfege = targetSolfegeForMidi(targetMidi, input.doMidi);
  const pitchClassName = midiToNoteName(targetMidi).replace(/-?\d+$/, "");

  return {
    questionIndex: input.questionIndex,
    totalQuestions: input.totalQuestions,
    targetMidi,
    targetSolfege,
    targetNoteName: pitchClassName,
    useDoReference: input.useDoReference,
    doMidi: input.doMidi,
    difficulty: input.difficulty,
  };
}

export function computeEarTrainingRoundStats(
  events: Array<{ correct: boolean; responseMs: number; targetSolfege: string }>,
) {
  const total = events.length;
  const correct = events.filter((e) => e.correct).length;
  const accuracy = total > 0 ? correct / total : 0;
  const avgResponseMs =
    total > 0 ? Math.round(events.reduce((sum, e) => sum + e.responseMs, 0) / total) : 0;

  const bySolfege: Record<string, { total: number; correct: number }> = {};
  for (const event of events) {
    const key = event.targetSolfege;
    if (!bySolfege[key]) {
      bySolfege[key] = { total: 0, correct: 0 };
    }
    bySolfege[key].total += 1;
    if (event.correct) {
      bySolfege[key].correct += 1;
    }
  }

  const weaknessHints: string[] = [];
  for (const [solfege, stat] of Object.entries(bySolfege)) {
    if (stat.total >= 2 && stat.correct / stat.total < 0.5) {
      weaknessHints.push(`唱名 ${solfege} 错误偏多（${stat.correct}/${stat.total}）`);
    }
  }

  return { total, correct, accuracy, avgResponseMs, bySolfege, weaknessHints };
}
