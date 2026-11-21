@echo off
rem ---------------------------------------------------------------
rem  Install AXON into the Windows Startup folder.
rem  User-level folder - NO administrator rights needed.
rem  From now on the site comes up automatically at sign-in.
rem ---------------------------------------------------------------
chcp 437 >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws=New-Object -ComObject WScript.Shell;$p=$env:APPDATA+'\Microsoft\Windows\Start Menu\Programs\Startup\AXON-Web.lnk';$l=$ws.CreateShortcut($p);$l.TargetPath='%~dp0axon-web.vbs';$l.WorkingDirectory='%~dp0';$l.Description='AXON building prototype web server';$l.Save();Write-Output ('shortcut -> '+$p)"
echo.
echo Autostart ENABLED. It will launch at your next Windows sign-in.
echo To undo later, run disable-autostart.bat
echo.
pause
