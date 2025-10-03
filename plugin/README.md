# joplin-plugin-google-docs

## Local credentials without shell env

Place credentials next to the installed plugin so Joplin does not need to inherit shell environment variables.

- Create these files in the plugin installation directory (e.g. `~/.config/joplin-desktop/plugins/io.github.albertbaubledeem.joplin.google-docs`):
  - `.env` containing:
    - `GOOGLE_CLIENT_ID=...`
    - `GOOGLE_CLIENT_SECRET=...`
    - `GOOGLE_REDIRECT_URI=http://localhost:3000/oauth2callback`
    - `GOOGLE_SYNC_FOLDER_ID=...` (Drive folder to scan for Auto Pair)
  - `.token.json` containing your OAuth tokens (same format as the `google-api-tests` token file)
- Optional: You can continue to keep credentials under the repo at `google-api-tests/.env` and `google-api-tests/.token.json`. The plugin will fall back to those if files are not found in the plugin directory.
- Optional: You may set `GOOGLE_TOKENS_PATH` in the process environment to override the token file path.

## OAuth scopes (required)

Enable these APIs in your Google Cloud project and authorize with the following scopes:

- Drive API: `https://www.googleapis.com/auth/drive` (required to write appProperties on existing Docs and list files in the sync folder)
- Docs API: `https://www.googleapis.com/auth/documents` (read/write Docs content)

Re-auth steps:

1. Update OAuth consent screen to include the two scopes above, save and re-publish if needed.
2. Delete the plugin’s `.token.json` (so a new token is issued with the updated scopes).
3. Re-authorize using your existing token generation flow (or OAuth Playground) and place the new `.token.json` in the plugin install directory.
4. Restart Joplin.

## Mapping/state in plugin directory

- You may place `mapping.json` and `changes.state.json` directly in the plugin directory. The plugin will use them if present.
- If absent, it falls back to `google-api-tests/mapping.json` and `google-api-tests/changes.state.json` under the repo.

## Running the poller command

- Open Joplin Desktop
- Tools → Command palette (Ctrl+P)
- Run: "Google Docs Sync: Poll Once (log-only)"
- View logs in Help → Toggle Developer Tools

## Auto Pair (appProperties-only mapping)

- Configure a Drive folder by setting `GOOGLE_SYNC_FOLDER_ID` in `.env` next to the installed plugin.
- In Joplin: Tools → Command palette → "Google Docs Sync: Auto Pair Folder".
- Behavior:
  - For each Google Doc in the folder:
    - If it has `appProperties.joplinNoteId`, ensure a local mapping for that note→file.
    - If it has no `joplinNoteId`, create a new note (in the current note's notebook if one is selected, otherwise the first notebook), bind it, and write `joplinNoteId` back to Drive appProperties.
  - No title matching is used; mapping is Drive appProperties + local mapping.json.

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
