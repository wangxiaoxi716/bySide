#!/bin/sh
set -eu
root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
source_file="$root_dir/native-voice/AudioBridge.swift"
info_file="$root_dir/native-voice/Info.plist"
build_dir="$root_dir/native-voice/.build"
app_dir="$build_dir/BySideAudio.app"
binary="$app_dir/Contents/MacOS/BySideAudio"
if [ "$(uname -s)" != Darwin ]; then
  printf '%s\n' '本机音频桥目前支持 macOS。' >&2
  exit 1
fi
if [ ! -x "$binary" ] || [ "$source_file" -nt "$binary" ] || [ "$info_file" -nt "$binary" ]; then
  mkdir -p "$app_dir/Contents/MacOS" "$build_dir/module-cache"
  cp "$info_file" "$app_dir/Contents/Info.plist"
  CLANG_MODULE_CACHE_PATH="$build_dir/module-cache" xcrun swiftc -swift-version 5 -O "$source_file" -o "$binary"
  codesign --force --sign - "$app_dir" >/dev/null 2>&1
fi
