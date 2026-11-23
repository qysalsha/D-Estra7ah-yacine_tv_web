@echo off
REM Yacine TV Web - startup script (run after connecting phone via USB debugging)
set ADB=D:\tools\platform-tools\platform-tools\adb.exe
set DIR=%~dp0

echo Checking device...
%ADB% get-state >nul 2>&1
if errorlevel 1 ( echo [X] No device. Connect phone + enable USB debugging & pause & exit /b 1 )

echo Starting decrypt daemon on phone...
%ADB% shell "cd /data/local/tmp; CLASSPATH=/data/local/tmp/yc.dex nohup app_process /system/bin Daemon </dev/null >daemon.log 2>&1 &"
%ADB% forward tcp:39999 tcp:39999 >nul 2>&1

echo Starting web server on http://localhost:8891 ...
start "" "http://localhost:8891"
cd /d %DIR%
node app.js
