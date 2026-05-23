import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { ToolCategory } from "../types/tool";
import type { ToolItem } from "../types/tool";
import { invoke } from "@tauri-apps/api/core";

const builtInTools: ToolItem[] = [
  {
    id: "music_crawl",
    name: "一键爬取音乐",
    description: "截图识歌单 -> 校对 OCR -> 一键下载",
    category: "音乐",
    icon: "mdi:music-circle-outline",
    tags: ["主推", "OCR"],
    customRoute: "/tools/music-crawl",
  },
];

export const useToolsStore = defineStore("tools", () => {
  const tools = ref<ToolItem[]>([]);
  const activeCategory = ref<ToolCategory>("全部");
  const selectedToolId = ref<string | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const categories = computed<ToolCategory[]>(() => {
    const unique = new Set<string>(tools.value.map((tool) => tool.category));
    return ["全部", ...Array.from(unique)];
  });

  const filteredTools = computed(() => {
    if (activeCategory.value === "全部") return tools.value;
    return tools.value.filter((t) => t.category === activeCategory.value);
  });

  function setCategory(category: ToolCategory) {
    activeCategory.value = category;
  }

  function selectTool(id: string | null) {
    selectedToolId.value = id;
  }

  function getToolById(id: string) {
    return tools.value.find((t) => t.id === id);
  }

  async function loadTools() {
    loading.value = true;
    error.value = null;
    try {
      const plugins = await invoke<ToolItem[]>("list_plugins");
      const merged = [...builtInTools, ...plugins];
      const deduped = merged.filter((tool, index) => merged.findIndex((x) => x.id === tool.id) === index);
      tools.value = deduped;
      if (!categories.value.includes(activeCategory.value)) {
        activeCategory.value = "全部";
      }
    } catch (err) {
      tools.value = builtInTools;
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      loading.value = false;
    }
  }

  return {
    tools,
    activeCategory,
    selectedToolId,
    categories,
    filteredTools,
    loading,
    error,
    setCategory,
    selectTool,
    getToolById,
    loadTools,
  };
});
