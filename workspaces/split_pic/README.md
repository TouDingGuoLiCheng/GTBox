# 自动分割长截图脚本

用于将超长截图自动切成多张 PNG，方便后续送入 AI 识别文字。

## 功能

- 支持批量处理（一次拖拽多张）
- 支持三种模式：`auto` / `smart` / `fixed`
- 每张原图输出到独立文件夹，切片命名为 `part_001.png`
- 处理结果会写入 `output/_done.txt`
- 支持本地网页拖拽上传，自动下载 ZIP 结果

## 安装

```bash
python -m pip install -r requirements.txt
```

## 使用方式

### 0) 本地网页（推荐）

1. 双击 `start_web.bat`
2. 浏览器会自动打开 `http://127.0.0.1:5050`
3. 在网页中拖入图片，点击“开始分割”
4. 自动下载 `split_result_xxx.zip`（按“每张原图一个文件夹”组织，含 `_done.txt`）

### 1) 拖拽（推荐）

把图片文件或文件夹拖到 `run_drop.bat` 上即可。

### 2) 命令行

```bash
python main.py "path/to/image_or_folder"
python main.py "a.png" "b.jpg" "folder_path"
```

## 配置

你有两种方式改参数：

- 网页里直接改（推荐，当前次处理立即生效）
- 改 `config.yaml`（作为默认值）

可配置项：

- `mode`: `auto`（默认）/ `smart` / `fixed`
- `output_dir`: 输出目录（相对脚本目录）
- `target_height`: 智能切目标高度
- `max_height`: 单张输出最大高度
- `overlap`: 切片重叠像素
- `search_radius`: 智能切搜索窗口
- `blank_quantile`: 空白候选分位数（越小越严格）

## 注意

- 支持格式：`.png` `.jpg` `.jpeg` `.webp` `.bmp`
- 若图片损坏或无法读取，会跳过并继续处理下一张
- 当前算法做通用智能切，不绑定特定 App UI
- 网页模式会返回 ZIP 下载，不直接写入 `output/` 目录
- 命令行/批量模式会写入 `output/<原图名>/part_001.png` 这类结构

