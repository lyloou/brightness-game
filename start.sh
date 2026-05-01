#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f set_brightness ]; then
  echo "ERROR: set_brightness binary not found. Run ./install.sh first."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "ERROR: node_modules not found. Run ./install.sh first."
  exit 1
fi

echo "==> Starting Brightness Game at http://localhost:3000"
node server.js
