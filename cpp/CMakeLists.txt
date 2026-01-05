cmake_minimum_required(VERSION 3.20)
project(BlendForge LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include_directories(include)

if(EMSCRIPTEN)
    add_executable(blendforge
        src/blendforge.cpp
    )

    set_target_properties(blendforge PROPERTIES
        OUTPUT_NAME "blendforge"
        SUFFIX ".js"
    )

    target_compile_options(blendforge PRIVATE
        -O3
        -flto
    )

    target_link_options(blendforge PRIVATE
        -O3
        -flto
        --bind
        -s WASM=1
        -s ALLOW_MEMORY_GROWTH=1
        -s MAXIMUM_MEMORY=1073741824
        -s MODULARIZE=1
        -s EXPORT_NAME="BlendForgeModule"
        -s ENVIRONMENT="web,worker"
        -s NO_EXIT_RUNTIME=1
    )
else()
    # Native test build
    add_executable(blendforge_cli
        src/blendforge.cpp
    )
endif()
