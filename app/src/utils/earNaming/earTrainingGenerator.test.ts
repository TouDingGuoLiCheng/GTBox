import { describe, expect, it } from "vitest";
import { collectMidiPool, allowedIntervalsForDifficulty } from "./earTrainingDifficulty";
import { generateEarTrainingQuestion } from "./earTrainingGenerator";
import { targetSolfegeForMidi } from "./solfegeMatch";
import { getFretMidi } from "./fretboard";

const DO_MIDI = getFretMidi(6, 8); // C4

describe("earTrainingDifficulty", () => {
  it("beginner pool only contains diatonic intervals", () => {
    const pool = collectMidiPool(DO_MIDI, "beginner");
    expect(pool.length).toBeGreaterThan(0);
    for (const midi of pool) {
      const solfege = targetSolfegeForMidi(midi, DO_MIDI);
      expect(["Do", "Re", "Mi", "Fa", "Sol", "La", "Si"]).toContain(solfege);
    }
  });

  it("advanced pool is larger than beginner", () => {
    const beginner = collectMidiPool(DO_MIDI, "beginner");
    const advanced = collectMidiPool(DO_MIDI, "advanced");
    expect(advanced.length).toBeGreaterThan(beginner.length);
  });

  it("intermediate allows chromatic intervals", () => {
    const intervals = allowedIntervalsForDifficulty("intermediate");
    expect(intervals).toContain(1);
    expect(intervals).toContain(6);
  });

  it("beginner pool has one pitch per solfege (no octave duplicates)", () => {
    const pool = collectMidiPool(DO_MIDI, "beginner");
    const pitchClasses = pool.map((midi) => ((midi % 12) + 12) % 12);
    expect(new Set(pitchClasses).size).toBe(pitchClasses.length);
    for (const midi of pool) {
      expect(Math.abs(midi - DO_MIDI)).toBeLessThanOrEqual(12);
    }
  });

  it("prefers Sol above Do when anchor is 2-1 (C4), not low-octave G3", () => {
    const doMidi = getFretMidi(2, 1);
    const pool = collectMidiPool(doMidi, "beginner", undefined, 2, 1);
    const solMidi = pool.find((midi) => targetSolfegeForMidi(midi, doMidi) === "Sol");
    expect(solMidi).toBe(doMidi + 7);
  });

  it("prefers Sol at 2-20 when Do is 2-13, not low-octave 2-8", () => {
    const doMidi = getFretMidi(2, 13);
    for (const difficulty of ["intermediate", "advanced"] as const) {
      const pool = collectMidiPool(doMidi, difficulty, undefined, 2, 13);
      const solMidi = pool.find((midi) => targetSolfegeForMidi(midi, doMidi) === "Sol");
      expect(solMidi).toBe(getFretMidi(2, 20));
      expect(solMidi).toBe(doMidi + 7);
    }
  });

  it("keeps scale degrees on same-string ascent when Do is 2-17", () => {
    const doMidi = getFretMidi(2, 17);
    const pool = collectMidiPool(doMidi, "beginner", undefined, 2, 17);
    const reMidi = pool.find((midi) => targetSolfegeForMidi(midi, doMidi) === "Re");
    const miMidi = pool.find((midi) => targetSolfegeForMidi(midi, doMidi) === "Mi");
    const faMidi = pool.find((midi) => targetSolfegeForMidi(midi, doMidi) === "Fa");
    expect(reMidi).toBe(getFretMidi(2, 19));
    expect(miMidi).toBe(getFretMidi(2, 21));
    expect(faMidi).toBe(getFretMidi(2, 22));
  });

  it("advanced pool has one pitch class per solfege register", () => {
    const doMidi = getFretMidi(2, 13);
    const pool = collectMidiPool(doMidi, "advanced", undefined, 2, 13);
    const pitchClasses = pool.map((midi) => ((midi % 12) + 12) % 12);
    expect(new Set(pitchClasses).size).toBe(pitchClasses.length);
  });
});

describe("generateEarTrainingQuestion", () => {
  it("generates valid prompts for 20 beginner questions", () => {
    const recent: string[] = [];
    for (let i = 1; i <= 20; i += 1) {
      const prompt = generateEarTrainingQuestion({
        doMidi: DO_MIDI,
        difficulty: "beginner",
        useDoReference: true,
        questionIndex: i,
        totalQuestions: 20,
        recentSolfege: recent,
      });
      expect(prompt.targetSolfege).toBeTruthy();
      expect(prompt.targetNoteName).toMatch(/^[A-G]#?$/);
      const pool = collectMidiPool(DO_MIDI, "beginner");
      expect(pool).toContain(prompt.targetMidi);
      recent.push(prompt.targetSolfege);
    }
  });

  it("advanced avoids consecutive same solfege when possible", () => {
    let last = "";
    for (let i = 0; i < 15; i += 1) {
      const prompt = generateEarTrainingQuestion({
        doMidi: DO_MIDI,
        difficulty: "advanced",
        useDoReference: false,
        questionIndex: i + 1,
        totalQuestions: 15,
        recentSolfege: last ? [last] : [],
      });
      expect(prompt.targetSolfege).not.toBe(last);
      last = prompt.targetSolfege;
    }
  });

  it("keeps Sol in upward register when Do is 2-13", () => {
    const doMidi = getFretMidi(2, 13);
    for (let i = 0; i < 30; i += 1) {
      const prompt = generateEarTrainingQuestion({
        doMidi,
        doStringNo: 2,
        doFret: 13,
        difficulty: "advanced",
        useDoReference: true,
        questionIndex: 1,
        totalQuestions: 20,
      });
      if (prompt.targetSolfege === "Sol") {
        expect(prompt.targetMidi).toBe(getFretMidi(2, 20));
      }
    }
  });

  it("can still draw Sol when enabled among other solfege (Do 2-13 beginner)", () => {
    const doMidi = getFretMidi(2, 13);
    const enabled = ["Re", "Mi", "Fa", "Sol"];
    let solCount = 0;
    for (let i = 0; i < 80; i += 1) {
      const prompt = generateEarTrainingQuestion({
        doMidi,
        doStringNo: 2,
        doFret: 13,
        difficulty: "beginner",
        useDoReference: true,
        questionIndex: 1,
        totalQuestions: 20,
        enabledSolfege: enabled,
      });
      if (prompt.targetSolfege === "Sol") solCount += 1;
    }
    expect(solCount).toBeGreaterThan(0);
  });

  it("uses upward Sol on same string when Do is 2-13 beginner", () => {
    const doMidi = getFretMidi(2, 13);
    const pool = collectMidiPool(doMidi, "beginner", ["Sol"], 2, 13);
    const solMidi = pool.find((midi) => targetSolfegeForMidi(midi, doMidi) === "Sol");
    expect(solMidi).toBe(getFretMidi(2, 20));
  });
});
