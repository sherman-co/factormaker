@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo در حال نصب برنامه (فقط بار اول، چند دقیقه صبر کنید)...
  call npm install
)
echo برنامه در حال اجراست. مرورگر را باز کنید: http://localhost:3000
start http://localhost:3000
node server/index.js
pause
