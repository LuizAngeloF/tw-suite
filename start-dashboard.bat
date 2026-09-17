@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python nao encontrado no PATH. Instale Python (python.org) ou abra o dashboard.html direto no navegador.
  pause
  exit /b 1
)

echo Iniciando o dashboard em http://localhost:8787/dashboard.html
echo Feche esta janela para desligar o servidor.
echo.

start "" cmd /c "timeout /t 1 >nul & start http://localhost:8787/dashboard.html"
python -m http.server 8787
