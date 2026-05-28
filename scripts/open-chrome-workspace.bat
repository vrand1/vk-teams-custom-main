@echo off
REM Reliable path: normal Chrome + installed extension (not Electron).
REM 1) chrome://extensions -> Load unpacked -> repo folder
REM 2) Open extension popup -> Activate
REM 3) Run this bat

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if not exist "%CHROME%" (
  echo Chrome not found.
  pause
  exit /b 1
)

start "" "%CHROME%" --app=https://myteam.mail.ru/webim/
echo Opened MyTeam. Extension must be installed and activated in this Chrome profile.
