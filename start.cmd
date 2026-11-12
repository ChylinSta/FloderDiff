@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found on PATH.
  echo Install Node.js 20 or newer from https://nodejs.org and open a new Command Prompt.
  exit /b 1
)

echo FolderDiff requires Node.js 20 or newer.
node -v

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)

echo Starting FolderDiff at http://127.0.0.1:43123
call npm run dev
