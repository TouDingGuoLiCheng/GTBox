import { createRouter, createWebHistory } from "vue-router";
import HomeView from "../views/HomeView.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "home",
      component: HomeView,
    },
    {
      path: "/tools/music-crawl",
      name: "music-crawl",
      component: () => import("../views/MusicCrawlView.vue"),
      meta: { title: "一键爬取音乐" },
    },
    {
      path: "/tools/batch-rename",
      name: "batch-rename",
      component: () => import("../views/BatchRenameView.vue"),
      meta: { title: "批量文件改名" },
    },
    {
      path: "/tools/split-pic",
      name: "split-pic",
      component: () => import("../views/SplitPicView.vue"),
      meta: { title: "长截图分割" },
    },
    {
      path: "/tools/:id",
      name: "tool-detail",
      component: () => import("../views/ToolDetailView.vue"),
      meta: { title: "工具详情" },
    },
    {
      path: "/settings",
      name: "settings",
      component: () => import("../views/SettingsView.vue"),
      meta: { title: "设置" },
    },
  ],
});

export default router;
