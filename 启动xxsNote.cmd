@echo off
chcp 65001 >nul
title xxsNote v1.1.2
cd /d "%~dp0"

if not exist "%~dp0runtime\python.exe" (
  echo xxsNote 内置运行环境不完整，请重新复制完整项目。
  pause
  exit /b 1
)

echo 正在启动 xxsNote，请稍候...
"%~dp0runtime\python.exe" -I -B "%~dp0server.py"

if errorlevel 1 pause
