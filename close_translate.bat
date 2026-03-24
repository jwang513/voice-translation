@echo off
echo Closing Voice Translator...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5000 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
)
taskkill /F /FI "WINDOWTITLE eq Voice Translator" >nul 2>&1
echo Done! Port 5000 freed.
timeout /t 2 >nul
