import { describe, expect, it } from "vitest";
import { collectMidiPool } from "./earTrainingDifficulty";
import { generateEarTrainingQuestion } from "./earTrainingGenerator";
import {
  filterMidiPoolBySolfege,
  midiMatchesEnabledSolfege,
  normalizeEnabledSolfege,
  toggleEnabledSolfegeList,
} from "./earTrainingSolfege";
import { targetSolfegeForMidi } from "./solfegeMatch";
import { getFretMidi } from "./fretboard";

const DO_MIDI = getFretMidi(6, 8);

describe("earTrainingSolfege", () => {
  it("filters pool to selected solfege only", () => {
    const full = collectMidiPool(DO_MIDI, "beginner");
    const onlyMi = filterMidiPoolBySolfege(full, DO_MIDI, ["Mi"]);
    expect(onlyMi.length).toBeGreaterThan(0);
    for (const midi of onlyMi) {
      expect(targetSolfegeForMidi(midi, DO_MIDI)).toBe("Mi");
    }
  });

  it("treats Si and Ti as the same pitch class for filtering", () => {
    const full = collectMidiPool(DO_MIDI, "advanced");
    const siMidi = full.find((midi) => targetSolfegeForMidi(midi, DO_MIDI) === "Si");
    expect(siMidi).toBeDefined();
    expect(midiMatchesEnabledSolfege(siMidi!, DO_MIDI, ["Ti"])).toBe(true);
  });

  it("keeps at least one solfege when toggling off", () => {
    const next = toggleEnabledSolfegeList(["Do", "Re"], "Do", false);
    expect(next).toEqual(["Re"]);
    const unchanged = toggleEnabledSolfegeList(["Do"], "Do", false);
    expect(unchanged).toEqual(["Do"]);
  });

  it("normalizes invalid saved lists", () => {
    expect(normalizeEnabledSolfege([])).toEqual([
      "Do", "Re", "Mi", "Fa", "Sol", "La", "Si",
    ]);
    expect(normalizeEnabledSolfege(["Do", "bogus"])).toEqual(["Do"]);
  });
});

describe("generateEarTrainingQuestion with enabled solfege", () => {
  it("only generates selected solfege for 20 questions", () => {
    const enabled = ["Do", "Re", "Mi"];
    const recent: string[] = [];
    for (let i = 1; i <= 20; i += 1) {
      const prompt = generateEarTrainingQuestion({
        doMidi: DO_MIDI,
        difficulty: "beginner",
        useDoReference: true,
        questionIndex: i,
        totalQuestions: 20,
        recentSolfege: recent,
        enabledSolfege: enabled,
      });
      expect(enabled).toContain(prompt.targetSolfege);
      recent.push(prompt.targetSolfege);
    }
  });
});
