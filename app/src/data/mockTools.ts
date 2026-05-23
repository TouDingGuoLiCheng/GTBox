import type { ToolItem } from "../types/tool";

export const mockTools: ToolItem[] = [
  {
    id: "music_crawl",
    name: "一键爬取音乐",
    description: "截图识歌单 → 校对 OCR → 一键下载",
    category: "音乐",
    icon: "mdi:music-circle-outline",
    tags: ["主推", "OCR"],
    customRoute: "/tools/music-crawl",
  },
  {
    id: "batch_crawl",
    name: "批量爬取",
    description: "按 songs.txt 批量搜索与爬取",
    category: "音乐",
    icon: "mdi:playlist-music-outline",
  },
  {
    id: "batch_rename",
    name: "批量文件改名",
    description: "前缀 + 序号 + 原扩展名；递归/预览/接续计数",
    category: "工具",
    icon: "mdi:rename-box",
    tags: ["files"],
    customRoute: "/tools/batch-rename",
  },
  {
    id: "export_cookies",
    name: "导出 Cookie",
    description: "导出 2t58 站点登录态",
    category: "工具",
    icon: "mdi:cookie-outline",
  },
  {
    id: "update_pending",
    name: "更新待办列表",
    description: "维护 pending_downloads.txt",
    category: "工具",
    icon: "mdi:format-list-checks",
  },
];

export const categories = ["全部", "音乐", "工具"] as const;
