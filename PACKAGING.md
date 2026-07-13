# GTBox 打包说明（Windows NSIS）

安装包内置全部**本地静态资源**；**不包含 Python 运行时**（用户需本机 Python 或各 workspace 的 `.venv`）。

## 资源打包一览

| 资源 | 源路径 | 打包方式 | 安装后位置 |
|------|--------|----------|------------|
| 应用图标 | 仓库根 `box.png` | `prepare-bundle` → `tauri icon` | exe / 安装程序图标 |
| 插件 | `plugins/` | `bundle.resources` | `{安装目录}/plugins/` |
| 工作区脚本 | `app/workspaces/` | `bundle.resources` | `{安装目录}/workspaces/` |
| 皮肤视频/BGM | `workspaces/skin-presets/*` | 同上 | `{安装目录}/workspaces/skin-presets/` |
| 吉他采样 | `public/audio/guitar/` | Vite build → dist | 内嵌前端包，`/audio/guitar/...` |
| 五子棋图/音效 | `public/gomoku/` | Vite build → dist | 内嵌前端包，`/gomoku/...` |
| 银河主题壁纸 | `src/assets/themes/galaxy-bg.png` | Vite build → dist | 内嵌前端包 |
| 翻译配置 / 倍速脚本 | `src-tauri/resources/*.json/js` | Rust `include_str!` | 二进制内 |

`tauri build` 的 `beforeBuildCommand` 会自动执行 `ensure:bundle`，缺失资源时会补跑 `prepare-bundle`。

## 环境要求（仅开发机打包装机）

| 项 | 说明 |
|----|------|
| Node.js | `cd app && npm install` |
| Rust | MSVC 工具链（[Tauri 前置](https://v2.tauri.app/start/prerequisites/)） |
| 图标源 | 仓库根目录 `box.png` |

## 一键打安装包

```powershell
cd "d:\VS\工具箱开发\app"
npm install
npm run build:installer
```

流程：

1. `prepare-bundle.ps1` — 校验 public/ 与皮肤资源；从 `box.png` 生成图标；复制 `plugins/`、`workspaces/` 到 `resources/bundle/`
2. `ensure:bundle`（`tauri build` 内建）— 缺资源时自动补全
3. `npm run build` — 前端（含 public 音频/五子棋资源）打入 dist
4. `tauri build` — NSIS 安装程序

仅重打业务资源、跳过图标（已生成过）：

```powershell
npm run prepare:bundle:fast
npm run tauri build
```

## 产物

```
app\src-tauri\target\release\bundle\nsis\
  GTBox_1.0.0_x64-setup.exe
```

## 安装后目录

```
安装目录\
  gtbox.exe
  plugins\
  workspaces\
    music_crawl\
    skin-presets\      ← 皮肤视频 + BGM
    split_pic\
    ...
```

应用优先从 **exe 同级** 的 `plugins/`、`workspaces/` 加载。若 `%APPDATA%` 里保存了旧机器绝对路径，启动时会自动重置为安装目录下的 `workspaces/music_crawl`。

## 目标机使用

1. 安装 `GTBox_1.0.0_x64-setup.exe`
2. 打开 GTBox（听力训练、五子棋音效、皮肤预设应可直接使用）
3. 在 **设置** 中配置 Python（音乐爬取等需 `.venv` + `requirements.txt`）

## 跨机路径说明

| 场景 | 行为 |
|------|------|
| 正常 NSIS 安装 | `install_data_root()` 定位 exe 旁 `plugins` + `workspaces` |
| 设置里 workspace 路径失效 | 自动改回 `{安装目录}/workspaces/music_crawl` |
| OCR `region_ocr.py` | 优先找 `{安装目录}/workspaces/music_crawl/playlist_ocr/` |
| 仅复制 exe、无 plugins/workspaces | 开发路径回退（其他电脑不可用）— 请用完整安装包 |

## 常见问题

- **prepare-bundle 找不到 box.png** — 确认图标在仓库根目录
- **打包后插件/皮肤为空** — 勿跳过 `prepare-bundle`；检查 `src-tauri/resources/bundle/` 是否生成
- **五子棋/吉他无声** — 确认 `npm run build` 成功（public 资源在 dist 里）
- **Python 工具无法运行** — 安装包不带 Python，请在 workspace 创建 `.venv`
