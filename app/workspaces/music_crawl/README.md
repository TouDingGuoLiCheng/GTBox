# 音乐爬取 Python 工作区

脚本由 `d:\Pycharm\爬虫\爬取音乐` 同步至此，供「一键爬取音乐」与插件 manifest 使用（路径相对于「设置」里的**工作区根目录**）。

## 环境

在 **本目录**（`workspaces/music_crawl`）下创建虚拟环境并安装依赖：

```bat
cd /d <本仓库>\workspaces\music_crawl
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m pip install -r playlist_ocr\requirements-ocr.txt
playwright install
```

应用「设置」中：工作区根目录指向本 **`music_crawl`** 文件夹，Python 解释器填 `.venv\Scripts\python.exe`（相对工作区根目录）或绝对路径。

## 截图目录

将歌单截图放入 `playlist_ocr/images_in\`（勿把整个浏览器缓存或临时图片提交到 Git）。
