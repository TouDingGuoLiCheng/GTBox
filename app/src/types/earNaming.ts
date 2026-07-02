import type { FretPoint } from "../utils/earNaming/fretboard";

/** 工具内页面相位（首页卡片 → 各模块） */
export type EarNamingPhase =
  | "menu"
  | "explore"
  | "ear-training"
  | "ear-exam"
  | "fretboard-memory"
  | "settings";

/** 记忆指板模块内子视图 */
export type FretboardSubview = "mode-menu" | "training";

export type TrainingMode = "degree-locate" | "solfege-locate" | "interval-locate" | "naming-dictation";

export type IntervalKind = "whole-up" | "whole-down" | "half-up" | "half-down";

export interface TrainingPrompt {
  mode: TrainingMode;
  questionIndex: number;
  totalQuestions: number;
  doMidi: number;
  /** 级数定位：目标级数 1–7 */
  targetDegree?: number;
  /** 唱名定位：目标唱名 */
  targetSolfege?: string;
  /** 音程模式：参照点 */
  referencePoint?: FretPoint;
  /** 音程模式：音程类型 */
  intervalKind?: IntervalKind;
  /** 正确答案 midi（任意八度等价） */
  targetMidi: number;
  /** 唱名模式：首选出题点（用于防重复） */
  anchorPoint?: FretPoint;
  /** 扒音模式：片段音列 */
  dictationNotes?: FretPoint[];
}

export interface DictationNoteLog {
  noteIndex: number;
  targetMidi: number;
  picked: FretPoint;
  solfege: string;
  degreeLabel: string;
  correct: boolean;
  responseMs: number;
  attempts: number;
}

export interface AnswerEvent {
  mode: TrainingMode;
  questionIndex: number;
  targetMidi: number;
  targetDegreeLabel?: string;
  picked: FretPoint;
  correct: boolean;
  responseMs: number;
  timestamp: number;
  promptSummary: string;
  dictationDetails?: DictationNoteLog[];
  /** 出题快照，用于当轮错题重听/重做 */
  promptSnapshot?: TrainingPrompt;
}

export interface SessionStats {
  total: number;
  correct: number;
  accuracy: number;
  avgResponseMs: number;
  byMode: Record<TrainingMode, { total: number; correct: number }>;
  byString: Record<number, { total: number; correct: number }>;
  byDegree: Record<string, { total: number; correct: number }>;
  weaknessHints: string[];
}

export const TRAINING_MODE_LABELS: Record<TrainingMode, string> = {
  "degree-locate": "参照音 + 级数定位",
  "solfege-locate": "唱名 → 指板",
  "interval-locate": "两音音程",
  "naming-dictation": "命名扒音",
};

export const INTERVAL_LABELS: Record<IntervalKind, string> = {
  "whole-up": "上行全音",
  "whole-down": "下行全音",
  "half-up": "上行半音",
  "half-down": "下行半音",
};

export const DEFAULT_QUESTIONS_PER_ROUND = 10;
export const DEFAULT_DICTATION_NOTE_COUNT = 3;

/** 听力训练难度档位 */
export type EarTrainingDifficulty = "beginner" | "intermediate" | "advanced";

export type EarTrainingPhase =
  | "idle"
  | "prompt"
  | "feedback"
  | "round-complete"
  | "review-prompt"
  | "review-feedback";

/** 当轮错题重做结果（不计入原轮统计） */
export interface ReviewRedoResult {
  questionIndex: number;
  correct: boolean;
  summary: string;
}

export interface EarTrainingPrompt {
  questionIndex: number;
  totalQuestions: number;
  targetMidi: number;
  targetSolfege: string;
  targetNoteName: string;
  useDoReference: boolean;
  doMidi: number;
  difficulty: EarTrainingDifficulty;
}

export interface EarTrainingAnswerEvent {
  questionIndex: number;
  targetMidi: number;
  targetSolfege: string;
  targetNoteName: string;
  pickedSolfege: string;
  correct: boolean;
  responseMs: number;
  timestamp: number;
}

export interface EarTrainingRoundStats {
  total: number;
  correct: number;
  accuracy: number;
  avgResponseMs: number;
  bySolfege: Record<string, { total: number; correct: number }>;
  weaknessHints: string[];
}

export const EAR_TRAINING_DIFFICULTY_LABELS: Record<EarTrainingDifficulty, string> = {
  beginner: "入门",
  intermediate: "进阶",
  advanced: "熟练",
};

export const DIATONIC_SOLFEGE_BUTTONS = ["Do", "Re", "Mi", "Fa", "Sol", "La", "Si"] as const;

/** 进阶/熟练额外唱名按钮（自然音 7 钮之外的升降号唱名） */
export const CHROMATIC_SOLFEGE_BUTTONS = ["Di", "Ri", "Fi", "Li", "Ti"] as const;

/** 听力训练可选的全部唱名（自然音 + 变化音） */
export const ALL_EAR_TRAINING_SOLFEGE = [
  ...DIATONIC_SOLFEGE_BUTTONS,
  ...CHROMATIC_SOLFEGE_BUTTONS,
] as const;

export type EarTrainingSolfegeName = (typeof ALL_EAR_TRAINING_SOLFEGE)[number];

/** 默认出题/作答：7 个自然音 */
export const DEFAULT_ENABLED_EAR_TRAINING_SOLFEGE: EarTrainingSolfegeName[] = [
  ...DIATONIC_SOLFEGE_BUTTONS,
];

export const DEFAULT_EAR_TRAINING_QUESTIONS = 10;

/** 听力考试子流程 */
export type EarExamPhase = "level-select" | "briefing" | "in-progress" | "submitted" | "report" | "history";

export const EAR_EXAM_TOTAL_QUESTIONS = 20;
export const EAR_EXAM_PASS_COUNT = 18;

export const EAR_EXAM_TIME_LIMIT_SEC: Record<EarTrainingDifficulty, number | null> = {
  beginner: null,
  intermediate: 20,
  advanced: 15,
};

export const EAR_EXAM_DO_STRATEGY_LABELS: Record<EarTrainingDifficulty, string> = {
  beginner: "整场固定 1 个参照 Do",
  intermediate: "第 11 题起更换参照 Do",
  advanced: "约每 4 题更换参照 Do",
};

export type EarExamInProgressSubPhase = "playing-cue" | "answering";

export interface EarExamDoSegment {
  startQuestion: number;
  endQuestion: number;
  doMidi: number;
  doStringNo: number;
  doFret: number;
}

export interface EarExamPlan {
  difficulty: EarTrainingDifficulty;
  totalQuestions: number;
  doSegments: EarExamDoSegment[];
  enabledSolfege: EarTrainingSolfegeName[];
}

export interface EarExamAnswerEvent {
  questionIndex: number;
  targetMidi: number;
  targetSolfege: string;
  targetNoteName: string;
  pickedSolfege: string | null;
  correct: boolean;
  responseMs: number;
  timedOut: boolean;
  doMidi: number;
  promptSnapshot: EarTrainingPrompt;
}

export type EarExamReviewPhase = "idle" | "redo-prompt" | "redo-feedback";

export interface EarExamReviewRedoResult {
  questionIndex: number;
  correct: boolean;
}

export interface EarExamSolfegeStat {
  total: number;
  correct: number;
}

export interface EarExamRecord {
  id: string;
  timestamp: number;
  difficulty: EarTrainingDifficulty;
  correct: number;
  total: number;
  accuracy: number;
  passed: boolean;
  avgResponseMs: number;
  durationMs: number;
  bySolfege: Record<string, EarExamSolfegeStat>;
}

export const EAR_EXAM_HISTORY_KEY = "earNaming.earExam.history";
export const EAR_EXAM_HISTORY_MAX = 200;
