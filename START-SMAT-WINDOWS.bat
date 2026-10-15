@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install the LTS version from https://nodejs.org/
  pause
  exit /b 1
)
echo Starting SMAT. Keep this window open, then open the address printed below.
echo SMAT looks for GNU Octave automatically (PATH, OCTAVE_PATH, or the default install folder).
echo.
node server.js
echo.
echo SMAT has stopped.
pause
