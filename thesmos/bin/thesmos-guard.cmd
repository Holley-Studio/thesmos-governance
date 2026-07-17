@echo off
REM Thin Windows wrapper — governance logic lives in dist\thesmos-guard.js only.
setlocal
set "SCRIPT_DIR=%~dp0"
node "%SCRIPT_DIR%..\dist\thesmos-guard.js" %*
exit /b %ERRORLEVEL%
