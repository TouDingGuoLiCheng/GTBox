import {
  ALL_EAR_TRAINING_SOLFEGE,
  DEFAULT_ENABLED_EAR_TRAINING_SOLFEGE,
  type EarTrainingSolfegeName,
} from "../../types/earNaming";
import { intervalFromMidi, pickedSolfegeToInterval } from "./solfegeMatch";

export function normalizeEnabledSolfege(raw: string[] | undefined): EarTrainingSolfegeName[] {
  if (!raw?.length) return [...DEFAULT_ENABLED_EAR_TRAINING_SOLFEGE];
  const allowed = new Set<string>(ALL_EAR_TRAINING_SOLFEGE);
  const picked = raw.filter((name): name is EarTrainingSolfegeName => allowed.has(name));
  return picked.length > 0 ? picked : [...DEFAULT_ENABLED_EAR_TRAINING_SOLFEGE];
}

export function toggleEnabledSolfegeList(
  current: EarTrainingSolfegeName[],
  name: EarTrainingSolfegeName,
  checked: boolean,
): EarTrainingSolfegeName[] {
  const set = new Set(current);
  if (checked) {
    set.add(name);
  } else if (set.size > 1) {
    set.delete(name);
  }
  return ALL_EAR_TRAINING_SOLFEGE.filter((item) => set.has(item));
}

/** 在答题板上优先使用的唱名标签（Si / Ti 等同属 11 半音） */
export function preferredSolfegeLabel(
  targetSolfege: string,
  enabledSolfege: string[],
): string {
  const interval = pickedSolfegeToInterval(targetSolfege);
  if (interval === null) return targetSolfege;
  const match = enabledSolfege.find((name) => pickedSolfegeToInterval(name) === interval);
  return match ?? targetSolfege;
}

/** 目标音是否落在已选唱名对应的音级上（Si / Ti 等同属 11 半音） */
export function midiMatchesEnabledSolfege(
  midi: number,
  doMidi: number,
  enabledSolfege: string[],
): boolean {
  const interval = intervalFromMidi(midi, doMidi);
  return enabledSolfege.some((name) => pickedSolfegeToInterval(name) === interval);
}

export function filterMidiPoolBySolfege(
  pool: number[],
  doMidi: number,
  enabledSolfege: string[],
): number[] {
  if (!enabledSolfege.length) return pool;
  return pool.filter((midi) => midiMatchesEnabledSolfege(midi, doMidi, enabledSolfege));
}
