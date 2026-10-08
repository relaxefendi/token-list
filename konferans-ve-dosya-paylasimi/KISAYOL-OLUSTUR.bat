@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Ortak klasor kisayolu olusturuluyor...
node scripts\create-shortcut.js %1
echo.
echo "kisayol" klasorunu ag paylasimina kopyalayin.
echo Personel .url veya .bat dosyasina cift tiklayarak baglanir.
pause
