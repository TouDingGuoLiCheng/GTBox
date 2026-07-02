import type { Stone } from "../../types/gomoku";

export interface TimerState {
  blackMove: number;
  whiteMove: number;
  blackTotal: number;
  whiteTotal: number;
}

export function createTimerState(perMoveSec: number, totalSec: number): TimerState {
  return {
    blackMove: perMoveSec,
    whiteMove: perMoveSec,
    blackTotal: totalSec,
    whiteTotal: totalSec,
  };
}

export function resetMoveTimers(state: TimerState, perMoveSec: number): TimerState {
  return {
    ...state,
    blackMove: perMoveSec,
    whiteMove: perMoveSec,
  };
}

/** 当前方落子后重置其步时 */
export function afterMove(state: TimerState, stone: Stone, perMoveSec: number): TimerState {
  if (stone === 1) return { ...state, blackMove: perMoveSec };
  if (stone === 2) return { ...state, whiteMove: perMoveSec };
  return state;
}

export function tickTimer(state: TimerState, activeStone: Stone): TimerState {
  if (activeStone === 1) {
    return {
      ...state,
      blackMove: state.blackMove - 1,
      blackTotal: state.blackTotal - 1,
    };
  }
  if (activeStone === 2) {
    return {
      ...state,
      whiteMove: state.whiteMove - 1,
      whiteTotal: state.whiteTotal - 1,
    };
  }
  return state;
}

export function isTimedOut(state: TimerState, activeStone: Stone): boolean {
  if (activeStone === 1) return state.blackMove <= 0 || state.blackTotal <= 0;
  if (activeStone === 2) return state.whiteMove <= 0 || state.whiteTotal <= 0;
  return false;
}

export function timeoutWinner(activeStone: Stone): Stone {
  return activeStone === 1 ? 2 : 1;
}
