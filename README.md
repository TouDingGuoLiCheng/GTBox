# 果粒橙工具箱（仓库结构）

```
工具箱开发/
├── app/              # Tauri 2 + Vue 3 桌面壳
├── plugins/          # 工具的 manifest.json + 桥接脚本（如 region_ocr.py）
├── workspaces/       # 被调度的外部/聚合程序目录（按程序分子文件夹）
│   ├── music_crawl/          # 音乐爬取
│   ├── auto_change_file_name/ # 批量改名
│   └── …
├── scripts/          # 与产品无关的辅助脚本（开发、对比测试等）
│   └── dev/
├── 开发方案.md
└── 快捷翻译-开发方案.md   # 选中即译（WebView 网页源，可独立运行）
```

- **接新程序**：优先在 `workspaces/<名称>/` 放运行代码，在 `plugins/<插件 id>/` 放 manifest；详见 `workspaces/README.md`。
- **快捷翻译**：见 `快捷翻译-开发方案.md`（不走 plugins 子进程，先 `quick-translate/` 独立工程）。
