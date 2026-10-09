@echo off
setlocal

cd /d "%~dp0"
set "VITE_DEV_SERVER_URL="
set "ELECTRON_RUN_AS_NODE="

if not exist "package.json" goto invalid_root

where npm.cmd >nul 2>nul
if errorlevel 1 goto missing_node

if not exist "node_modules\electron\dist\electron.exe" (
  echo [Guoling Workbench] Installing locked dependencies for first launch...
  call npm.cmd ci
  if errorlevel 1 goto failed
)

echo [Guoling] Checking current source and build...
node scripts\prepare-source-launch.mjs
if errorlevel 1 goto failed

start "" /D "%CD%" "%CD%\node_modules\electron\dist\electron.exe" "%CD%" %*
exit /b 0

:missing_node
echo [Guoling Workbench] Node.js and npm were not found.
echo Install Node.js LTS, then double-click this launcher again.
goto failed_pause

:invalid_root
echo [Guoling Workbench] Keep this launcher in the project root.
goto failed_pause

:failed
echo [Guoling Workbench] Build or launch failed. Review the error above.

:failed_pause
pause
exit /b 1
