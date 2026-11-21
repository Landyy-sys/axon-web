@echo off
set NODE_HOME=C:\Users\40414\.workbuddy\binaries\node\versions\22.22.2
set PATH=%NODE_HOME%;%PATH%

cd /d "%~dp0"

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install --registry=https://registry.npmmirror.com
  if errorlevel 1 goto fail
)

echo Building production bundle...
call npm run build
if errorlevel 1 goto fail

start "" http://localhost:4173
echo.
echo AXON is running at http://localhost:4173  (Ctrl+C to stop)
echo.
call npm run preview -- --port 4173 --strictPort
goto end

:fail
echo.
echo Build failed. Check the output above.
pause

:end
