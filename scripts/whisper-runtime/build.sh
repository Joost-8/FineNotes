#!/usr/bin/env bash
# Build FineNotes' speech recognizer runtime: whisper.cpp at a pinned commit,
# compiled to one single-threaded WebAssembly module with SIMD.
#
#   EMSDK=/path/to/emsdk WHISPER_DIR=/path/to/whisper.cpp ./build.sh
#
# Needs emsdk (activated version below), cmake and ninja (pip install cmake
# ninja). Writes out/fn-whisper.js and prints its size and SHA-256, which go
# into src/audio/speech-models.ts. Rebuilding from the same commit and emsdk
# gives the same bytes.
set -euo pipefail

EMSDK_VERSION=4.0.15
WHISPER_COMMIT=0c7be696371069e0baa2515ed7aa08d5a5473aa6

here="$(cd "$(dirname "$0")" && pwd)"
: "${EMSDK:?set EMSDK to an emsdk checkout}"
: "${WHISPER_DIR:?set WHISPER_DIR to a whisper.cpp checkout}"

git -C "$WHISPER_DIR" fetch -q --depth 1 origin "$WHISPER_COMMIT" 2>/dev/null || true
git -C "$WHISPER_DIR" checkout -q "$WHISPER_COMMIT"
# whisper.cpp forces -pthread for Emscripten; a threaded module needs
# SharedArrayBuffer, which Obsidian does not have. Build without it.
git -C "$WHISPER_DIR" checkout -q -- CMakeLists.txt
sed -i '/set(CMAKE_C_FLAGS   "${CMAKE_C_FLAGS}   -pthread")/d; /set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -pthread")/d' \
  "$WHISPER_DIR/CMakeLists.txt"

# emsdk_env.sh looks for `python3`, which Windows does not have; put the
# compiler on the PATH directly.
export PATH="$EMSDK/upstream/emscripten:$PATH"
export EMSDK_PYTHON="${EMSDK_PYTHON:-$(command -v python || command -v python3)}"
emcc --version | head -1 | grep -q "$EMSDK_VERSION" || { echo "emsdk $EMSDK_VERSION expected" >&2; exit 1; }

build="$here/.build"
"$EMSDK_PYTHON" "$EMSDK/upstream/emscripten/emcmake.py" cmake -S "$here" -B "$build" -G Ninja -DCMAKE_BUILD_TYPE=Release -DWHISPER_DIR="$WHISPER_DIR" >/dev/null
cmake --build "$build" --target fn-whisper
mkdir -p "$here/out"
cp "$build/fn-whisper.js" "$here/out/fn-whisper.js"
git -C "$WHISPER_DIR" checkout -q -- CMakeLists.txt

ls -l "$here/out/fn-whisper.js"
sha256sum "$here/out/fn-whisper.js"
