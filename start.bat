@echo off
cd /d "%~dp0"
if not exist "node_modules\express" (
  echo Installing - first run only, please wait a few minutes...
  call npm install
  if errorlevel 1 (
    echo Install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)
echo Starting... Open http://localhost:3000 in your browser
start "" http://localhost:3000
node server/index.js
pause
