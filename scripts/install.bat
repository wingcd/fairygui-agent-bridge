@echo off
rem Install the agent-bridge plugin into a FairyGUI editor project.
rem usage: install.bat <path-to-project-dir-containing-.fairy-file>
rem example: install.bat D:\work\my-ui-project

setlocal
if "%~1"=="" (
  echo usage: install.bat ^<path-to-fairygui-project-dir^>
  exit /b 1
)
set "SRC=%~dp0..\plugin"
set "DST=%~1\plugins\agent-bridge"
if not exist "%~1" (
  echo project dir not found: %~1
  exit /b 1
)
mkdir "%DST%" 2>nul
copy /y "%SRC%\package.json" "%DST%\" >nul
copy /y "%SRC%\main.js" "%DST%\" >nul
echo installed to %DST%
echo open (or restart) the project in FairyGUI editor, then:
echo   curl -X POST http://localhost:7531/ -d "{\"cmd\":\"ping\"}"
endlocal
