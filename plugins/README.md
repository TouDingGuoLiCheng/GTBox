# Tauri 插件（`plugins/`）

每个子目录对应首页/路由里的一个「工具」入口所需的 **元数据与薄封装**：

- `manifest.json`：脚本路径、参数表单、`hiddenFromHome` 等，由 `list_plugins` 扫描。
- 少量 **桥接脚本**（如 `playlist_ocr/region_ocr.py`）：供 Rust 单独调用、不全走通用 `run_tool` 流程。

**业务代码与数据**放在 `workspaces/<程序名>/`，不要堆在本目录，便于以后多程序并行维护。
