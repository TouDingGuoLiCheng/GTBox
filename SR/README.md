# SR · 本地流式语音输入

按住全局快捷键 → 屏幕悬浮条实时显示识别文字 → 松手后注入当前输入框。

- **详细方案**：[开发方案.md](./开发方案.md)
- **识别引擎（Python 常驻）**：`../workspaces/sr_asr/`（M2 起创建）
- **合并目标**：果粒橙工具箱 `app/`（P1）

## 当前状态

**M0–M4 骨架已就绪**（Tauri 壳、overlay、热键、cpal、Python daemon 协议）。需本机安装 Python + Sherpa 模型后方可完整识别。

## 开发运行

```powershell
# 1. 引擎依赖与模型（首次）
cd "d:\VS\工具箱开发\workspaces\sr_asr"
python -m pip install -r requirements.txt
.\download_model.ps1

# 2. 前端依赖
cd "d:\VS\工具箱开发\SR"
npm install

# 3. 启动（Vite :1424 + Tauri）
npm run tauri dev
```

保存设置后等待引擎「就绪」。按 `Alt+V` 打开语音条说话。

## 打包安装程序

见 **[PACKAGING.md](./PACKAGING.md)**。简要命令：

```powershell
cd SR
npm run build:installer
```

安装包内置模型与 Python 运行时；目标机无需再装 Python。

## 快速预览技术选型

| 项 | 选型 |
|----|------|
| 壳 | Tauri 2 + Vue 3 |
| 流式 ASR | Sherpa-ONNX（P0 Python daemon，P1 可 Rust 化） |
| 音频 | cpal @ 16 kHz mono |
| 热键 | Push-to-Talk（按住录音） |
