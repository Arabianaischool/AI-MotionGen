@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

REM ============================================================
REM أداة عمل موشن جرافيكس بالذكاء الاصطناعي
REM AI Motion Graphics Tool
REM تطوير: براء محمد - قناة مدرسة الذكاء الاصطناعي
REM ============================================================

REM Get the directory where this batch file is located
set "SCRIPT_DIR=%~dp0"

REM Set path to use our portable Node.js
if exist "%SCRIPT_DIR%node\node.exe" (
    set "PATH=%SCRIPT_DIR%node;%PATH%"
    set "NODE_EXE=%SCRIPT_DIR%node\node.exe"
) else (
    REM Fall back to system Node.js
    set "NODE_EXE=node"
)

echo.
echo   ╔════════════════════════════════════════════════════════════════════╗
echo   ║                                                                    ║
echo   ║     🎬 أداة عمل موشن جرافيكس بالذكاء الاصطناعي                     ║
echo   ║     AI Motion Graphics Tool                                        ║
echo   ║                                                                    ║
echo   ║     تطوير: براء محمد - قناة مدرسة الذكاء الاصطناعي                 ║
echo   ║                                                                    ║
echo   ╚════════════════════════════════════════════════════════════════════╝
echo.

REM Start the server
"%NODE_EXE%" "%SCRIPT_DIR%ui\server.js"

REM Keep window open if there's an error
if errorlevel 1 (
    echo.
    echo   ERROR: Failed to start server
    echo.
    pause
)

endlocal
