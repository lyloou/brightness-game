#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Installing npm dependencies..."
npm install

echo ""
echo "==> Compiling set_brightness (requires macOS + Swift)..."

if ! command -v swiftc &>/dev/null; then
  echo "ERROR: swiftc not found. Install Xcode Command Line Tools:"
  echo "  xcode-select --install"
  exit 1
fi

swiftc set_brightness.swift \
  -o set_brightness \
  -F /System/Library/PrivateFrameworks \
  -framework DisplayServices

echo ""
echo "Done. Run ./start.sh to launch the app."
