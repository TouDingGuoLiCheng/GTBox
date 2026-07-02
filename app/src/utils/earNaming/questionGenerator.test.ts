import { describe, expect, it } from "vitest";
import {
  generateQuestion,
  getCorrectPoints,
  intervalSemitones,
  isPitchClassMatch,
  pointKey,
} from "./questionGenerator";

describe("questionGenerator", () => {
  it("interval semitones mapping", () => {
    expect(intervalSemitones("whole-up")).toBe(2);
    expect(intervalSemitones("whole-down")).toBe(-2);
    expect(intervalSemitones("half-up")).toBe(1);
    expect(intervalSemitones("half-down")).toBe(-1);
  });

  it("pitch class match ignores octave", () => {
    expect(isPitchClassMatch(64, 52)).toBe(true);
    expect(isPitchClassMatch(64, 53)).toBe(false);
  });

  it("degree question targets valid board points", () => {
    const prompt = generateQuestion({
      mode: "degree-locate",
      doMidi: 48,
      maxFret: 22,
      enabledStrings: [1, 2, 3, 4, 5, 6],
      questionIndex: 1,
      totalQuestions: 10,
    });
    const correct = getCorrectPoints(prompt, 22, [1, 2, 3, 4, 5, 6]);
    expect(correct.length).toBeGreaterThan(0);
    expect(prompt.targetDegree).toBeGreaterThanOrEqual(1);
    expect(prompt.targetDegree).toBeLessThanOrEqual(7);
  });

  it("solfege question avoids recent anchors when possible", () => {
    const recent = [{ stringNo: 6, fret: 8, midi: 48, noteName: "C3" }];
    const keys = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const prompt = generateQuestion({
        mode: "solfege-locate",
        doMidi: 48,
        maxFret: 22,
        enabledStrings: [6],
        questionIndex: i + 1,
        totalQuestions: 20,
        recentAnchors: recent,
      });
      keys.add(pointKey(prompt.anchorPoint!));
    }
    expect(keys.has("6-8")).toBe(false);
  });

  it("interval question target exists on board", () => {
    const prompt = generateQuestion({
      mode: "interval-locate",
      doMidi: 48,
      maxFret: 22,
      enabledStrings: [1, 2, 3, 4, 5, 6],
      questionIndex: 1,
      totalQuestions: 10,
    });
    const correct = getCorrectPoints(prompt, 22, [1, 2, 3, 4, 5, 6]);
    expect(correct.length).toBeGreaterThan(0);
    expect(prompt.referencePoint).toBeDefined();
    expect(prompt.intervalKind).toBeDefined();
  });

  it("dictation question generates 3-5 distinct notes", () => {
    const prompt = generateQuestion({
      mode: "naming-dictation",
      doMidi: 48,
      maxFret: 22,
      enabledStrings: [1, 2, 3, 4, 5, 6],
      questionIndex: 1,
      totalQuestions: 5,
      dictationNoteCount: 4,
    });
    expect(prompt.dictationNotes?.length).toBe(4);
    const keys = new Set(prompt.dictationNotes?.map((p) => pointKey(p)));
    expect(keys.size).toBe(4);
  });
});
