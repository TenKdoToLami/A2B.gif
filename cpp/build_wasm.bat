@echo off
setlocal

echo [BlendForge] Compiling C++20 to WebAssembly via Emscripten...

where emcc >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] emcc (Emscripten) not found in PATH!
    echo Please install Emscripten SDK (emsdk) and run 'emsdk_env.bat' first.
    exit /b 1
)

if not exist ..\web\wasm mkdir ..\web\wasm

emcc -O3 -std=c++20 -flto ^
    -Iinclude ^
    src/blendforge.cpp ^
    --bind ^
    -s WASM=1 ^
    -s ALLOW_MEMORY_GROWTH=1 ^
    -s MAXIMUM_MEMORY=1073741824 ^
    -s MODULARIZE=1 ^
    -s EXPORT_NAME="BlendForgeModule" ^
    -s ENVIRONMENT="web,worker" ^
    -s NO_EXIT_RUNTIME=1 ^
    -o ../web/wasm/blendforge.js

if %errorlevel% equ 0 (
    echo [SUCCESS] WebAssembly module generated in ../web/wasm/
) else (
    echo [ERROR] Build failed!
)
