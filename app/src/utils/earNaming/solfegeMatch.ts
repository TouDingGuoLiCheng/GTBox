import { toSolfegeName } from "./fretboard";

/** 唱名 → 相对 Do 的音程（半音） */
const SOLFEGE_INTERVAL: Record<string, number> = {
  Do: 0,
  Di: 1,
  Re: 2,
  Ri: 3,
  Mi: 4,
  Fa: 5,
  Fi: 6,
  Sol: 7,
  La: 9,
  Li: 10,
  Ti: 11,
};

/** 7 钮中的 Si 表示导音（7 级，音程 11） */
export function pickedSolfegeToInterval(picked: string): number | null {
  if (picked === "Si") return 11;
  return SOLFEGE_INTERVAL[picked] ?? null;
}

export function intervalFromMidi(midi: number, doMidi: number): number {
  const pitch = ((midi % 12) + 12) % 12;
  const doPitch = ((doMidi % 12) + 12) % 12;
  return (pitch - doPitch + 12) % 12;
}

export function targetSolfegeForMidi(midi: number, doMidi: number): string {
  const interval = intervalFromMidi(midi, doMidi);
  if (interval === 11) return "Si";
  return toSolfegeName(midi, doMidi);
}

export function solfegeAnswersMatch(picked: string, targetMidi: number, doMidi: number): boolean {
  const pickedInterval = pickedSolfegeToInterval(picked);
  if (pickedInterval === null) return false;
  return pickedInterval === intervalFromMidi(targetMidi, doMidi);
}
