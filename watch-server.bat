@echo off
rem ----------------------------------------------------------------
rem  watch-server.bat - crash-guard loop for server.mjs
rem  Runs the server forever: if it crashes (exit code != 0) it is
rem  restarted after 5 seconds. If it exits cleanly (exit code 0,
rem  meaning "another instance is already serving" or a deliberate
rem  stop), the guard quits instead of fighting the other instance.
rem  This window is normally HIDDEN - started via start-server.bat.
rem ----------------------------------------------------------------
chcp 437 >nul 2>&1
cd /d "%~dp0"
set NODE=C:\Users\40414\.workbuddy\binaries\node\versions\22.22.2\node.exe
if not exist "%NODE%" set NODE=node.exe

:loop
"%NODE%" server.mjs 4173
if errorlevel 1 (
  echo [%date% %time%] server crashed, restarting in 5s... >> server.log
  timeout /t 5 /nobreak >nul
  goto loop
)
echo [%date% %time%] server exited normally, guard stopped. >> server.log
