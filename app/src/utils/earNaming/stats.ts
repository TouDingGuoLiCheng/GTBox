import type { AnswerEvent, SessionStats, TrainingMode } from "../../types/earNaming";
import { toDegreeName } from "./fretboard";

const EMPTY_MODE_STATS = (): Record<TrainingMode, { total: number; correct: number }> => ({
  "degree-locate": { total: 0, correct: 0 },
  "solfege-locate": { total: 0, correct: 0 },
  "interval-locate": { total: 0, correct: 0 },
  "naming-dictation": { total: 0, correct: 0 },
});

function pushBucket(
  bucket: Record<string, { total: number; correct: number }>,
  key: string,
  correct: boolean,
) {
  if (!bucket[key]) bucket[key] = { total: 0, correct: 0 };
  bucket[key].total += 1;
  if (correct) bucket[key].correct += 1;
}

export function degreeLabelForMidi(midi: number, doMidi: number): string {
  return toDegreeName(midi, doMidi);
}

export function computeWeaknessHints(events: AnswerEvent[]): string[] {
  if (events.length === 0) return [];

  const hints: string[] = [];
  const byDegree: Record<string, { total: number; correct: number }> = {};
  const byString: Record<number, { total: number; correct: number }> = {};

  const flatAttempts: Array<{ degree: string; stringNo: number; correct: boolean }> = [];

  for (const event of events) {
    if (event.dictationDetails) {
      for (const note of event.dictationDetails) {
        pushBucket(byDegree, note.degreeLabel, note.correct);
        const sn = note.picked.stringNo;
        if (!byString[sn]) byString[sn] = { total: 0, correct: 0 };
        byString[sn].total += 1;
        if (note.correct) byString[sn].correct += 1;
        flatAttempts.push({
          degree: note.degreeLabel,
          stringNo: note.picked.stringNo,
          correct: note.correct,
        });
      }
      continue;
    }

    const degree = event.targetDegreeLabel ?? "未知";
    pushBucket(byDegree, degree, event.correct);
    const sn = event.picked.stringNo;
    if (!byString[sn]) byString[sn] = { total: 0, correct: 0 };
    byString[sn].total += 1;
    if (event.correct) byString[sn].correct += 1;
    flatAttempts.push({
      degree,
      stringNo: event.picked.stringNo,
      correct: event.correct,
    });
  }

  let worstDegree = "";
  let worstDegreeRate = 1;
  for (const [degree, stat] of Object.entries(byDegree)) {
    if (stat.total < 2) continue;
    const rate = stat.correct / stat.total;
    if (rate < worstDegreeRate) {
      worstDegreeRate = rate;
      worstDegree = degree;
    }
  }
  if (worstDegree && worstDegreeRate < 0.7) {
    hints.push(
      `${worstDegree}级 正确率偏低（${Math.round(worstDegreeRate * 100)}%），建议加练该级数定位`,
    );
  }

  let worstString = 0;
  let worstStringRate = 1;
  for (const [stringNo, stat] of Object.entries(byString)) {
    if (stat.total < 2) continue;
    const rate = stat.correct / stat.total;
    if (rate < worstStringRate) {
      worstStringRate = rate;
      worstString = Number(stringNo);
    }
  }
  if (worstString > 0 && worstStringRate < 0.7) {
    hints.push(
      `${worstString}弦 失误较多（正确率 ${Math.round(worstStringRate * 100)}%），可多练该弦音区`,
    );
  }

  let streakDegree = "";
  let streak = 0;
  for (const attempt of flatAttempts) {
    if (!attempt.correct) {
      if (attempt.degree === streakDegree) {
        streak += 1;
      } else {
        streakDegree = attempt.degree;
        streak = 1;
      }
      if (streak >= 2 && !hints.some((h) => h.includes(streakDegree))) {
        hints.push(`${streakDegree}级 连续出错 ${streak} 次，注意区分相邻音级`);
        break;
      }
    } else {
      streak = 0;
      streakDegree = "";
    }
  }

  if (hints.length === 0 && events.length >= 3) {
    const wrong = flatAttempts.filter((a) => !a.correct).length;
    if (wrong > 0) {
      hints.push(`本轮共 ${wrong} 次失误，建议先放慢速度再练一轮`);
    }
  }

  return hints.slice(0, 3);
}

export function computeSessionStats(events: AnswerEvent[]): SessionStats {
  const byMode = EMPTY_MODE_STATS();
  const byString: Record<number, { total: number; correct: number }> = {};
  const byDegree: Record<string, { total: number; correct: number }> = {};
  let correct = 0;
  let responseSum = 0;
  let attemptCount = 0;

  for (const event of events) {
    responseSum += event.responseMs;
    byMode[event.mode].total += 1;
    if (event.correct) correct += 1;
    if (event.correct) byMode[event.mode].correct += 1;

    if (event.dictationDetails) {
      for (const note of event.dictationDetails) {
        attemptCount += 1;
        pushBucket(byDegree, note.degreeLabel, note.correct);
        const stringNo = note.picked.stringNo;
        if (!byString[stringNo]) byString[stringNo] = { total: 0, correct: 0 };
        byString[stringNo].total += 1;
        if (note.correct) byString[stringNo].correct += 1;
      }
      continue;
    }

    attemptCount += 1;
    const stringNo = event.picked.stringNo;
    if (!byString[stringNo]) byString[stringNo] = { total: 0, correct: 0 };
    byString[stringNo].total += 1;
    if (event.correct) byString[stringNo].correct += 1;

    const degree = event.targetDegreeLabel ?? "未知";
    pushBucket(byDegree, degree, event.correct);
  }

  const total = events.length;
  return {
    total,
    correct,
    accuracy: total > 0 ? correct / total : 0,
    avgResponseMs: attemptCount > 0 ? Math.round(responseSum / attemptCount) : 0,
    byMode,
    byString,
    byDegree,
    weaknessHints: computeWeaknessHints(events),
  };
}

export function formatAccuracy(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function formatResponseMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const LOG_KEY = "ear-naming-answer-log-v1";

export function loadAnswerLog(): AnswerEvent[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as AnswerEvent[];
  } catch {
    return [];
  }
}

export function appendAnswerLog(events: AnswerEvent[]) {
  const existing = loadAnswerLog();
  const merged = [...existing, ...events].slice(-200);
  localStorage.setItem(LOG_KEY, JSON.stringify(merged));
}

export function clearAnswerLog() {
  localStorage.removeItem(LOG_KEY);
}
