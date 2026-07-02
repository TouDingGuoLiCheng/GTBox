/** 规则图：自由节点组合式匹配（替代手写正则） */

export type PortKind = "scope" | "bool" | "predicate" | "segment";

export type ScopeMode = "full" | "line" | "non_empty_line";

export type CountMode = "all" | "at_least" | "at_most" | "exactly" | "global";
export type NodeBuilderMode = "line" | "segment";

/** 段链量词模式（非空、空格占位等） */
export type SegmentQuantifierMode = "at_least" | "at_most" | "exactly";

export type StartsWithPreset = "text" | "digit" | "letter";

export type NodeType =
  | "root"
  | "scope"
  | "and"
  | "or"
  | "not"
  | "group"
  | "count"
  | "non_empty"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "matches_text"
  | "split_parts"
  | "length"
  | "charset"
  | "regex"
  | "sequence"
  | "space"
  | "char_run"
  | "char_class_seg"
  | "optional_seg"
  | "position_char"
  | "split_pattern";

export interface RuleGraph {
  version: 1;
  nodes: RuleNode[];
  edges: RuleEdge[];
}

export interface RuleNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  params: RuleNodeParams;
}

export interface RuleEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

export interface ScopeParams {
  mode: ScopeMode;
}

export interface CountParams {
  mode: CountMode;
  n: number;
  builderMode?: NodeBuilderMode;
}

export interface SpaceParams {
  mode: SegmentQuantifierMode;
  n: number;
}

export interface TextParams {
  text: string;
  ignoreCase?: boolean;
  builderMode?: NodeBuilderMode;
}

export interface StartsWithParams {
  preset: StartsWithPreset;
  text: string;
  ignoreCase?: boolean;
}

export interface SplitPartsParams {
  separator: string;
  parts: number;
}

export interface LengthParams {
  min: number;
  max: number;
}

export interface CharsetParams {
  allowChinese: boolean;
  allowLatin: boolean;
  allowDigits: boolean;
  allowPunctuation: boolean;
}

export interface RegexParams {
  pattern: string;
  ignoreCase?: boolean;
}

export interface GroupParams {
  label?: string;
  collapsed?: boolean;
}

export interface DualModeParams {
  builderMode?: NodeBuilderMode;
}

export type CharRunKind = "digit" | "letter" | "word" | "any";

export interface CharRunParams {
  kind: CharRunKind;
  n: number;
}

export type CharClassPreset = "digit" | "letter" | "alnum" | "custom";
export type CharClassQuantifier = "one" | "one_or_more";

export interface CharClassSegParams {
  preset: CharClassPreset;
  customClass: string;
  quantifier: CharClassQuantifier;
}

export type PositionCharMode = "literal" | "range";

export interface PositionCharParams {
  mode: PositionCharMode;
  literal: string;
  rangeFrom: string;
  rangeTo: string;
}

export interface SplitPatternParams {
  separator: string;
  parts: number;
}

export type RuleNodeParams =
  | ScopeParams
  | CountParams
  | SpaceParams
  | TextParams
  | StartsWithParams
  | SplitPartsParams
  | SplitPatternParams
  | LengthParams
  | CharsetParams
  | RegexParams
  | GroupParams
  | DualModeParams
  | CharRunParams
  | CharClassSegParams
  | PositionCharParams
  | Record<string, never>;

export type ValidationSeverity = "error" | "warning";

export interface GraphValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface PredicateFailure {
  lineNumber?: number;
  text: string;
  reason: string;
}

export interface PredicateResult {
  pass: boolean;
  failures: PredicateFailure[];
}

export interface EvalContext {
  text: string;
  lines: string[];
}

export interface GraphEvalResult {
  pass: boolean;
  failures: PredicateFailure[];
  evaluatedCount?: number;
  matchedCount?: number;
}

export class RuleGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleGraphError";
  }
}
