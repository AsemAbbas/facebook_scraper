@echo off
REM ===============================================
REM  marsad - local runner for windows
REM ===============================================
chcp 65001 >nul
set PYTHONIOENCODING=utf-8

set PY="C:\laragon\bin\python\python-3.13\python.exe"
if not exist %PY% (
    echo Python not found at %PY%
    echo Please update PY path in run.bat
    pause
    exit /b 1
)

cd /d "%~dp0"

if "%~1"=="loop" (
    echo Starting auto-loop every 6 hours
    %PY% scripts\local_run.py --loop 360
) else (
    %PY% scripts\local_run.py %*
)

pause
