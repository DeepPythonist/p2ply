@echo off
title P2Ply Installer & Launcher
cls

echo ==========================================================
echo    P2Ply Universal Installer (Windows)
echo ==========================================================
echo.
echo [!] IMPORTANT: PLEASE TURN ON YOUR VPN NOW! [!]
echo.
echo This script will automatically install all requirements.
echo.
pause

:: 1. Check & Install Git
git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Git not found. Installing via Winget...
    winget install -e --id Git.Git
    if %errorlevel% neq 0 (
        echo [x] Failed to install Git. Please install manually.
        pause
        exit /b
    )
    call RefreshEnv.cmd >nul 2>&1
)

:: 2. Check & Install Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Python not found. Installing via Winget...
    winget install -e --id Python.Python.3.11
    if %errorlevel% neq 0 (
        echo [x] Failed to install Python. Please install manually.
        pause
        exit /b
    )
    call RefreshEnv.cmd >nul 2>&1
)

:: 3. Check & Install Node.js
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Node.js not found. Installing via Winget...
    winget install -e --id OpenJS.NodeJS
    if %errorlevel% neq 0 (
        echo [x] Failed to install Node.js. Please install manually.
        pause
        exit /b
    )
    call RefreshEnv.cmd >nul 2>&1
)

echo.
echo [+] All tools are ready.

:: 4. Clone or Update Repo
if exist "p2ply" (
    echo [*] Updating p2ply...
    cd p2ply
    git pull
) else (
    echo [*] Cloning p2ply repository...
    git clone https://github.com/DeepPythonist/p2ply.git
    cd p2ply
)

:: 5. Install Dependencies & Run
echo.
echo [*] Installing project dependencies...
call npm install

echo.
echo [*] Launching P2Ply...
python launcher.py

pause
