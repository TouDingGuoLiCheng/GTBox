@echo off
chcp 65001 >nul
setlocal

if "%~1"=="" (
    echo 请把图片或文件夹拖到本脚本上执行。
    echo.
    echo 也可命令行运行: python main.py "图片路径"
    pause
    exit /b 1
)

python "%~dp0main.py" %*
set EXIT_CODE=%ERRORLEVEL%

if not "%EXIT_CODE%"=="0" (
    echo.
    echo 处理失败，错误码: %EXIT_CODE%
    pause
)

exit /b %EXIT_CODE%

