@echo off
rem Initializes the Rust + MSVC build environment, then runs the passed command.
rem Usage: tools\dev-env.cmd cargo build  /  tools\dev-env.cmd cargo test ...
setlocal EnableDelayedExpansion
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSPATH=%%i"
if not defined VSPATH (
  echo ERROR: could not locate Visual Studio with the VC++ toolset via vswhere. 1>&2
  exit /b 9009
)
call "%VSPATH%\VC\Auxiliary\Build\vcvars64.bat" >nul
%*
