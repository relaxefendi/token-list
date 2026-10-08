@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  Bodrum Ilce Tarim Mudurlugu - Kurulum
echo  Konferans ve Dosya Paylasimi Portali
echo ============================================
echo.
where node >nul 2>&1
if errorlevel 1 (
  echo [HATA] Node.js bulunamadi.
  echo Lutfen https://nodejs.org adresinden LTS surumunu kurun.
  echo Kurulumdan sonra bu dosyayi tekrar calistirin.
  pause
  exit /b 1
)
echo Node.js bulundu:
node -v
echo.
echo Bagimliliklar yukleniyor (npm install)...
call npm install
if errorlevel 1 (
  echo [HATA] npm install basarisiz.
  pause
  exit /b 1
)
echo.
echo Kurulum tamam. Sunucuyu baslatmak icin BASLAT.bat dosyasina cift tiklayin.
pause
