@echo off
setlocal
cd /d "%~dp0"
title TW Suite - Dashboard local

where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERRO] Python nao foi encontrado no PATH deste computador.
  echo Instale em https://python.org (marque "Add python.exe to PATH" na instalacao)
  echo ou abra o dashboard.html direto no navegador como alternativa.
  echo.
  pause
  exit /b 1
)

set PORT=8787
echo Verificando se a porta %PORT% esta livre...
netstat -ano | findstr /r /c:"LISTENING" | findstr ":%PORT% " >nul
if not errorlevel 1 (
  echo A porta %PORT% ja esta em uso ^(outro servidor rodando, talvez de um teste anterior^).
  set PORT=8788
  echo Tentando a porta %PORT% no lugar.
)

echo.
echo Iniciando o dashboard em http://localhost:%PORT%/dashboard.html
echo NAO feche esta janela enquanto estiver usando o dashboard.
echo Fechar esta janela desliga o servidor.
echo.

start "" cmd /c "timeout /t 1 >nul & start http://localhost:%PORT%/dashboard.html"
python -m http.server %PORT%

echo.
echo O servidor parou. Se foi um erro (nao voce fechando de proposito), leia a mensagem acima.
pause
