#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")"/.. && pwd)"
pushd "$ROOT_DIR" >/dev/null

# Load optional .env (export all vars while sourcing)
if [ -f .env ]; then
  set -a
  source ./.env
  set +a
fi

# Resolve destination: CLI arg > JOPLIN_PLUGIN_DEST (required)
if [ "${1-}" != "" ]; then
  DEST="$1"
elif [ -n "${JOPLIN_PLUGIN_DEST:-}" ]; then
  DEST="$JOPLIN_PLUGIN_DEST"
else
  echo "[deploy] ERROR: Destination not set. Pass it as an argument or set JOPLIN_PLUGIN_DEST in .env"
  exit 1
fi

echo "[deploy] Destination: $DEST"

echo "[deploy] Building..."
npm run build >/dev/null

echo "[deploy] Syncing files..."
rm -rf "$DEST/dist"
mkdir -p "$DEST/dist"
cp -r dist/* "$DEST/dist/"
cp manifest.json "$DEST/manifest.json"
cp manifest.json "$DEST/dist/manifest.json"
printf "module.exports = require('./dist/index.js');\n" > "$DEST/index.js"

echo "[deploy] Copying runtime deps..."
rm -rf "$DEST/node_modules"
cp -r node_modules "$DEST/"

echo "[deploy] Done."


