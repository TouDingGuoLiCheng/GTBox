import { computed, ref } from "vue";
import type { RuleGraph } from "../types/ruleGraph";
import { cloneRuleGraph } from "../utils/ruleGraph/flowAdapter";

const DEFAULT_MAX = 50;

export function useRuleGraphHistory(maxSize = DEFAULT_MAX) {
  const undoStack = ref<RuleGraph[]>([]);
  const redoStack = ref<RuleGraph[]>([]);
  let applying = false;

  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);

  function pushState(graph: RuleGraph) {
    if (applying) return;
    undoStack.value.push(cloneRuleGraph(graph));
    if (undoStack.value.length > maxSize) undoStack.value.shift();
    redoStack.value = [];
  }

  function undo(current: RuleGraph): RuleGraph | null {
    if (undoStack.value.length === 0) return null;
    applying = true;
    try {
      redoStack.value.push(cloneRuleGraph(current));
      return undoStack.value.pop() ?? null;
    } finally {
      applying = false;
    }
  }

  function redo(current: RuleGraph): RuleGraph | null {
    if (redoStack.value.length === 0) return null;
    applying = true;
    try {
      undoStack.value.push(cloneRuleGraph(current));
      return redoStack.value.pop() ?? null;
    } finally {
      applying = false;
    }
  }

  function isApplying() {
    return applying;
  }

  function clear() {
    undoStack.value = [];
    redoStack.value = [];
  }

  return {
    canUndo,
    canRedo,
    pushState,
    undo,
    redo,
    isApplying,
    clear,
  };
}
