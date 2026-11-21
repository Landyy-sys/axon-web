@echo off
rem ---------------------------------------------------------------
rem  Stop the AXON server (only the process listening on the port).
rem ---------------------------------------------------------------
chcp 437 >nul 2>&1
set PORT=4173
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%PORT% " ^| findstr LISTENING') do (
  echo Killing PID %%P on port %PORT% ...
  taskkill /F /PID %%P >nul 2>&1
)
echo AXON server stopped.
pause
