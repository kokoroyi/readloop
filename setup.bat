@echo off
setlocal
set "ROOT=%~dp0"
pushd "%ROOT%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\setup.ps1"
set "CODE=%ERRORLEVEL%"
popd
if not "%CODE%"=="0" (
  echo.
  echo Setup exited with code %CODE%.
  pause
)
exit /b %CODE%
