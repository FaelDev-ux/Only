@echo off
setlocal
cd /d "%~dp0"
title Impressora Only

if exist "C:\Program Files\nodejs\node.exe" (
  set "PATH=C:\Program Files\nodejs;%PATH%"
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao foi encontrado.
  echo Instale o Node.js ou reinicie o computador para atualizar o PATH.
  echo.
  pause
  exit /b 1
)

if not exist ".env.local" (
  echo [ERRO] O arquivo .env.local nao foi encontrado nesta pasta.
  echo Coloque o .env.local e o JSON da conta de servico do Firebase aqui.
  echo.
  pause
  exit /b 1
)

node teste.mjs

echo.
pause
