@echo off
setlocal enabledelayedexpansion

echo ============================================
echo    CubeWizard Deployment Branch Reset
echo ============================================
echo.

:: Check if we're in a git repository
git status >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Not in a git repository or git is not available.
    echo Please run this script from the CubeWizard project directory.
    pause
    exit /b 1
)

:: Get current branch
for /f "tokens=*" %%i in ('git branch --show-current') do set current_branch=%%i

echo Current branch: %current_branch%
echo.

:: Show available deployment branches
echo Available deployment branches:
echo   1. prod-site
echo   2. stg-site
echo   3. Cancel
echo.

set /p choice="Select deployment branch to reset (1-3): "

if "%choice%"=="1" (
    set target_branch=prod-site
) else if "%choice%"=="2" (
    set target_branch=stg-site
) else if "%choice%"=="3" (
    echo Operation cancelled.
    pause
    exit /b 0
) else (
    echo Invalid choice. Operation cancelled.
    pause
    exit /b 1
)

echo.
echo Selected branch: %target_branch%
echo.

:: Confirm the operation
echo WARNING: This will HARD RESET %target_branch% to match main branch.
echo All changes in %target_branch% that are not in main will be LOST!
echo.
set /p confirm="Are you sure you want to continue? (y/N): "

if /i not "%confirm%"=="y" (
    echo Operation cancelled.
    pause
    exit /b 0
)

echo.
echo Starting deployment branch reset...
echo.

:: Step 1: Ensure we have latest main
echo [1/4] Fetching latest changes from origin...
git fetch origin
if %errorlevel% neq 0 (
    echo ERROR: Failed to fetch from origin.
    pause
    exit /b 1
)

:: Step 2: Switch to main and update it
echo.
echo [2/4] Switching to main branch and updating...
git checkout main
if %errorlevel% neq 0 (
    echo ERROR: Failed to checkout main branch.
    pause
    exit /b 1
)

git pull origin main
if %errorlevel% neq 0 (
    echo ERROR: Failed to pull latest main.
    pause
    exit /b 1
)

:: Step 3: Switch to target branch
echo.
echo [3/4] Switching to %target_branch% branch...
git checkout %target_branch%
if %errorlevel% neq 0 (
    echo WARNING: %target_branch% branch doesn't exist locally. Creating it...
    git checkout -b %target_branch%
    if %errorlevel% neq 0 (
        echo ERROR: Failed to create %target_branch% branch.
        pause
        exit /b 1
    )
)

:: Step 4: Hard reset to main
echo.
echo [4/4] Hard resetting %target_branch% to match main...
git reset --hard main
if %errorlevel% neq 0 (
    echo ERROR: Failed to reset %target_branch% to main.
    pause
    exit /b 1
)

:: Optional: Force push to origin (commented out for safety)
echo.
echo Reset complete! %target_branch% now matches main.
echo.
echo To push the reset branch to origin, run:
echo   git push origin %target_branch% --force-with-lease
echo.
echo WARNING: Force pushing will overwrite the remote %target_branch% branch!
echo.

set /p push_confirm="Do you want to force push to origin now? (y/N): "

if /i "%push_confirm%"=="y" (
    echo.
    echo Pushing %target_branch% to origin...
    git push origin %target_branch% --force-with-lease
    if %errorlevel% neq 0 (
        echo ERROR: Failed to push to origin.
        echo You may need to run: git push origin %target_branch% --force
        pause
        exit /b 1
    )
    echo.
    echo Successfully pushed %target_branch% to origin!
) else (
    echo.
    echo Skipped pushing to origin.
    echo Remember to push when you're ready: git push origin %target_branch% --force-with-lease
)

echo.
echo ============================================
echo           Reset Complete!
echo ============================================
echo.
echo Branch %target_branch% has been reset to match main.

:: Return to original branch if it was different
if not "%current_branch%"=="%target_branch%" (
    echo.
    echo Returning to original branch: %current_branch%
    git checkout %current_branch%
)

echo.
pause