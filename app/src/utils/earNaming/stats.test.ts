import { describe, expect, it } from "vitest";
import type { AnswerEvent } from "../../types/earNaming";
import { computeSessionStats, computeWeaknessHints } from "./stats";

function makeEvent(partial: Partial<AnswerEvent> & Pick<AnswerEvent, "mode" | "correct">): AnswerEvent {
  return {
    questionIndex: 1,
    targetMidi: 60,
    targetDegreeLabel: "3",
    picked: { stringNo: 3, fret: 2, midi: 60, noteName: "C4" },
    responseMs: 800,
    timestamp: Date.now(),
    promptSummary: "test",
    ...partial,
  };
}

describe("stats weakness hints", () => {
  it("detects low degree accuracy", () => {
    const events: AnswerEvent[] = [
      makeEvent({ mode: "degree-locate", correct: false, targetDegreeLabel: "5" }),
      makeEvent({ mode: "degree-locate", correct: false, targetDegreeLabel: "5", questionIndex: 2 }),
      makeEvent({ mode: "degree-locate", correct: true, targetDegreeLabel: "3", questionIndex: 3 }),
    ];
    const hints = computeWeaknessHints(events);
    expect(hints.some((h) => h.includes("5级"))).toBe(true);
  });

  it("includes byDegree in session stats", () => {
    const events: AnswerEvent[] = [
      makeEvent({ mode: "solfege-locate", correct: true, targetDegreeLabel: "1" }),
      makeEvent({ mode: "solfege-locate", correct: false, targetDegreeLabel: "6", questionIndex: 2 }),
    ];
    const stats = computeSessionStats(events);
    expect(stats.byDegree["1"]?.correct).toBe(1);
    expect(stats.byDegree["6"]?.total).toBe(1);
    expect(stats.weaknessHints.length).toBeGreaterThanOrEqual(0);
  });
});
