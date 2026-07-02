export interface FretPoint {
  stringNo: number;
  fret: number;
  midi: number;
  noteName: string;
}

const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const SOLFEGE_NAMES = ["Do", "Di", "Re", "Ri", "Mi", "Fa", "Fi", "Sol", "Si", "La", "Li", "Ti"] as const;
const DEGREE_NAMES = ["1", "#1/b2", "2", "#2/b3", "3", "4", "#4/b5", "5", "#5/b6", "6", "#6/b7", "7"] as const;

const STANDARD_TUNING_OPEN_MIDI: Record<number, number> = {
  6: 40, // E2
  5: 45, // A2
  4: 50, // D3
  3: 55, // G3
  2: 59, // B3
  1: 64, // E4
};

export function midiToNoteName(midi: number): string {
  const pitchClass = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES_SHARP[pitchClass]}${octave}`;
}

export function getFretMidi(stringNo: number, fret: number): number {
  const openMidi = STANDARD_TUNING_OPEN_MIDI[stringNo];
  if (openMidi === undefined) {
    throw new Error(`invalid string number: ${stringNo}`);
  }
  return openMidi + fret;
}

export function getFretPoint(stringNo: number, fret: number): FretPoint {
  const midi = getFretMidi(stringNo, fret);
  return {
    stringNo,
    fret,
    midi,
    noteName: midiToNoteName(midi),
  };
}

export function buildFretboard(maxFret = 22, strings: number[] = [6, 5, 4, 3, 2, 1]): FretPoint[] {
  const result: FretPoint[] = [];
  for (const stringNo of strings) {
    for (let fret = 0; fret <= maxFret; fret += 1) {
      result.push(getFretPoint(stringNo, fret));
    }
  }
  return result;
}

export function toSolfegeName(midi: number, doMidi: number): string {
  const interval = ((midi - doMidi) % 12 + 12) % 12;
  return SOLFEGE_NAMES[interval];
}

export function toDegreeName(midi: number, doMidi: number): string {
  const interval = ((midi - doMidi) % 12 + 12) % 12;
  return DEGREE_NAMES[interval];
}

const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11] as const;

export interface ScaleDegreeDisplay {
  text: string;
  dot: "above" | "below" | "none";
  diatonic: boolean;
}

export function toScaleDegreeDisplay(midi: number, doMidi: number): ScaleDegreeDisplay {
  const semitones = midi - doMidi;
  const octave = Math.floor(semitones / 12);
  const interval = ((semitones % 12) + 12) % 12;
  const majorIndex = MAJOR_INTERVALS.indexOf(interval as (typeof MAJOR_INTERVALS)[number]);

  if (majorIndex >= 0) {
    return {
      text: String(majorIndex + 1),
      dot: octave > 0 ? "above" : octave < 0 ? "below" : "none",
      diatonic: true,
    };
  }

  const sharpLabels = ["♯1", "♯2", "♯2", "♯4", "♯4", "♯5", "♯5", "♯6", "♯6", "♯7", "♯7"];
  return {
    text: sharpLabels[interval] ?? "?",
    dot: octave > 0 ? "above" : octave < 0 ? "below" : "none",
    diatonic: false,
  };
}

export function findSamePitchClass(points: FretPoint[], midi: number): FretPoint[] {
  const pitchClass = ((midi % 12) + 12) % 12;
  return points.filter((point) => ((point.midi % 12) + 12) % 12 === pitchClass);
}

export function findSameMidiPositions(
  midi: number,
  options: {
    maxFret?: number;
    enabledStrings?: number[];
    exclude?: { stringNo: number; fret: number };
  } = {},
): FretPoint[] {
  const maxFret = options.maxFret ?? 22;
  const enabledStrings = options.enabledStrings ?? [6, 5, 4, 3, 2, 1];
  const board = buildFretboard(maxFret, enabledStrings);
  return board.filter((point) => {
    if (point.midi !== midi) return false;
    const exclude = options.exclude;
    if (exclude && point.stringNo === exclude.stringNo && point.fret === exclude.fret) return false;
    return true;
  });
}

export function findSamePitchClassPositions(
  midi: number,
  options: {
    maxFret?: number;
    enabledStrings?: number[];
    exclude?: { stringNo: number; fret: number };
  } = {},
): FretPoint[] {
  const maxFret = options.maxFret ?? 22;
  const enabledStrings = options.enabledStrings ?? [6, 5, 4, 3, 2, 1];
  const board = buildFretboard(maxFret, enabledStrings);
  return findSamePitchClass(board, midi).filter((point) => {
    const exclude = options.exclude;
    if (exclude && point.stringNo === exclude.stringNo && point.fret === exclude.fret) return false;
    return true;
  });
}

export function pickRandomSamePitchClassPosition(
  stringNo: number,
  fret: number,
  maxFret = 22,
  enabledStrings: number[] = [6, 5, 4, 3, 2, 1],
): FretPoint | null {
  const midi = getFretMidi(stringNo, fret);
  const alternatives = findSamePitchClassPositions(midi, {
    maxFret,
    enabledStrings,
    exclude: { stringNo, fret },
  });
  if (!alternatives.length) return null;
  return alternatives[Math.floor(Math.random() * alternatives.length)];
}

const MAJOR_SCALE_STEPS = [2, 2, 1, 2, 2, 2, 1] as const;

export interface ScalePathEntry {
  degree: number;
  solfege: string;
}

function pointKeyFromParts(stringNo: number, fret: number): string {
  return `${stringNo}-${fret}`;
}

/** 从锚点沿大调音阶向高音弦（弦号减小）推导 1–7 级，每级只保留一个弦品 */
function pickPreferredNextPoint(current: FretPoint, candidates: FretPoint[]): FretPoint {
  return [...candidates].sort((a, b) => {
    const score = (point: FretPoint) => {
      const fretDistance = Math.abs(point.fret - current.fret);
      const backwardPenalty = point.fret < current.fret ? 250 : 0;
      return point.stringNo * 1000 + fretDistance + backwardPenalty;
    };
    return score(a) - score(b);
  })[0];
}

/** 听力训练：优先同弦上行，必要时再换到高音弦，避免高把位 Do 时音级落到低品 */
export function pickEarTrainingScalePoint(current: FretPoint, candidates: FretPoint[]): FretPoint {
  const sameStringForward = candidates.filter(
    (p) => p.stringNo === current.stringNo && p.fret >= current.fret,
  );
  if (sameStringForward.length) {
    return sameStringForward.reduce((best, p) => (p.fret < best.fret ? p : best));
  }

  const higherStrings = candidates.filter((p) => p.stringNo < current.stringNo);
  if (higherStrings.length) {
    return [...higherStrings].sort((a, b) => {
      const backtrackA = Math.max(0, current.fret - a.fret);
      const backtrackB = Math.max(0, current.fret - b.fret);
      if (backtrackA !== backtrackB) return backtrackA - backtrackB;
      if (a.stringNo !== b.stringNo) return a.stringNo - b.stringNo;
      return a.fret - b.fret;
    })[0]!;
  }

  return [...candidates].sort((a, b) => {
    const score = (p: FretPoint) =>
      Math.abs(p.stringNo - current.stringNo) * 100 + Math.abs(p.fret - current.fret);
    return score(a) - score(b);
  })[0]!;
}

function deriveScalePath(
  anchorString: number,
  anchorFret: number,
  maxFret: number,
  enabledStrings: number[],
  pickNext: (current: FretPoint, candidates: FretPoint[]) => FretPoint,
): Map<string, ScalePathEntry> {
  const board = buildFretboard(maxFret, enabledStrings);
  const byMidi = new Map<number, FretPoint[]>();
  for (const point of board) {
    const list = byMidi.get(point.midi);
    if (list) list.push(point);
    else byMidi.set(point.midi, [point]);
  }

  let current = getFretPoint(anchorString, anchorFret);
  const path = new Map<string, ScalePathEntry>();
  path.set(pointKeyFromParts(current.stringNo, current.fret), {
    degree: 1,
    solfege: "Do",
  });

  for (let step = 0; step < MAJOR_SCALE_STEPS.length - 1; step += 1) {
    const targetMidi = current.midi + MAJOR_SCALE_STEPS[step];
    const candidates = byMidi.get(targetMidi);
    if (!candidates?.length) break;

    current = pickNext(current, candidates);
    const degree = step + 2;
    const interval = MAJOR_INTERVALS[degree - 1];
    path.set(pointKeyFromParts(current.stringNo, current.fret), {
      degree,
      solfege: SOLFEGE_NAMES[interval],
    });
  }

  return path;
}

export function deriveMajorScalePath(
  anchorString: number,
  anchorFret: number,
  maxFret = 22,
  enabledStrings: number[] = [6, 5, 4, 3, 2, 1],
): Map<string, ScalePathEntry> {
  return deriveScalePath(anchorString, anchorFret, maxFret, enabledStrings, pickPreferredNextPoint);
}

export function deriveEarTrainingScalePath(
  anchorString: number,
  anchorFret: number,
  maxFret = 22,
  enabledStrings: number[] = [6, 5, 4, 3, 2, 1],
): Map<string, ScalePathEntry> {
  return deriveScalePath(anchorString, anchorFret, maxFret, enabledStrings, pickEarTrainingScalePoint);
}
