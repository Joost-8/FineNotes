cmake_minimum_required(VERSION 3.16)
project(fn_whisper C CXX)

# whisper.cpp, checked out by build.sh at the pinned commit, built without
# threads (see the patch in build.sh) and with WebAssembly SIMD.
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
# Emscripten's toolchain says x86, and ggml then builds its generic kernels
# without SIMD; "wasm32" selects ggml-cpu/arch/wasm.
set(CMAKE_SYSTEM_PROCESSOR wasm32)
add_subdirectory(${WHISPER_DIR} whisper EXCLUDE_FROM_ALL)

add_executable(fn-whisper fn_whisper.c)
target_link_libraries(fn-whisper PRIVATE whisper)
target_compile_options(fn-whisper PRIVATE -O3 -msimd128)

# One ES-free script that defines `createWhisper`, with the wasm embedded
# (SINGLE_FILE), so the worker starts it from a string: no file URL to fetch.
set_target_properties(fn-whisper PROPERTIES SUFFIX ".js" LINK_FLAGS " \
  -O3 -msimd128 \
  -s MODULARIZE=1 -s EXPORT_NAME=createWhisper \
  -s ENVIRONMENT=worker,node \
  -s SINGLE_FILE=1 \
  -s FILESYSTEM=0 \
  -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=64MB -s MAXIMUM_MEMORY=2GB \
  -s STACK_SIZE=5MB \
  -s EXPORTED_FUNCTIONS=['_fn_configure','_fn_malloc','_fn_free','_fn_init','_fn_release','_fn_is_multilingual','_fn_transcribe','_fn_language','_fn_segment_text','_fn_segment_t0','_fn_segment_t1','_fn_segment_no_speech'] \
  -s EXPORTED_RUNTIME_METHODS=['HEAPU8','HEAPF32','UTF8ToString','stringToUTF8','lengthBytesUTF8'] \
  ")
