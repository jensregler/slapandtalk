@echo off
rem Slap and Talk on your own PC (double-click me). Installs what is needed the first time, builds the web
rem app, starts the server on http://localhost:8790 and opens the browser. Close this window to stop it.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed. Install the LTS version from https://nodejs.org ^(22 or newer^),
  echo  then double-click start-local.bat again.
  echo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing what Slap and Talk needs ^(first time only, a minute or two^)...
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo The install failed - see above.
    pause
    exit /b 1
  )
)
node scripts\start-local.js --build %*
pause
