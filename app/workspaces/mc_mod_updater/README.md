# MineCraft 模组更新器

扫描本地 `mods` 文件夹，通过 Modrinth / CurseForge 官方 API 识别并批量更新模组；支持缺失依赖检测/补装与一键回滚。

## 环境搭建

```powershell
cd app/workspaces/mc_mod_updater
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

工具箱以 `interpreter: venv` 启动本目录虚拟环境；请确保上述依赖已安装。

## CLI 用法

```powershell
# 扫描识别
.\.venv\Scripts\python.exe mod_updater.py --action scan --mods-path "D:\path\to\mods"

# 检查更新
.\.venv\Scripts\python.exe mod_updater.py --action check --mods-path "D:\path\to\mods" --mc-version 1.20.1 --loader fabric

# 一键更新（默认备份）
.\.venv\Scripts\python.exe mod_updater.py --action update --mods-path "D:\path\to\mods" --mc-version 1.20.1 --loader fabric --backup-enabled

# 检查缺失 required 依赖（Modrinth）
.\.venv\Scripts\python.exe mod_updater.py --action deps --mods-path "D:\path\to\mods" --mc-version 1.20.1 --loader fabric

# 补装缺失依赖
.\.venv\Scripts\python.exe mod_updater.py --action install-deps --mods-path "D:\path\to\mods" --mc-version 1.20.1 --loader fabric

# 回滚到最近一次更新备份
.\.venv\Scripts\python.exe mod_updater.py --action rollback --mods-path "D:\path\to\mods" --backup-dir mods_backup
```

| 参数 | 说明 |
|------|------|
| `--action` | `scan` / `check` / `update` / `deps` / `install-deps` / `rollback` |
| `--mods-path` | 本地 mods 目录 |
| `--mc-version` | 如 `1.20.1` |
| `--loader` | `forge` / `fabric` / `quilt` / `neoforge` |
| `--backup-enabled` | 启用备份 |
| `--backup-dir` | 备份根目录（相对路径相对 mods 父目录） |
| `--concurrency` | 并发数 1–16 |
| `--timeout` | 单次请求超时（秒） |
| `--curseforge-api-key` | 留空仅用 Modrinth |
| `--only` | 逗号分隔 jar 名 |

## 工具箱内流程

1. 选择 mods → **扫描**
2. 填 MC 版本 + 加载器 → **检查更新**
3. **一键更新** / **更新选中** → 预览确认
4. 更新后自动 **检查依赖**；可 **补装依赖**
5. 需要时可 **回滚**（从 `last_update.json` / 最近备份还原）
6. 运行中可 **取消**

## 备份与回滚

```
instance/
  mods/
  mods_backup/
    20260723_123045/
      old-mod-1.0.jar
```

- 更新成功后写入工作区 `last_update.json`（记录备份路径、新增/移动文件）
- **回滚**：把备份 jar 拷回 `mods/`，并删除因改名新增的新 jar
- 回滚后建议重新扫描

## 依赖说明

- 仅检测 **Modrinth** 的 `required` 依赖（当前 MC 版本 + 加载器下兼容文件）
- CurseForge 依赖树首版不做；CF Key 仍用于识别/更新 CF 来源 mod

## 稳定性

- HTTP 429/5xx 指数退避重试
- 检查/更新增量写 `mods_state.json`
- 下载后 SHA-1 校验

## 调试

设置 → 显示调试终端 → 分类「MC模组更新器」。
