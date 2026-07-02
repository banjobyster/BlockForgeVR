@echo off
title BlockForge VR
echo.
echo   BLOCKFORGE VR
echo   Starting local game server...
echo.

rem Start the tiny web server (does nothing if one is already running)
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0server.ps1"

rem Give it a moment to come up
ping -n 2 127.0.0.1 >nul

rem Open in Chrome if available (best WebXR support), otherwise Edge
set "URL=http://localhost:8787"
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" %URL%
  goto opened
)
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" %URL%
  goto opened
)
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
  start "" "%LocalAppData%\Google\Chrome\Application\chrome.exe" %URL%
  goto opened
)
start "" msedge %URL%

:opened
echo   Game opened in your browser at %URL%
echo.
echo   To play in VR: connect your Quest with Link active,
echo   then click "Enter VR" on the game page.
echo.
echo   You can close this window.
timeout /t 8 >nul
exit
