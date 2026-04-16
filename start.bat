@echo off
REM =============================================================
REM  marsad - one-click launcher for windows
REM  - installs python deps if missing
REM  - installs chromium for playwright if missing
REM  - starts the server and opens browser
REM =============================================================
chcp 65001 >nul
title Marsad - Facebook Pages Monitor
set PYTHONIOENCODING=utf-8

REM ===== Find Python =====
set PY=
for %%P in (
    "C:\laragon\bin\python\python-3.13\python.exe"
    "C:\laragon\bin\python\python-3.12\python.exe"
    "C:\laragon\bin\python\python-3.11\python.exe"
    "C:\Python313\python.exe"
    "C:\Python312\python.exe"
    "C:\Python311\python.exe"
) do (
    if exist %%P (
        set PY=%%P
        goto :found_python
    )
)

REM Try py launcher
where py >nul 2>nul
if %errorlevel%==0 (
    set PY=py
    goto :found_python
)

REM Try python in PATH
where python >nul 2>nul
if %errorlevel%==0 (
    set PY=python
    goto :found_python
)

echo.
echo ===========================================================
echo   ERROR: Python not found
echo ===========================================================
echo   Please install Python 3.11+ from:
echo   https://www.python.org/downloads/
echo.
echo   Or download Python from Microsoft Store
echo ===========================================================
pause
exit /b 1

:found_python
echo.
echo ===========================================================
echo   Marsad - Facebook Pages Monitor v3.0
echo ===========================================================
echo   Python: %PY%
echo.

cd /d "%~dp0"

REM ===== Check if dependencies installed =====
echo [1/3] Checking dependencies...
%PY% -c "import flask, yaml, aiohttp" 2>nul
if %errorlevel% neq 0 (
    echo   Installing dependencies (first time only)...
    %PY% -m pip install --quiet --upgrade pip
    %PY% -m pip install --quiet -r requirements.txt
    if %errorlevel% neq 0 (
        echo   ERROR: Failed to install dependencies
        pause
        exit /b 1
    )
)
echo   OK - All Python deps installed

REM ===== Check if Playwright Chromium installed =====
echo [2/3] Checking Playwright Chromium...
%PY% -c "from playwright.sync_api import sync_playwright; sync_playwright().__enter__().chromium.executable_path" 2>nul
if %errorlevel% neq 0 (
    echo   Installing Chromium for Playwright (first time only, ~150MB)...
    %PY% -m playwright install chromium
)
echo   OK - Chromium installed

REM ===== Start server =====
echo [3/3] Starting server...
echo.
echo   Browser will open automatically at http://localhost:5050
echo   Press Ctrl+C to stop the server
echo.
echo ===========================================================
echo.

%PY% server.py

pause
