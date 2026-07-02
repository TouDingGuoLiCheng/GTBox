import { defineStore } from "pinia";
import { ref } from "vue";
import type { RuleGraph } from "../types/ruleGraph";
import { isRuleGraph, parseRuleGraphJson, serializeRuleGraph } from "../utils/ruleGraph/ruleGraphIo";
import { pushDebugLine } from "../utils/mediaDebug";

const STORAGE_KEY = "regex_builder_user_templates";

export interface UserRegexTemplate {
  id: string;
  name: string;
  createdAt: number;
  graph: RuleGraph;
}

function newId(): string {
  return `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadFromStorage(): UserRegexTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const row = item as Record<string, unknown>;
        if (typeof row.id !== "string" || typeof row.name !== "string") return null;
        let graph: RuleGraph;
        if (isRuleGraph(row.graph)) {
          graph = row.graph;
        } else if (typeof row.graphJson === "string") {
          graph = parseRuleGraphJson(row.graphJson);
        } else {
          return null;
        }
        return {
          id: row.id,
          name: row.name,
          createdAt: typeof row.createdAt === "number" ? row.createdAt : Date.now(),
          graph,
        } satisfies UserRegexTemplate;
      })
      .filter((x): x is UserRegexTemplate => x !== null);
  } catch {
    return [];
  }
}

function persist(items: UserRegexTemplate[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export const useRegexBuilderTemplatesStore = defineStore("regexBuilderTemplates", () => {
  const userTemplates = ref<UserRegexTemplate[]>(loadFromStorage());

  function reload() {
    userTemplates.value = loadFromStorage();
  }

  function saveTemplate(name: string, graph: RuleGraph): UserRegexTemplate | null {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const item: UserRegexTemplate = {
      id: newId(),
      name: trimmed,
      createdAt: Date.now(),
      graph: JSON.parse(serializeRuleGraph(graph)) as RuleGraph,
    };
    userTemplates.value = [item, ...userTemplates.value];
    persist(userTemplates.value);
    pushDebugLine("正则生成", "template-save", trimmed, { id: item.id });
    return item;
  }

  function removeTemplate(id: string) {
    const name = userTemplates.value.find((t) => t.id === id)?.name;
    userTemplates.value = userTemplates.value.filter((t) => t.id !== id);
    persist(userTemplates.value);
    pushDebugLine("正则生成", "template-delete", name ?? id, { id });
  }

  function renameTemplate(id: string, name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed) return false;
    const item = userTemplates.value.find((t) => t.id === id);
    if (!item) return false;
    item.name = trimmed;
    persist(userTemplates.value);
    pushDebugLine("正则生成", "template-rename", trimmed, { id });
    return true;
  }

  return {
    userTemplates,
    reload,
    saveTemplate,
    removeTemplate,
    renameTemplate,
  };
});
