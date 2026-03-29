@echo off
REM CubeWizard Scheduled R2 Pull + Process
REM Pulls new submissions from R2, then runs main.py to process them.
REM Set up in Windows Task Scheduler to run weekly.

cd /d "%~dp0"

set LOGFILE=scheduled_pull.log

echo. >> "%LOGFILE%"
echo ================================================== >> "%LOGFILE%"
echo Run started: %DATE% %TIME% >> "%LOGFILE%"
echo ================================================== >> "%LOGFILE%"

echo [1/2] Pulling new submissions from R2... >> "%LOGFILE%"
python -u pull_from_r2.py --pull >> "%LOGFILE%" 2>&1

REM Check if submissions has any folders to process
dir /b /ad submissions >nul 2>&1
if %errorlevel% equ 0 (
    echo. >> "%LOGFILE%"
    echo [2/2] Processing downloaded decklists... >> "%LOGFILE%"
    python -u main.py import >> "%LOGFILE%" 2>&1
) else (
    echo. >> "%LOGFILE%"
    echo [2/2] No new decklists to process, skipping. >> "%LOGFILE%"
)

echo. >> "%LOGFILE%"
echo Run finished: %DATE% %TIME% >> "%LOGFILE%"
echo ================================================== >> "%LOGFILE%"
