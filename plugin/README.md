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
- Write `dist/manifest.json`
- Copy `runtime/index.js` to `<DEST>/index.js` (runtime-first entry that registers commands)
- Copy `dist/*`, root `manifest.json`, and `dist/manifest.json` to `<DEST>/`
- Install production-only `node_modules` via `npm ci --omit=dev` and copy them to `<DEST>/node_modules`
- If present, copy `google-api-tests/config/md-mapping.json` to `<DEST>/config/md-mapping.json`

After copying, restart Joplin Desktop.

## What gets installed (destination folder)

Required at `<DEST>` (e.g., `A:\JoplinProfile\plugins\io.github.albertbaubledeem.joplin.google-docs`):
- `index.js` (from `runtime/index.js`, uses the runtime-first pattern)
- `manifest.json`
- `dist/` (compiled modules: `index.js`, `poller.js`, `mapping.js`, `converter.js`, plus `manifest.json`)
- `node_modules/` (production-only; includes `googleapis`)
- `config/md-mapping.json` (optional, mapping-driven formatting config)
- `.env` and `.token.json` (credentials, if you choose to place them next to the plugin)

## Troubleshooting

- Commands not visible after deploy:
  - Quit and restart Joplin Desktop
  - Delete plugin cache folder: `A:\JoplinProfile\cache\io.github.albertbaubledeem.joplin.google-docs`
  - Ensure `<DEST>/index.js` exists and `manifest.json` has `"main": "index.js"` and `"platforms": ["desktop"]`
- `Cannot find module 'googleapis'` in a command:
  - Confirm `<DEST>/node_modules/googleapis` exists (deploy installs prod-only deps)
- Permission errors when copying to Windows drive from WSL:
  - The deploy script uses plain `cp` (no `chmod`/`install`), which avoids drvfs permission issues
