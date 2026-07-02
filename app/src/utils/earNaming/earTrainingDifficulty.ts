import type { EarTrainingDifficulty } from "../../types/earNaming";
import { buildFretboard, deriveEarTrainingScalePath, getFretPoint } from "./fretboard";
import { filterMidiPoolBySolfege } from "./earTrainingSolfege";

/** 大调自然音程（半音数，相对 Do） */
export const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11] as const;

/** 进阶档额外音程（Fi、Ra 等；省略 #5/8 避免与导音 Si 混淆） */
export const INTERMEDIATE_EXTRA_INTERVALS = [1, 3, 6, 10] as const;

/** 熟练档：12 音中省略 #5（音程 8），因无独立作答钮 */
export const ADVANCED_INTERVALS = [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11] as const;

const DIFFICULTY_STRINGS: Record<EarTrainingDifficulty, number[]> = {
  beginner: [6, 5, 4, 3],
  intermediate: [6, 5, 4, 3, 2],
  advanced: [6, 5, 4, 3, 2, 1],
};

/** 出题弦集：难度默认弦 + Do 参照所在弦（入门时 Do 常在 2 弦，须纳入否则 Sol 等会落低八度） */
export function resolvePoolStrings(
  difficulty: EarTrainingDifficulty,
  doStringNo?: number,
): number[] {
  const base = [...DIFFICULTY_STRINGS[difficulty]];
  if (doStringNo !== undefined && !base.includes(doStringNo)) {
    base.push(doStringNo);
    base.sort((a, b) => b - a);
  }
  return base;
}

const MAX_FRET = 22;

/** 入门：相对 Do 参照向上/向下的最大半音跨度，避免跨八度听辨 */
const BEGINNER_REGISTER_HALF_SPAN = 12;

function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

/** 相对 Do 的唱名音程 → 首选音高（同弦上应往高把位，而非翻到低八度） */
export function canonicalMidiForInterval(doMidi: number, interval: number): number {
  if (interval === 0) return doMidi;
  return doMidi + interval;
}

function intervalFromDo(midi: number, doMidi: number): number {
  return (pitchClass(midi) - pitchClass(doMidi) + 12) % 12;
}

export function registerDistanceFromCanonical(midi: number, doMidi: number): number {
  const interval = intervalFromDo(midi, doMidi);
  return Math.abs(midi - canonicalMidiForInterval(doMidi, interval));
}

/** 每个音级只保留一个音高；同音名时贴近 do+音程 的首选音高 */
export function collapseToNearestRegister(pool: number[], doMidi: number): number[] {
  const doPc = pitchClass(doMidi);
  const byPc = new Map<number, number>();
  for (const midi of pool) {
    const pc = pitchClass(midi);
    const prev = byPc.get(pc);
    if (prev === undefined) {
      byPc.set(pc, midi);
      continue;
    }
    const interval = (pc - doPc + 12) % 12;
    byPc.set(pc, pickPreferredSameRegister(prev, midi, doMidi, interval));
  }
  return [...byPc.values()].sort((a, b) => a - b);
}

function pickPreferredSameRegister(
  a: number,
  b: number,
  doMidi: number,
  interval: number,
): number {
  const ideal = canonicalMidiForInterval(doMidi, interval);
  const distA = Math.abs(a - ideal);
  const distB = Math.abs(b - ideal);
  if (distA !== distB) return distA < distB ? a : b;
  if (interval === 0) {
    return Math.abs(a - doMidi) <= Math.abs(b - doMidi) ? a : b;
  }
  return Math.max(a, b);
}

function filterBeginnerRegister(pool: number[], doMidi: number): number[] {
  return pool.filter(
    (midi) => Math.abs(midi - doMidi) <= BEGINNER_REGISTER_HALF_SPAN,
  );
}

export function allowedIntervalsForDifficulty(difficulty: EarTrainingDifficulty): number[] {
  if (difficulty === "beginner") {
    return [...MAJOR_INTERVALS];
  }
  if (difficulty === "intermediate") {
    return [...MAJOR_INTERVALS, ...INTERMEDIATE_EXTRA_INTERVALS];
  }
  return [...ADVANCED_INTERVALS];
}

function collectLegacyBoardMidis(
  doMidi: number,
  strings: number[],
  allowed: Set<number>,
  difficulty: EarTrainingDifficulty,
): number[] {
  const doPitchClass = pitchClass(doMidi);
  const points = buildFretboard(MAX_FRET, strings);
  const midis = new Set<number>();

  for (const point of points) {
    const interval = (pitchClass(point.midi) - doPitchClass + 12) % 12;
    if (allowed.has(interval)) {
      midis.add(point.midi);
    }
  }

  let pool = [...midis].sort((a, b) => a - b);
  if (difficulty === "beginner") {
    pool = filterBeginnerRegister(pool, doMidi);
  }
  return collapseToNearestRegister(pool, doMidi);
}

function collectScalePathMidis(
  doStringNo: number,
  doFret: number,
  doMidi: number,
  difficulty: EarTrainingDifficulty,
  strings: number[],
  allowed: Set<number>,
): number[] {
  const path = deriveEarTrainingScalePath(doStringNo, doFret, MAX_FRET, strings);
  const doPc = pitchClass(doMidi);
  const midis = new Set<number>();

  for (const key of path.keys()) {
    const [stringNo, fret] = key.split("-").map(Number);
    const point = getFretPoint(stringNo, fret);
    const interval = (pitchClass(point.midi) - doPc + 12) % 12;
    if (allowed.has(interval)) {
      midis.add(point.midi);
    }
  }

  if (difficulty === "beginner" || midis.size === 0) {
    return [...midis].sort((a, b) => a - b);
  }

  const pathMidiList = [...midis];
  const minMidi = Math.min(...pathMidiList);
  const maxMidi = Math.max(...pathMidiList);
  const boardMidis = new Set(buildFretboard(MAX_FRET, strings).map((p) => p.midi));
  const diatonic = new Set<number>(MAJOR_INTERVALS);

  for (const interval of allowed) {
    if (diatonic.has(interval)) continue;
    const canonical = canonicalMidiForInterval(doMidi, interval);
    if (canonical >= minMidi && canonical <= maxMidi && boardMidis.has(canonical)) {
      midis.add(canonical);
    }
  }

  return [...midis].sort((a, b) => a - b);
}

export function collectMidiPool(
  doMidi: number,
  difficulty: EarTrainingDifficulty,
  enabledSolfege?: string[],
  doStringNo?: number,
  doFret?: number,
): number[] {
  const strings = resolvePoolStrings(difficulty, doStringNo);
  const allowed = new Set(allowedIntervalsForDifficulty(difficulty));

  const pool =
    doStringNo !== undefined && doFret !== undefined
      ? collectScalePathMidis(doStringNo, doFret, doMidi, difficulty, strings, allowed)
      : collectLegacyBoardMidis(doMidi, strings, allowed, difficulty);

  return filterMidiPoolBySolfege(pool, doMidi, enabledSolfege ?? []);
}
export function usesChromaticAnswers(difficulty: EarTrainingDifficulty): boolean {
  return difficulty !== "beginner";
}
