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
  {
    id: "mc_mod_updater",
    name: "MineCraft模组更新器",
    description: "扫描本地 mods，检查并更新可用新版本",
    category: "游戏",
    icon: "mdi:cube-outline",
    tags: ["Minecraft", "mod"],
    customRoute: "/tools/mc-mod-updater",
  },
  {
    id: "translate",
    name: "翻译",
    description: "输入文本翻译，支持多引擎与历史记录",
    category: "工具",
    icon: "mdi:translate",
    tags: ["文本"],
    customRoute: "/tools/translate",
  },
  {
    id: "text_compare",
    name: "文本比对",
    description: "全文、按行、正则与文件夹比对，支持差异统计与导出",
    category: "工具",
    icon: "mdi:file-compare",
    tags: ["文本"],
    customRoute: "/tools/text-compare",
  },
  {
    id: "regex_builder",
    name: "正则表达式生成",
    description: "积木搭正则，实时预览规则说明，导出 Python re.compile",
    category: "工具",
    icon: "mdi:regex",
    tags: ["文本"],
    customRoute: "/tools/regex-builder",
  },
  {
    id: "gomoku",
    name: "五子棋",
    description: "人机、双人、机机观战，19 路棋盘，支持计时与续局",
    category: "娱乐/游戏",
    icon: "mdi:chess-pawn",
    tags: ["棋类"],
    customRoute: "/tools/gomoku",
  },
  {
    id: "ear_naming",
    name: "听力命名训练",
    description: "电吉他 22 品交互指板，点击发声并显示音名/唱名/级数",
    category: "音乐",
    icon: "mdi:guitar-electric",
    tags: ["听力", "乐理"],
    customRoute: "/tools/ear-naming",
  },
  {
    id: "speed_player",
    name: "倍速播放器",
    description: "内嵌 B 站跟弹，滑块自由倍速、AB 循环与标记",
    category: "音乐",
    icon: "mdi:speedometer",
    tags: ["吉他", "视频"],
    customRoute: "/tools/speed-player",
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
