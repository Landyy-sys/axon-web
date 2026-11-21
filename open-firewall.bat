@echo off
rem ----------------------------------------------------------------
rem  open-firewall.bat - allow inbound TCP 4173 in Windows Firewall
rem  NOTE: right-click -> "Run as administrator" if auto-elevation
rem        is blocked by your group policy.
rem ----------------------------------------------------------------
chcp 437 >nul 2>&1
setlocal
set PORT=4173
set RULE=AXON-LAN-%PORT%

rem ---- self-elevate when not admin (UAC prompt will appear) ----
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo.
  echo  Please click YES on the UAC prompt - admin rights are required
  echo  to change Windows Firewall rules.
  echo  (Or right-click this file - Run as administrator.)
  echo.
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  goto :eof
)

rem ---- add / enable the allow rule (all network profiles) ----
netsh advfirewall firewall show rule name="%RULE%" >nul 2>&1
if %errorlevel% neq 0 (
  netsh advfirewall firewall add rule name="%RULE%" dir=in action=allow protocol=TCP localport=%PORT% profile=any >nul
  echo [OK] Rule "%RULE%" created: inbound TCP %PORT% allowed.
) else (
  echo [OK] Rule "%RULE%" already exists, re-enabling it.
)
netsh advfirewall firewall set rule name="%RULE%" new enable=yes >nul 2>&1

echo.
echo Done. Phones and colleagues on the same Wi-Fi can now reach
echo      http://^<this-pc-ip^>:%PORT^/
echo Check this PC's IP with:  ipconfig   (look for IPv4 Address)
echo.
pause
