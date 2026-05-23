@echo off
chcp 65001 >nul
setlocal

set ROOT=%~dp0
set PYTHON=%ROOT%\.venv\Scripts\python.exe

if not exist "%PYTHON%" (
    echo 未找到虚拟环境 Python：%PYTHON%
    echo 请先创建 .venv 或修改本脚本中的 PYTHON 路径。
    pause
    exit /b 1
)

echo 清理旧的 5050 端口进程...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "127.0.0.1:5050" ^| findstr "LISTENING"') do (
    echo 关闭 PID=%%p
    taskkill /PID %%p /F >nul 2>nul
)

echo 正在安装/检查依赖...
"%PYTHON%" -m pip install -r "%ROOT%requirements.txt"
if errorlevel 1 (
    echo 依赖安装失败。
    pause
    exit /b 1
)

echo 正在启动服务: http://127.0.0.1:5050
start "" http://127.0.0.1:5050/?_ts=%RANDOM%
"%PYTHON%" "%ROOT%web_app.py"

