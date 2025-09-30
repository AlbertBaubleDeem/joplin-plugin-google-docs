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

# Write a runtime index.js that registers commands at root and lazily loads poller/googleapis
cat > "$DEST/index.js" << 'RUNTIME_INDEX'
console.warn('[gdocs] root index executing');
(function(){
  try {
    const j = (typeof globalThis !== 'undefined' && globalThis.joplin) ? globalThis.joplin : (typeof joplin !== 'undefined' ? joplin : null);
    if (!j) { return; }

    async function pollOnce() {
      try {
        const path = require('path');
        const fs = require('fs');
        const installDir = (await j.plugins.installationDir()) || '';
        const googleapisPath = path.resolve(installDir, 'node_modules/googleapis');
        const { google } = require(googleapisPath);
        const pollerPath = path.resolve(installDir, 'dist/poller.js');
        const { MinimalPoller } = require(pollerPath);
        const envPath = path.resolve(installDir, '.env');
        const tokenPath = path.resolve(installDir, '.token.json');
        if (fs.existsSync(envPath)) {
          const env = fs.readFileSync(envPath, 'utf8');
          for (const line of env.split('\n')) {
            const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
            if (m) process.env[m[1]] = m[2];
          }
        }
        const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
        const auth = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI,
        );
        auth.setCredentials(tokens);
        const poller = new MinimalPoller(installDir);
        const maybe = await poller.initIfNeeded(auth);
        if (maybe === null) { await j.views.dialogs.showMessageBox('Initialized Drive pageToken. Run Poll Once again.'); return; }
        await poller.processOnce(auth);
        await j.views.dialogs.showMessageBox('Poll completed (log-only). Check mapping/state.');
      } catch (e) {
        const msg = (e && e.response && e.response.data) || (e && e.message) || String(e);
        await j.views.dialogs.showMessageBox('Poll error: ' + msg);
      }
    }

    j.plugins.register({
      onStart: async () => {
        await j.commands.register({ name: 'gdocsHello', label: 'Google Docs Sync: Hello', execute: async () => { await j.views.dialogs.showMessageBox('Google Docs plugin is active.'); } });
        await j.commands.register({ name: 'gdocsPollOnce', label: 'Google Docs Sync: Poll Once (log-only)', execute: async () => { await pollOnce(); } });
        await j.views.menuItems.create('gdocsHelloMenu','gdocsHello', j.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Hello' });
        await j.views.menuItems.create('gdocsPollOnceMenu','gdocsPollOnce', j.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Poll Once (log-only)' });
      },
    });
  } catch (_) { /* ignore */ }
})();
RUNTIME_INDEX

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

echo "[deploy] Done."


