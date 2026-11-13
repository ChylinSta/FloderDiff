@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found on PATH.
  echo Install Node.js 20 or newer from https://nodejs.org and open a new Command Prompt.
  exit /b 1
)

node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
if errorlevel 1 (
  echo FolderDiff needs Node.js 20 or newer. This copy of Node is:
  node -v
  echo Install Node.js 20 or newer from https://nodejs.org and open a new Command Prompt.
  exit /b 1
)

echo Using Node.js:
node -v

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)

echo Starting FolderDiff at http://127.0.0.1:43123
call npm run dev
