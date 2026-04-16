#!/bin/bash
# =============================================================
#  marsad - one-click launcher for mac/linux
# =============================================================
set -e

cd "$(dirname "$0")"

echo ""
echo "==========================================================="
echo "  Marsad - Facebook Pages Monitor v3.0"
echo "==========================================================="

# Find Python
PY=""
for cmd in python3.13 python3.12 python3.11 python3 python; do
    if command -v "$cmd" >/dev/null 2>&1; then
        PY="$cmd"
        break
    fi
done

if [ -z "$PY" ]; then
    echo "  ERROR: Python 3.11+ not found"
    echo "  Install with: brew install python  (mac)"
    echo "             or: sudo apt install python3 python3-pip  (linux)"
    exit 1
fi

echo "  Python: $PY"
echo ""

# Check deps
echo "[1/3] Checking dependencies..."
if ! $PY -c "import flask, yaml, aiohttp" 2>/dev/null; then
    echo "  Installing dependencies..."
    $PY -m pip install --quiet --upgrade pip
    $PY -m pip install --quiet -r requirements.txt
fi
echo "  OK - All Python deps installed"

# Check Playwright
echo "[2/3] Checking Playwright Chromium..."
if ! $PY -c "from playwright.sync_api import sync_playwright; sync_playwright().__enter__().chromium.executable_path" 2>/dev/null; then
    echo "  Installing Chromium..."
    $PY -m playwright install chromium
fi
echo "  OK - Chromium installed"

# Start
echo "[3/3] Starting server..."
echo ""
echo "  Browser will open at http://localhost:5050"
echo "  Press Ctrl+C to stop"
echo ""
echo "==========================================================="
echo ""

$PY server.py
