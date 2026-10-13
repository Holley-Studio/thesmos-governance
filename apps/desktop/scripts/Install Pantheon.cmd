@echo off
rem First install of Pantheon on a PC. Double-click this file from the release folder.
rem Later updates are offered inside the app.
title Install Pantheon
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Pantheon.ps1" -ChannelDir "%~dp0." -Launch
if errorlevel 1 (
  echo.
  echo Pantheon was not installed. See the message above.
) else (
  echo.
  echo Pantheon is installed. A shortcut is on your desktop.
)
pause
