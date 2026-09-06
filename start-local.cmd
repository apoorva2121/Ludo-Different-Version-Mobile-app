@echo off
cd /d "%~dp0"
node scripts\start-local.js
if errorlevel 1 pause
