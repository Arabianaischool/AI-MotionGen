@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM Remotion Video Renderer
REM Render TSX composition files to MP4 videos
REM
REM Usage:
REM   render.bat input.tsx [output.mp4]
REM   Or drag-and-drop a .tsx file onto this batch file
REM ============================================================

REM Get the directory where this batch file is located
set "SCRIPT_DIR=%~dp0"

REM Set path to use our portable Node.js (if it exists)
if exist "%SCRIPT_DIR%node\node.exe" (
    set "PATH=%SCRIPT_DIR%node;%PATH%"
    set "NODE_EXE=%SCRIPT_DIR%node\node.exe"
) else (
    REM Fall back to system Node.js
    set "NODE_EXE=node"
)

REM Check if a file was provided (either drag-drop or command line)
if "%~1"=="" (
    echo.
    echo   ==================================================
    echo   Remotion Video Renderer
    echo   ==================================================
    echo.
    echo   Usage:
    echo     render.bat input.tsx [output.mp4]
    echo.
    echo   Or drag-and-drop a .tsx file onto render.bat
    echo.
    echo   Examples:
    echo     render.bat MyVideo.tsx
    echo     render.bat MyVideo.tsx output.mp4
    echo     render.bat "C:\My Folder\video.tsx"
    echo.
    pause
    exit /b 1
)

REM Check if file exists
if not exist "%~1" (
    echo.
    echo   ERROR: File not found: %~1
    echo.
    pause
    exit /b 1
)

REM Check file extension
set "FILE_EXT=%~x1"
if /i not "%FILE_EXT%"==".tsx" (
    echo.
    echo   ERROR: File must be a .tsx file, got: %FILE_EXT%
    echo.
    pause
    exit /b 1
)

REM Build the command with proper argument handling
set "INPUT_FILE=%~1"
set "OUTPUT_FILE=%~2"

if "%OUTPUT_FILE%"=="" (
    "%NODE_EXE%" "%SCRIPT_DIR%renderer\render-cli.js" --input="%INPUT_FILE%"
) else (
    "%NODE_EXE%" "%SCRIPT_DIR%renderer\render-cli.js" --input="%INPUT_FILE%" --output="%OUTPUT_FILE%"
)

set "EXIT_CODE=%ERRORLEVEL%"

REM If we were opened by drag-and-drop (double-click), pause so user can see output
REM This detects if the script was started from Explorer vs command line
echo %cmdcmdline% | find /i "%~0" >nul
if not errorlevel 1 (
    echo.
    pause
)

endlocal
exit /b %EXIT_CODE%
