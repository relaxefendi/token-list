@echo off
chcp 65001 >nul
REM Hedef: kullanicinin istedigi masaustu klasoru
set "TARGET=C:\Users\Admin\Desktop\konferans ve dosya paylasimi"
if exist "C:\Users\Admin\Desktop\" (
  set "TARGET=C:\Users\Admin\Desktop\konferans ve dosya paylasimi"
) else (
  set "TARGET=%USERPROFILE%\Desktop\konferans ve dosya paylasimi"
)
echo.
echo Program su klasore kopyalanacak:
echo   %TARGET%
echo.
if not exist "%TARGET%" mkdir "%TARGET%"
xcopy /E /I /Y "%~dp0*" "%TARGET%\"
if errorlevel 1 (
  echo Kopyalama basarisiz. ZIP'i elle su klasore acin:
  echo   C:\Users\Admin\Desktop\konferans ve dosya paylasimi
  pause
  exit /b 1
)
echo.
echo Tamamlandi. Simdi o klasorde KURULUM.bat calistirin.
explorer "%TARGET%"
pause
