@echo off
rem ---------------------------------------------------------------
rem  AXON web - start the site (ASCII only, keeps cmd happy)
rem  Double-click this file: it starts the server hidden in the
rem  background and opens your browser. Close nothing - there is
rem  no console window to keep.
rem ---------------------------------------------------------------
chcp 437 >nul 2>&1
cd /d "%~dp0"

if not exist "%~dp0dist\index.html" (
  echo [!] dist\index.html not found - building now, please wait...
  call npm run build
  if errorlevel 1 (
    echo [X] Build failed.
    pause
    exit /b 1
  )
)

echo Starting AXON server...
wscript.exe "%~dp0axon-web.vbs" open
echo Done. If the browser did not open, visit the address above manually.
timeout /t 3 >nul
