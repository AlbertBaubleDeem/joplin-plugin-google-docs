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
npm run dist

echo "[deploy] Deploying from publish/..."
# With webpack build, we deploy the dist/ folder contents (not the .jpl archive)
rm -rf "$DEST"
mkdir -p "$DEST"
cp -r dist/* "$DEST/"

# Copy .env file for OAuth credentials and GCS settings
if [ -f "$ROOT_DIR/.env" ]; then
  cp "$ROOT_DIR/.env" "$DEST/.env"
  echo "[deploy] Copied .env to destination"
fi

# Optional: copy markdown mapping config
mkdir -p "$DEST/config"
if [ -f "$ROOT_DIR/config/md-mapping.json" ]; then
  cp "$ROOT_DIR/config/md-mapping.json" "$DEST/config/md-mapping.json"
fi

echo "[deploy] Done."
echo "[deploy] JPL file available at: $ROOT_DIR/publish/*.jpl"
