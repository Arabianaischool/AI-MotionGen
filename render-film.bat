@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM Long-form film renderer (whole film / one scene / one still)
REM
REM Usage:
REM   render-film.bat "films\MyFilm_2026-01-01T10-00-00"
REM   render-film.bat "films\MyFilm_..." scene s01
REM   render-film.bat "films\MyFilm_..." still s01 3
REM ============================================================

set "SCRIPT_DIR=%~dp0"

if exist "%SCRIPT_DIR%node\node.exe" (
    set "NODE_EXE=%SCRIPT_DIR%node\node.exe"
) else (
    set "NODE_EXE=node"
)

if "%~1"=="" (
    echo.
    echo   Usage:
    echo     render-film.bat "films\FILM_FOLDER"            ^(full film^)
    echo     render-film.bat "films\FILM_FOLDER" scene s01  ^(one scene^)
    echo     render-film.bat "films\FILM_FOLDER" still s01 3 ^(still at second 3^)
    echo.
    pause
    exit /b 1
)

set "PROJECT=%~1"
set "MODE=%~2"
set "SCENE=%~3"
set "TIME=%~4"

if "%MODE%"=="" set "MODE=film"

if /i "%MODE%"=="scene" (
    "%NODE_EXE%" "%SCRIPT_DIR%renderer\render-film.js" --project="%PROJECT%" --mode=scene --scene=%SCENE%
) else if /i "%MODE%"=="still" (
    if "%TIME%"=="" set "TIME=1"
    "%NODE_EXE%" "%SCRIPT_DIR%renderer\render-film.js" --project="%PROJECT%" --mode=still --scene=%SCENE% --time=%TIME%
) else (
    "%NODE_EXE%" "%SCRIPT_DIR%renderer\render-film.js" --project="%PROJECT%" --mode=film
)

set "EXIT_CODE=%ERRORLEVEL%"
echo.
pause
endlocal
exit /b %EXIT_CODE%
