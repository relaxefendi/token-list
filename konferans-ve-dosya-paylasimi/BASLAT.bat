@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Bodrum Tarim Portali - Sunucu
where node >nul 2>&1
if errorlevel 1 (
  echo [HATA] Node.js yok. Once KURULUM.bat calistirin / Node.js kurun.
  pause
  exit /b 1
)
if not exist "node_modules\" (
  echo node_modules yok, kurulum yapiliyor...
  call npm install
)
echo.
echo Portal baslatiliyor...
echo Tarayicida: http://localhost:3080
echo Agdaki diger bilgisayarlar: http://BU_BILGISAYAR_IP:3080
echo.
echo Durdurmak icin bu pencerede Ctrl+C basin.
echo.
node server\index.js
pause
