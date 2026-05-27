# SR 打包说明（Windows NSIS）

安装包内置：**ONNX 模型**、**streaming_asr.py**、**Python 3 运行时**（含 `sherpa-onnx`、`numpy`）。用户机器**无需**再安装 Python 或 pip。

## 环境要求（仅开发机打包装机）

| 项 | 说明 |
|----|------|
| Node.js | `cd SR && npm install` |
| Rust | MSVC 工具链（[Tauri 前置](https://v2.tauri.app/start/prerequisites/)） |
| Python 3.10–3.12 | 仅用于**构建阶段**生成 `resources/python` venv |
| 模型 | `workspaces\sr_asr\download_model.ps1` |

## 一键打安装包

```powershell
cd "d:\VS\工具箱开发\SR"
npm install
npm run build:installer
```

流程：

1. `prepare-python.ps1` — 在本机用 venv 生成 `src-tauri/resources/python/`（约 5–15 分钟，体积约 300–600MB）
2. 复制模型到 `resources/models/`
3. `tauri build` — NSIS 安装程序

仅重打模型/脚本、跳过 Python（已生成过）：

```powershell
npm run prepare:bundle:fast
npm run tauri build
```

仅重建 Python：

```powershell
npm run prepare:python
```

## 产物

```
SR\src-tauri\target\release\bundle\nsis\
  SR_0.1.0_x64-setup.exe
```

## 安装后目录（示意）

```
安装目录\
  sr.exe
  python\              ← 嵌入式 venv
    Scripts\python.exe
    Lib\site-packages\...
  models\
    sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20\
  resources\
    streaming_asr.py
```

应用优先使用安装目录旁的 `python\Scripts\python.exe`，不依赖系统 PATH。

## 体积说明（为何比 30MB 的翻译软件大很多）

| 组件 | 约 | 原因 |
|------|-----|------|
| **ONNX 模型** | ~530 MB | 本地双语流式 Zipformer，必须随包或首次下载 |
| **onnxruntime** | ~120–180 MB | `sherpa-onnx` 依赖的推理引擎（大量 `.dll`） |
| **numpy + sherpa** | ~30–50 MB | 数值与绑定层 |
| **Python 运行时** | ~25–40 MB | venv 标准库 + 解释器 |
| **SR 程序本体** | ~10 MB | Tauri + Rust |

**合计约 700–900 MB**（压缩后安装包略小）。`prepare-python` 会删掉 pip/setuptools/测试等，但 **砍不掉 onnxruntime**。

常见「30MB 翻译软件」往往是：

- 安装包只是壳，**模型/引擎在线或首次下载**；
- 或 **纯 Rust/C++** 推理，不带 Python；
- 或模型远小于流式 Zipformer。

SR 当前是 **P0：Python 子进程 + 完整本地模型**（见 `开发方案.md` §2.3、§11）。要明显变小，方向是：

1. **P1**：Rust `sherpa-rs` 同进程推理 → 可去掉整套 Python（约省 150–200MB，模型仍占 530MB）  
2. **更小模型**：换更小 ONNX（可能牺牲准确率）  
3. **不内置 Python**：安装包变小，但用户需自行 `pip install`（你之前已否决体验）

## 目标机使用

1. 安装 `SR_xxx-setup.exe`
2. 打开 SR → 引擎应 **就绪**
3. 配置快捷键后即可使用

## 常见问题

- **prepare-python 失败** — 本机先 `pip install sherpa-onnx numpy` 验证网络与 Python 版本
- **引擎：未找到 Python** — 未执行完整 `prepare:bundle` 或安装包不完整
- **打包太慢** — 用 `prepare:bundle:fast` 跳过 Python 步骤做迭代
