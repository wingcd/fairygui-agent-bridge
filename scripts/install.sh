#!/usr/bin/env bash
# Install the agent-bridge plugin into a FairyGUI editor project.
# usage: install.sh <path-to-project-dir-containing-.fairy-file>
set -euo pipefail

if [ $# -lt 1 ]; then
    echo "usage: install.sh <path-to-fairygui-project-dir>" >&2
    exit 1
fi
SRC="$(cd "$(dirname "$0")/.." && pwd)/plugin"
DST="$1/plugins/agent-bridge"
if [ ! -d "$1" ]; then
    echo "project dir not found: $1" >&2
    exit 1
fi
mkdir -p "$DST"
cp "$SRC/package.json" "$SRC/main.js" "$DST/"
echo "installed to $DST"
echo "open (or restart) the project in FairyGUI editor, then:"
echo "  curl -X POST http://localhost:7531/ -d '{\"cmd\":\"ping\"}'"
