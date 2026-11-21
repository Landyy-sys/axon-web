@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

set NODE_HOME=C:\Users\40414\.workbuddy\binaries\node\versions\22.22.2
set "PATH=%NODE_HOME%;%PATH%"
set PORT=4173

cd /d "%~dp0"

rem ---- 1) self-elevate: firewall rules need admin rights ----
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting administrator privileges to open firewall port %PORT% ...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  goto :eof
)

rem ---- 2) open the port in Windows Firewall (all profiles) ----
netsh advfirewall firewall show rule name="AXON-LAN-%PORT%" >nul 2>&1
if %errorlevel% neq 0 (
  netsh advfirewall firewall add rule name="AXON-LAN-%PORT%" dir=in action=allow protocol=TCP localport=%PORT% profile=any >nul
  echo [OK] Firewall rule AXON-LAN-%PORT% added.
) else (
  echo [OK] Firewall rule AXON-LAN-%PORT% already exists.
)
netsh advfirewall firewall set rule name="AXON-LAN-%PORT%" new enable=yes >nul 2>&1

rem ---- 3) make sure there is something to serve ----
if not exist "dist\index.html" (
  echo Building production bundle...
  call npm run build
  if errorlevel 1 goto fail
)

rem ---- 4) optional: make it come back after reboot/sign-in ----
if not exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\AXON-Web.lnk" (
  echo.
  echo TIP: run enable-autostart.bat once to auto-start this site at sign-in.
  echo.
)

start "" http://localhost:%PORT%/
echo Serving %~dp0dist  on  0.0.0.0:%PORT%
echo Ctrl+C to stop.
echo.
call node server.mjs %PORT%
goto :eof

:fail
echo.
echo Build failed. See the output above.
pause
