@echo off
rem ----------------------------------------------------------------
rem  start-server.bat - ONE-CLICK guarded start for the demo.
rem  Double-click it: the server starts HIDDEN in the background
rem  under a crash-guard (auto-restart within ~5s after a crash),
rem  so closing terminal windows will NOT kill the demo.
rem  The browser is opened automatically.
rem ----------------------------------------------------------------
chcp 437 >nul 2>&1
cd /d "%~dp0"

if not exist "%~dp0dist\index.html" (
  echo [!] dist\index.html not found - building now, please wait...
  call npm run build
  if errorlevel 1 (
    echo [X] Build failed. Fix the error and try again.
    pause
    exit /b 1
  )
)

echo Starting AXON server with crash-guard (hidden)...
wscript.exe "%~dp0axon-watch.vbs"

echo Waiting for the server to come up...
set /a tries=0
:wait
timeout /t 1 /nobreak >nul
if exist "%~dp0server.port" goto up
set /a tries+=1
if %tries% lss 15 goto wait
echo [!] Server did not report a port. Check server.log in this folder.
pause
exit /b 1

:up
set /p PORT=<"%~dp0server.port"
start "" "http://localhost:%PORT%/"
echo.
echo  [OK] AXON is running on port %PORT% (hidden + crash-guarded).
echo       LAN:     http://^<this-pc-ip^>:%PORT^/     (run ipconfig to see the IP)
echo       Stop:    stop-web.bat
echo       Firewall for phones/colleagues: open-firewall.bat (once)
echo.
timeout /t 5 >nul
