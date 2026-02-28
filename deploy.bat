@echo off
setlocal enabledelayedexpansion

:: Self-relocate to %TEMP% so git branch switches don't delete
:: the running script out from under us.
if not "%~dp0"=="%TEMP%\" (
    copy /y "%~f0" "%TEMP%\deploy_cubewizard.bat" >nul
    pushd "%~dp0"
    call "%TEMP%\deploy_cubewizard.bat" %*
    set _exit=%errorlevel%
    popd
    exit /b %_exit%
)

echo ============================================
echo    CubeWizard Deploy to Live Site
echo ============================================
echo.

:: ── Pre-flight checks ──────────────────────────

:: Must be in a git repo
git rev-parse --git-dir >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Not in a git repository.
    pause
    exit /b 1
)

:: Must be on main
for /f "tokens=*" %%i in ('git branch --show-current') do set current_branch=%%i
if not "%current_branch%"=="main" (
    echo ERROR: You must be on the main branch to deploy.
    echo Current branch: %current_branch%
    pause
    exit /b 1
)

:: Must have no uncommitted changes (staged or unstaged)
git diff --quiet
if %errorlevel% neq 0 (
    echo ERROR: You have unstaged changes. Commit or stash them first.
    git status --short
    pause
    exit /b 1
)
git diff --cached --quiet
if %errorlevel% neq 0 (
    echo ERROR: You have staged but uncommitted changes. Commit or stash them first.
    git status --short
    pause
    exit /b 1
)

echo All checks passed.
echo.

:: Show what will be deployed
for /f "tokens=*" %%i in ('git log -1 --oneline') do set head_commit=%%i
echo Latest main commit: %head_commit%
echo.
echo This will force-update prod-site to match main and push to origin.
echo Cloudflare will then rebuild the live site.
echo.

set /p confirm="Deploy to prod-site? (y/N): "
if /i not "%confirm%"=="y" (
    echo Deployment cancelled.
    pause
    exit /b 0
)

echo.
echo Starting deployment...
echo.

:: ── Step 1: Push main to origin ────────────────
echo [1/3] Pushing main to origin...
git push origin main
if %errorlevel% neq 0 (
    echo ERROR: Failed to push main to origin.
    pause
    exit /b 1
)

:: ── Step 2: Reset prod-site to main ────────────
echo.
echo [2/3] Updating prod-site branch...
git checkout prod-site 2>nul || git checkout -b prod-site
git reset --hard main
if %errorlevel% neq 0 (
    echo ERROR: Failed to reset prod-site to main.
    git checkout main
    pause
    exit /b 1
)

:: ── Step 3: Force push prod-site ───────────────
echo.
echo [3/3] Pushing prod-site to origin...
git push origin prod-site --force
if %errorlevel% neq 0 (
    echo ERROR: Failed to push prod-site to origin.
    git checkout main
    pause
    exit /b 1
)

:: ── Done ───────────────────────────────────────
echo.
echo Returning to main branch...
git checkout main

echo.
echo ============================================
echo         Deployment Complete!
echo ============================================
echo.
echo prod-site is now identical to main (%head_commit%).
echo Cloudflare will pick up the changes shortly.
echo.
pause