@echo off
setlocal
set "ROOT=%~dp0.."
pushd "%ROOT%"

set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo [ERROR] csc.exe not found. .NET Framework 4.x is required.
  popd
  exit /b 1
)

if not exist "tray\Tray.cs" (
  echo [ERROR] tray\Tray.cs is missing.
  popd
  exit /b 1
)

set "ICON="
if exist "tray\ReadLoop.ico" set "ICON=/win32icon:tray\ReadLoop.ico"

echo [tray] compiling ReadLoopTray.exe ...
"%CSC%" /nologo /target:winexe /optimize+ /platform:anycpu /out:tray\ReadLoopTray.exe %ICON% /r:System.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll tray\Tray.cs

if errorlevel 1 (
  echo [ERROR] tray build failed.
  popd
  exit /b 1
)

echo [tray] done: tray\ReadLoopTray.exe
popd
exit /b 0
