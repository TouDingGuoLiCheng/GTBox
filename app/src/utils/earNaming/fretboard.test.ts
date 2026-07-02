import { describe, expect, it } from "vitest";
import {
  deriveEarTrainingScalePath,
  deriveMajorScalePath,
  findSameMidiPositions,
  findSamePitchClassPositions,
  getFretMidi,
  getFretPoint,
  pickRandomSamePitchClassPosition,
} from "./fretboard";

describe("findSamePitchClassPositions", () => {
  it("includes same note name in other octaves", () => {
    const c3Midi = getFretMidi(6, 8);
    const c4Midi = getFretMidi(2, 1);
    expect(c3Midi % 12).toBe(c4Midi % 12);

    const alternatives = findSamePitchClassPositions(c4Midi, { exclude: { stringNo: 2, fret: 1 } });
    expect(alternatives.some((point) => point.midi === c3Midi)).toBe(true);
    expect(alternatives.some((point) => point.stringNo === 2 && point.fret === 1)).toBe(false);
  });

  it("pickRandomSamePitchClassPosition can cross octaves", () => {
    const picked = pickRandomSamePitchClassPosition(2, 1);
    expect(picked).not.toBeNull();
    expect(picked!.midi % 12).toBe(getFretMidi(2, 1) % 12);
    expect(picked!.stringNo !== 2 || picked!.fret !== 1).toBe(true);
  });
});
describe("findSameMidiPositions", () => {
  it("lists exact same pitch only", () => {
    const midi = getFretMidi(6, 8);
    const alternatives = findSameMidiPositions(midi, { exclude: { stringNo: 6, fret: 8 } });

    expect(alternatives.length).toBeGreaterThan(0);
    expect(alternatives.every((point) => point.midi === midi)).toBe(true);
  });
});
describe("deriveEarTrainingScalePath", () => {
  it("ascends on same string from 2-17 before jumping to higher strings", () => {
    const path = deriveEarTrainingScalePath(2, 17, 22, [1, 2, 3, 4, 5, 6]);

    expect(path.get("2-17")).toMatchObject({ solfege: "Do" });
    expect(path.get("2-19")).toMatchObject({ solfege: "Re" });
    expect(path.get("2-21")).toMatchObject({ solfege: "Mi" });
    expect(path.get("2-22")).toMatchObject({ solfege: "Fa" });
    expect(path.get("1-14")).toBeUndefined();
  });
});

describe("deriveMajorScalePath", () => {
  it("places Sol on 1-3 when Do anchor is 2-1 (C4), not open G on 3-0", () => {
    const path = deriveMajorScalePath(2, 1, 22, [1, 2, 3, 4, 5, 6]);

    expect(path.get("2-1")).toMatchObject({ degree: 1, solfege: "Do" });
    expect(path.get("1-3")).toMatchObject({ degree: 5, solfege: "Sol" });
    expect(path.has("3-0")).toBe(false);

    const solMidi = getFretMidi(1, 3);
    expect(solMidi).toBe(getFretMidi(2, 1) + 7);
  });

  it("walks toward lower string numbers (higher pitch strings) from 6-8", () => {
    const path = deriveMajorScalePath(6, 8, 22, [1, 2, 3, 4, 5, 6]);

    expect(path.get("6-8")).toMatchObject({ degree: 1 });
    expect(path.get("3-0")).toMatchObject({ degree: 5, solfege: "Sol" });

    const degrees = [...path.values()].map((entry) => entry.degree);
    expect(degrees).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("uses exact midi steps so same pitch class in another octave is not labeled", () => {
    const anchor = getFretPoint(2, 1);
    const path = deriveMajorScalePath(2, 1, 22, [1, 2, 3]);
    const solEntry = path.get("1-3");

    expect(solEntry?.degree).toBe(5);
    expect(getFretPoint(1, 3).midi - anchor.midi).toBe(7);
    expect(getFretPoint(3, 0).midi).toBeLessThan(anchor.midi);
  });
});
