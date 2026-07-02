# GTBox 打包说明（Windows NSIS）

安装包内置：**plugins/**、**workspaces/**（脚本、皮肤预设等）。**不包含 Python 运行时**，用户需本机安装 Python 或在各工作区配置 `.venv`（与开发期一致）。

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

1. `prepare-bundle.ps1` — 从 `box.png` 生成 Tauri 图标；复制 `plugins/`、`app/workspaces/` 到 `src-tauri/resources/bundle/`
2. `tauri build` — 生成 NSIS 安装程序

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

## 安装后目录（示意）

```
安装目录\
  gtbox.exe
  plugins\
    batch_rename\
    split_pic\
    ...
  workspaces\
    music_crawl\
    skin-presets\
    ...
  resources\          ← Tauri 内置资源
```

应用优先从 **exe 同级** 的 `plugins/`、`workspaces/` 加载；开发模式仍走仓库源码路径。

## 目标机使用

1. 安装 `GTBox_1.0.0_x64-setup.exe`
2. 打开 GTBox
3. 在 **设置** 中配置 Python 解释器与工作区根目录（默认 `workspaces/music_crawl`）

## 常见问题

- **prepare-bundle 找不到 box.png** — 确认图标在仓库根目录 `box.png`
- **打包后插件列表为空** — 检查安装目录下是否存在 `plugins/` 文件夹
- **Python 工具无法运行** — 安装包不带 Python，请在对应 workspace 创建 `.venv` 并安装 `requirements.txt`
