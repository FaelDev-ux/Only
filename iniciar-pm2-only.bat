@echo off
setlocal
cd /d "%~dp0"

if exist "C:\Program Files\nodejs\node.exe" (
  set "PATH=C:\Program Files\nodejs;%PATH%"
)

if exist "%APPDATA%\npm\pm2.cmd" (
  set "PATH=%APPDATA%\npm;%PATH%"
  set "PM2=%APPDATA%\npm\pm2.cmd"
) else (
  exit /b 1
)

call "%PM2%" resurrect
call "%PM2%" startOrRestart ecosystem.config.json
call "%PM2%" save
