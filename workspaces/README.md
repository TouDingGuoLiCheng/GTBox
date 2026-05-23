# 各程序工作区（Workspaces）

本目录按**接入的程序**分子文件夹，与 `plugins/`（Tauri 壳的 manifest + 少量桥接脚本）分离：

| 目录 | 说明 |
|------|------|
| `music_crawl/` | 一键爬取音乐：2t58 批量/全自动下载、歌单 OCR 等 Python 脚本 |
| `auto_change_file_name/` | 批量文件改名（通用：前缀 + 序号 + 扩展名）；插件 `batch_rename` |
| `split_pic/` | 长截图自动分割为多张 PNG；插件 `split_pic`（另有本地网页 `web_app.py`） |
| `skin-presets/` | 内置视频皮肤素材（如 `cloud.mp4` 云彩流动背景） |

之后接入新程序时，建议：

1. 新建 `workspaces/<程序英文名>/`，放入该程序的脚本、配置与（可选）独立 `requirements.txt`。
2. 在 `plugins/` 下增加对应 `manifest.json`（及专用 UI 路由如需要）。
3. 在应用「设置」里将 **工作区根目录** 指向对应子目录；若某工具需要与现有一致的路径布局，可继续沿用相对路径约定。

默认工作区（无本地设置文件时）当前指向 **`music_crawl/`**，见 `app/src-tauri/src/lib.rs` 中的 `default_workspace_root`。
