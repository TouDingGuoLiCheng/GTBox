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
      path: "/tools/mc-mod-updater",
      name: "mc-mod-updater",
      component: () => import("../views/McModUpdaterView.vue"),
      meta: { title: "MineCraft模组更新器" },
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
      path: "/tools/translate",
      name: "translate",
      component: () => import("../views/TranslateView.vue"),
      meta: { title: "翻译" },
    },
    {
      path: "/tools/text-compare",
      name: "text-compare",
      component: () => import("../views/TextCompareView.vue"),
      meta: { title: "文本比对" },
    },
    {
      path: "/tools/regex-builder",
      name: "regex-builder",
      component: () => import("../views/RegexBuilderView.vue"),
      meta: { title: "正则表达式生成" },
    },
    {
      path: "/tools/gomoku",
      name: "gomoku",
      component: () => import("../views/GomokuView.vue"),
      meta: { title: "五子棋" },
    },
    {
      path: "/tools/ear-naming",
      name: "ear-naming",
      component: () => import("../views/EarNamingView.vue"),
      meta: { title: "听力命名训练", suppressSkinBgm: true },
    },
    {
      path: "/tools/speed-player",
      name: "speed-player",
      component: () => import("../views/SpeedPlayerView.vue"),
      meta: { title: "倍速播放器", suppressSkinBgm: true },
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
