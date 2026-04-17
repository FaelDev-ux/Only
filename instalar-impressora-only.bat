@echo off
setlocal
cd /d "%~dp0"
title Instalacao da Impressora Only

echo ==========================================
echo   Instalacao da Impressora Only via PM2
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao foi encontrado.
  echo Instale o Node.js antes de continuar.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERRO] npm nao foi encontrado.
  echo Instale o Node.js antes de continuar.
  pause
  exit /b 1
)

if not exist ".env.local" (
  echo [ERRO] O arquivo .env.local nao foi encontrado nesta pasta.
  echo Crie o .env.local antes de rodar este instalador.
  pause
  exit /b 1
)

findstr /b /c:"FIREBASE_SERVICE_ACCOUNT_KEY_PATH=" ".env.local" >nul
if errorlevel 1 (
  echo [ERRO] FIREBASE_SERVICE_ACCOUNT_KEY_PATH nao foi encontrado no .env.local
  pause
  exit /b 1
)

for /f "tokens=1,* delims==" %%A in ('findstr /b /c:"FIREBASE_SERVICE_ACCOUNT_KEY_PATH=" ".env.local"') do set "SERVICE_ACCOUNT_FILE=%%B"

if not exist "%SERVICE_ACCOUNT_FILE%" (
  echo [ERRO] O arquivo de conta de servico "%SERVICE_ACCOUNT_FILE%" nao foi encontrado nesta pasta.
  pause
  exit /b 1
)

echo [1/6] Instalando dependencias do projeto...
call npm install
if errorlevel 1 goto :fail

echo [2/6] Instalando PM2...
call npm install -g pm2
if errorlevel 1 goto :fail

echo [3/6] Instalando PM2 Windows Startup...
call npm install -g pm2-windows-startup
if errorlevel 1 goto :fail

echo [4/6] Ativando inicio automatico do PM2 no Windows...
call pm2-startup install
if errorlevel 1 goto :fail

echo [5/6] Subindo os processos da impressora...
call pm2 start ecosystem.config.json
if errorlevel 1 goto :fail

echo [6/6] Salvando a configuracao do PM2...
call pm2 save
if errorlevel 1 goto :fail

echo.
echo ==========================================
echo   Instalacao concluida com sucesso
echo ==========================================
echo.
echo Painel: http://localhost:3211
echo.
call pm2 status
echo.
pause
exit /b 0

:fail
echo.
echo [ERRO] A instalacao nao foi concluida.
echo Verifique as mensagens acima e tente novamente.
echo.
pause
exit /b 1
