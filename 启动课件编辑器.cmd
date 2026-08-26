@echo off
setlocal

cd /d "%~dp0"
set "VITE_DEV_SERVER_URL="
set "ELECTRON_RUN_AS_NODE="

if not exist "package.json" goto invalid_root

echo [ittoedu Courseware Editor] Syncing courseware Skills for the current user...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%CD%\scripts\install-courseware-skills.ps1"
if errorlevel 1 (
  echo [ittoedu Courseware Editor] WARNING: Skill installation failed; editor startup will continue.
  echo Run "npm run install:courseware-skills" after resolving the message above.
)

where npm.cmd >nul 2>nul
if errorlevel 1 goto missing_node

if not exist "node_modules\electron\dist\electron.exe" (
  echo [ittoedu Courseware Editor] Installing locked dependencies for first launch...
  call npm.cmd ci
  if errorlevel 1 goto failed
)

echo [ittoedu Courseware Editor] Building and launching...
call npm.cmd run build:desktop
if errorlevel 1 goto failed

start "" /D "%CD%" "%CD%\node_modules\electron\dist\electron.exe" "%CD%"
exit /b 0

:missing_node
echo [ittoedu Courseware Editor] Node.js and npm were not found.
echo Install Node.js LTS, then double-click this launcher again.
goto failed_pause

:invalid_root
echo [ittoedu Courseware Editor] Keep this launcher in the project root.
goto failed_pause

:failed
echo [ittoedu Courseware Editor] Build or launch failed. Review the error above.

:failed_pause
pause
exit /b 1
