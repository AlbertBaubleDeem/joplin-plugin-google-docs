# joplin-plugin-google-docs

## Local credentials without shell env

Place credentials next to the installed plugin so Joplin does not need to inherit shell environment variables.

- Create these files in the plugin installation directory (e.g. `~/.config/joplin-desktop/plugins/io.github.albertbaubledeem.joplin.google-docs`):
  - `.env` containing:
    - `GOOGLE_CLIENT_ID=...`
    - `GOOGLE_CLIENT_SECRET=...`
    - `GOOGLE_REDIRECT_URI=http://localhost:3000/oauth2callback`
  - `.token.json` containing your OAuth tokens (same format as the `google-api-tests` token file)
- Optional: You can continue to keep credentials under the repo at `google-api-tests/.env` and `google-api-tests/.token.json`. The plugin will fall back to those if files are not found in the plugin directory.
- Optional: You may set `GOOGLE_TOKENS_PATH` in the process environment to override the token file path.

## Mapping/state in plugin directory

- You may place `mapping.json` and `changes.state.json` directly in the plugin directory. The plugin will use them if present.
- If absent, it falls back to `google-api-tests/mapping.json` and `google-api-tests/changes.state.json` under the repo.

## Running the poller command

- Open Joplin Desktop
- Tools → Command palette (Ctrl+P)
- Run: "Google Docs Sync: Poll Once (log-only)"
- View logs in Help → Toggle Developer Tools

## Dev deploy (WSL → Windows profile)

From `plugin/`:

```bash
# create your .env from the example (first time only)
cp ENV.example .env
# edit .env and set JOPLIN_PLUGIN_DEST to your plugins folder

# deploy using .env (no hardcoded paths in repo)
npm run deploy:wsl

# or override destination explicitly
npm run deploy:wsl -- "/path/to/your/plugins/io.github.albertbaubledeem.joplin.google-docs"
```

This does:
- Build with `tsc`
- Writes `dist/manifest.json` and ensures root `index.js` stub
- Copies `dist/*`, root `manifest.json`, `dist/manifest.json`, and `node_modules` to the destination

After copying, restart Joplin Desktop.
