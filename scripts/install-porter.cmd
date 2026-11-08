@echo off
setlocal
rem Install dsh-plugin-porter on an isolated intranet machine.
rem No npm / pnpm / network required. Put this file next to install-porter.ps1
rem and the porter\ directory (the export root layout).

set "SCRIPT_DIR=%~dp0"
set "PS1=%SCRIPT_DIR%install-porter.ps1"

if not exist "%PS1%" (
  echo [ERROR] install-porter.ps1 not found next to this file: %PS1%
  exit /b 1
)

where pwsh >nul 2>nul
if %errorlevel%==0 (
  pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
) else (
  powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
)
exit /b %errorlevel%
