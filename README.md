# GTBox · 果粒橙工具箱

[![License](https://img.shields.io/badge/license-private-lightgrey)](#)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-blue)](#)
[![Stack](https://img.shields.io/badge/stack-Tauri%202%20%2B%20Vue%203%20%2B%20Python-42b883)](#)

**GTBox**（仓库名）即桌面应用 **果粒橙工具箱** / **GLC ToolBox**：在 Windows 上把分散的 Python 脚本收进**统一、可动效的图形界面**，用卡片选工具、填参数、看实时日志，不必记命令行。  
现有脚本仍可**独立 CLI 运行**；工具箱只做「壳 + 调度」，不绑死业务逻辑。

- **远程仓库**：<https://github.com/TouDingGuoLiCheng/GTBox.git>
- **详细产品/技术方案**：[`开发方案.md`](./开发方案.md)
- **当前版本**：`app/` 内 `0.1.0`（开发期，以 `tauri dev` 本机运行为主）

---

## 功能概览

| 模块 | 入口 | 说明 |
|------|------|------|
| **一键爬取音乐** | 首页主推卡片 | 歌单截图 OCR → 框选校对 → 写入 `songs.txt` → 对接全自动下载（专用两阶段 UI） |
| **批量爬取** | 插件详情页 | 按 `songs.txt` 批量搜索/爬取（`batch_crawl_2t58.py`） |
| **导出 Cookie** | 插件详情页 | 导出 2t58 站点登录态 |
| **更新待办列表** | 插件详情页 | 维护 `pending_downloads.txt` |
| **批量文件改名** | 专用页 `/tools/batch-rename` | 前缀 + 序号 + 原扩展名；递归/预览/接续计数 |
| **长截图分割** | 专用页 `/tools/split-pic` | 超长图切成多张 PNG，供 OCR 等后续使用 |
| **翻译** | 专用页 `/tools/translate` | 多引擎文本翻译、历史记录（Rust + 可选 WebView 源） |
| **设置 / 外观** | `/settings` | Python 路径、工作区根目录；深色主题、创意背景、自定义视频皮肤等 |

**外观能力（节选）**：字符雨、粒子星辰、激光带、字符画、雨滴涟漪等创意背景；内置云彩流动皮肤预设（`workspaces/skin-presets/`）。详见 [`下一步计划.md`](./下一步计划.md)。

---

## 技术架构

```text
┌─────────────────────────────────────────────────────────┐
│  Vue 3 + TypeScript + Tailwind + @vueuse/motion         │
│  首页网格 · 专用工具页 · 设置 · 实时日志面板              │
└──────────────────────────┬──────────────────────────────┘
                           │ Tauri 2 Commands / Events
┌──────────────────────────▼──────────────────────────────┐
│  Rust（app/src-tauri）                                   │
│  list_plugins · run_tool · cancel_run · 读写工作区文件    │
│  OCR 区域识别桥接 · 翻译子模块                            │
└──────────────────────────┬──────────────────────────────┘
                           │ subprocess（stdout/stderr 流式回传）
┌──────────────────────────▼──────────────────────────────┐
│  workspaces/<程序名>/   ← Python 脚本、数据、.venv          │
│  plugins/<插件 id>/     ← manifest.json + 少量桥接脚本      │
└─────────────────────────────────────────────────────────┘
```

| 层级 | 选型 |
|------|------|
| 桌面壳 | Tauri 2 |
| 前端 | Vue 3.5+、TypeScript、Vite 6、Tailwind 4、Pinia、vue-router |
| 动效 | `@vueuse/motion`（可选 GSAP） |
| 业务 | Python 3.10+（各 `workspaces` 子目录独立 venv） |
| 配置持久化 | `%APPDATA%/果粒橙工具箱/`（或应用标识对应目录） |

---

## 仓库目录

```text
GTBox/
├── app/                    # Tauri 2 + Vue 3 桌面壳（主程序）
│   ├── src/                # 前端：views、components、stores
│   └── src-tauri/          # Rust：进程调度、插件扫描、翻译等
├── plugins/                # 工具插件：manifest.json + 桥接脚本
│   ├── playlist_ocr/
│   ├── full_auto_download/
│   ├── batch_rename/
│   └── split_pic/
├── workspaces/             # 各程序运行目录（脚本与数据，按程序分子文件夹）
│   ├── music_crawl/        # 音乐爬取（默认工作区）
│   ├── auto_change_file_name/
│   ├── split_pic/
│   ├── quick_translate/    # 选中即译相关脚本（部分能力已并入 app）
│   ├── sr_asr/             # 流式语音识别引擎（供 SR 子工程）
│   └── skin-presets/       # 内置皮肤视频等资源
├── SR/                     # 语音输入子工程（流式 ASR，计划 P1 并入 app）
├── scripts/                # 与产品无关的辅助脚本（如 dev 对比、壁纸下载等）
├── 开发方案.md              # 产品与技术总方案
├── 快捷翻译-开发方案.md      # 快捷翻译演进说明
└── README.md               # 本文件
```

> **说明**：根目录 `.gitignore` 排除了 `quick-translate/` 独立工程目录；该能力部分已集成在 `app` 的翻译模块中，完整独立仓需单独克隆。

---

## 环境要求

| 依赖 | 建议版本 | 用途 |
|------|----------|------|
| Windows | 10 / 11 | 主开发与运行平台 |
| Node.js | 18+ | 前端构建、`npm run tauri` |
| Rust | stable + MSVC | 编译 Tauri |
| [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) | 系统自带或安装运行时 | Tauri 渲染 |
| Python | 3.10+ | 各 workspace 脚本 |

安装后可用以下命令自检：

```powershell
node -v
npm -v
rustc -V
cargo -V
python --version
```

---

## 快速开始

### 1. 克隆仓库

```powershell
git clone https://github.com/TouDingGuoLiCheng/GTBox.git
cd GTBox
```

### 2. 安装并启动桌面壳

```powershell
cd app
npm install
npm run tauri dev
```

首次 `tauri dev` 会编译 Rust 依赖，耗时较长属正常现象。成功后会打开无边框主窗口（标题 **GLC ToolBox**）。

### 3. 配置 Python 工作区（音乐爬取等）

在应用 **设置** 中：

| 配置项 | 推荐值 |
|--------|--------|
| **工作区根目录** | `<仓库根>/workspaces/music_crawl` |
| **Python 解释器** | `<工作区>/.venv/Scripts/python.exe` |

在 `workspaces/music_crawl` 下创建虚拟环境并安装依赖：

```powershell
cd workspaces\music_crawl
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pip install -r playlist_ocr\requirements-ocr.txt
.\.venv\Scripts\python.exe -m playwright install
```

将 QQ 音乐歌单截图放入 `playlist_ocr\images_in\`，即可在「一键爬取音乐」中扫描识别。更多说明见 [`workspaces/music_crawl/README.md`](./workspaces/music_crawl/README.md)。

### 4. 其它工具的 Python 环境

| 工作区 | 说明 |
|--------|------|
| `workspaces/split_pic/` | 长截图分割，见该目录 `requirements.txt` |
| `workspaces/auto_change_file_name/` | 批量改名，使用系统 Python 或自建 venv |
| `workspaces/sr_asr/` | 语音引擎，见 [`workspaces/sr_asr/README.md`](./workspaces/sr_asr/README.md) |

在设置里将 **工作区根目录** 切换到对应子目录后，插件 manifest 中的相对路径才会解析正确。

---

## 插件与工作区约定

- **`plugins/<id>/manifest.json`**：定义工具 id、名称、脚本入口、`params` 表单字段；由 `list_plugins` 扫描。`hiddenFromHome: true` 的工具不会出现在首页，但仍可被专用页或其它流程调用。
- **`workspaces/<程序名>/`**：放真实业务脚本、输入输出目录、独立 `requirements.txt` 与 `.venv`。
- **接新工具**（简要）：
  1. 在 `workspaces/<英文名>/` 放入脚本；
  2. 在 `plugins/` 增加 `manifest.json`（复杂交互可加 `customRoute` 与专用 Vue 页）；
  3. 在设置中指向对应工作区根目录。

详见 [`plugins/README.md`](./plugins/README.md)、[`workspaces/README.md`](./workspaces/README.md)。

### 已注册插件一览

| 插件 ID | 首页可见 | 专用路由 |
|---------|----------|----------|
| `playlist_ocr` | 否（音乐流程内嵌） | — |
| `full_auto_download` | 否 | — |
| `batch_rename` | 是 | `/tools/batch-rename` |
| `split_pic` | 是 | `/tools/split-pic` |

首页卡片数据与插件合并逻辑见 `app/src/data/mockTools.ts` 与 `list_plugins`。

---

## 常用开发命令

在 `app/` 目录下：

```powershell
npm run dev          # 仅 Vite 前端（浏览器调试 UI）
npm run tauri dev    # Tauri 开发模式（推荐）
npm run build        # 前端生产构建
npm run tauri build  # 打包安装程序（后期里程碑）
```

前端类型检查：`vue-tsc`（已包含在 `npm run build` 中）。

---

## 相关子工程

### SR · 本地流式语音输入

目录 [`SR/`](./SR/)：按住全局快捷键说话，松手后把识别文字注入当前输入框。  
引擎脚本在 `workspaces/sr_asr/`，计划 **P1** 合并进主 `app/`。

```powershell
cd workspaces\sr_asr
python -m pip install -r requirements.txt
.\download_model.ps1

cd ..\..\SR
npm install
npm run tauri dev
```

详见 [`SR/README.md`](./SR/README.md)、[`SR/开发方案.md`](./SR/开发方案.md)。

### 快捷翻译

独立工程目录 `quick-translate/` **未纳入本仓库**（见 `.gitignore`）。  
方案与合并路线见 [`快捷翻译-开发方案.md`](./快捷翻译-开发方案.md)；`workspaces/quick_translate/` 保留部分脚本供参考或桥接。

---

## 配置与数据路径

| 类型 | 位置 |
|------|------|
| 应用设置 | `%APPDATA%` 下应用配置目录（Python 路径、`workspace_root` 等） |
| 音乐爬取默认工作区 | `workspaces/music_crawl/` |
| 歌单截图输入 | `workspaces/music_crawl/playlist_ocr/images_in/` |
| 皮肤预设视频 | `workspaces/skin-presets/`（如 `cloud.mp4`） |
| 本地下载目录 | `downloads/`（已 gitignore，勿提交大文件） |

---

## 文档索引

| 文档 | 内容 |
|------|------|
| [`开发方案.md`](./开发方案.md) | 需求、架构、manifest 规范、里程碑、UI 线框 |
| [`快捷翻译-开发方案.md`](./快捷翻译-开发方案.md) | 选中即译、与主壳合并计划 |
| [`下一步计划.md`](./下一步计划.md) | 外观/创意背景近期决策与验收 |
| [`workspaces/README.md`](./workspaces/README.md) | 各工作区说明 |
| [`plugins/README.md`](./plugins/README.md) | 插件目录约定 |
| [`scripts/dev/README.md`](./scripts/dev/README.md) | 开发期对比/测试脚本 |

---

## 设计原则

1. **不破坏原有 CLI**：Python 脚本可脱离工具箱单独运行。  
2. **壳与业务分离**：Rust 只管进程与 IO；业务留在 Python。  
3. **插件化扩展**：新工具优先「workspace + manifest」，少改核心壳。  
4. **复杂工具专用 UI**：如「一键爬取音乐」不走通用表单，避免把交互塞进 manifest。

---

## 已知限制（v0.1）

- 主要面向 **Windows**；macOS / Linux 未作为 v1 目标。  
- 安装包不内置 Python，需本机或各 workspace 的 `.venv`。  
- 自动更新、在线插件市场不在当前范围。  
- 部分 CDN（如外链图床）在 Python `requests` 下可能有 SSL 兼容问题，辅助脚本可回退 `curl`（见 `scripts/bizhihui_wallpaper.py`）。

---

## 参与与反馈

- 问题与需求：通过 GitHub Issues（仓库 [TouDingGuoLiCheng/GTBox](https://github.com/TouDingGuoLiCheng/GTBox)）反馈。  
- 大功能变更请先对照 [`开发方案.md`](./开发方案.md) 中的里程碑，避免与已定产品决策冲突。

---

## 许可证

本仓库为个人/私有开发项目；未在根目录声明开源许可证前，请勿擅自商用或二次分发仓库内容。各 `workspaces` 内第三方模型与站点接口的使用须遵守其各自条款。
