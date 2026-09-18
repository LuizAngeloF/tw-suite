@echo off
title TW Suite - Dashboard Local
cd /d "%~dp0"

echo ========================================
echo       TW Suite - Dashboard Local
echo ========================================
echo.

echo Verificando Python...
python --version

if errorlevel 1 (
    echo.
    echo [ERRO] Python nao foi encontrado.
    echo.
    echo Verifique se o Python esta instalado.
    echo.
    pause
    exit /b
)

echo.
echo Iniciando servidor local...
echo.

set PORT=8787

echo Dashboard:
echo http://localhost:%PORT%/dashboard.html
echo.
echo Mantenha esta janela aberta enquanto usar o dashboard.
echo Para desligar o servidor, feche esta janela ou pressione CTRL+C.
echo.

start "" "http://localhost:%PORT%/dashboard.html"

python -m http.server %PORT%

echo.
echo Servidor encerrado.
pause