@echo off
setlocal enabledelayedexpansion

echo ============================================
echo    CubeWizard Deploy to Live Site
echo ============================================
echo.
echo Pushes your local data and dashboard to the
echo publicly available site.
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

:: Show available deployment targets
echo Deployment targets:
echo   1. prod-site  (live site)
echo   2. stg-site   (staging / preview)
echo   3. Cancel
echo.

set /p choice="Select deployment target (1-3): "

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
echo Selected target: %target_branch%
echo.

:: Confirm the operation
echo This will deploy the current main branch to %target_branch%.
echo The live site will be updated with your latest local data.
echo.
set /p confirm="Are you sure you want to deploy? (y/N): "

if /i not "%confirm%"=="y" (
    echo Deployment cancelled.
    pause
    exit /b 0
)

echo.
echo Starting deployment...
echo.

:: Step 1: Ensure we have latest main
echo [1/4] Fetching latest from origin...
git fetch origin
if %errorlevel% neq 0 (
    echo ERROR: Failed to fetch from origin.
    pause
    exit /b 1
)

:: Step 2: Switch to main and update it
echo.
echo [2/4] Updating main branch...
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
echo [3/4] Preparing %target_branch% for deployment...
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
echo [4/4] Syncing %target_branch% with main...
git reset --hard main
if %errorlevel% neq 0 (
    echo ERROR: Failed to sync %target_branch% with main.
    pause
    exit /b 1
)

:: Optional: Force push to origin (commented out for safety)
echo.
echo Ready to deploy! %target_branch% has been synced with main locally.
echo.
echo To publish to the live site, this needs to be pushed to origin.
echo.

set /p push_confirm="Push to live site now? (y/N): "

if /i "%push_confirm%"=="y" (
    echo.
    echo Publishing %target_branch% to live site...
    git push origin %target_branch% --force-with-lease
    if %errorlevel% neq 0 (
        echo ERROR: Failed to push to origin.
        echo You may need to run: git push origin %target_branch% --force
        pause
        exit /b 1
    )
    echo.
    echo Successfully deployed to %target_branch%!
) else (
    echo.
    echo Deployment not pushed yet.
    echo Run this when ready: git push origin %target_branch% --force-with-lease
)

echo.
echo ============================================
echo         Deployment Complete!
echo ============================================
echo.
echo %target_branch% is now up to date with main.

:: Return to original branch if it was different
if not "%current_branch%"=="%target_branch%" (
    echo.
    echo Returning to original branch: %current_branch%
    git checkout %current_branch%
)

echo.
pause