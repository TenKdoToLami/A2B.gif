#!/usr/bin/env bash
set -e

echo "[BlendForge] Compiling C++20 to WebAssembly via Emscripten..."

if ! command -v emcc &> /dev/null; then
    echo "[ERROR] emcc (Emscripten) not found in PATH!"
    echo "Please install Emscripten SDK and activate it first."
    exit 1
fi

mkdir -p ../web/wasm

emcc -O3 -std=c++20 -flto \
    -Iinclude \
    src/blendforge.cpp \
    --bind \
    -s WASM=1 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s MAXIMUM_MEMORY=1073741824 \
    -s MODULARIZE=1 \
    -s EXPORT_NAME="BlendForgeModule" \
    -s ENVIRONMENT="web,worker" \
    -s NO_EXIT_RUNTIME=1 \
    -o ../web/wasm/blendforge.js

echo "[SUCCESS] WebAssembly module generated in ../web/wasm/"
