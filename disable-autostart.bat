@echo off
rem ---------------------------------------------------------------
rem  Remove AXON from the Windows Startup folder.
rem ---------------------------------------------------------------
chcp 437 >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:APPDATA+'\Microsoft\Windows\Start Menu\Programs\Startup\AXON-Web.lnk';if(Test-Path $p){Remove-Item $p -Force;Write-Output 'removed'}else{Write-Output 'not installed'}"
echo Autostart DISABLED.
pause
