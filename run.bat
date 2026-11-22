@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js 20.19+ from https://nodejs.org & pause & exit /b 1)
if not exist node_modules (
  echo Installing dependencies...
  call npm.cmd install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
call npm.cmd start
pause
