@echo off
setlocal
cd /d "%~dp0"

if exist "C:\Program Files\nodejs\node.exe" (
  set "PATH=C:\Program Files\nodejs;%PATH%"
)

if exist "%APPDATA%\npm\pm2.cmd" (
  set "PATH=%APPDATA%\npm;%PATH%"
  call "%APPDATA%\npm\pm2.cmd" resurrect >nul 2>nul
  call "%APPDATA%\npm\pm2.cmd" startOrRestart ecosystem.config.json >nul 2>nul
  call "%APPDATA%\npm\pm2.cmd" save >nul 2>nul
)

timeout /t 8 /nobreak >nul
start "" "http://localhost:3211"
