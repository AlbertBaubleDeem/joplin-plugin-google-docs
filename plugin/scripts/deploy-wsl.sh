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
# Ensure runtime index.js that mirrors last working approach
cp runtime/index.js "$DEST/index.js"
cp manifest.json "$DEST/manifest.json"
cp manifest.json "$DEST/dist/manifest.json"

echo "[deploy] Copying runtime deps..."
# Build production-only node_modules in a temp dir to avoid dev bins (e.g., .bin/tsc)
TMP_DIR="$(mktemp -d)"
cp package.json package-lock.json "$TMP_DIR" >/dev/null 2>&1 || true
pushd "$TMP_DIR" >/dev/null
npm ci --omit=dev >/dev/null
popd >/dev/null
rm -rf "$DEST/node_modules"
cp -r "$TMP_DIR/node_modules" "$DEST/"
rm -rf "$TMP_DIR"

# Optional: copy markdown mapping config to enable formatting heuristics (code blocks, etc.)
mkdir -p "$DEST/config"
if [ -f "$ROOT_DIR/../google-api-tests/config/md-mapping.json" ]; then
  cp "$ROOT_DIR/../google-api-tests/config/md-mapping.json" "$DEST/config/md-mapping.json"
fi

echo "[deploy] Done."


