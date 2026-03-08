# Google Docs Sync - Plugin

## Installation

**From .jpl file:** In Joplin, go to **Settings > Plugins > Install from file** and select the `.jpl` from `publish/`.

**Development mode:** Set the path to this `plugin/` directory in **Settings > Plugins > Advanced > Development plugins**, then restart Joplin.

## Configuration

### Setup wizard

Run **Tools > Google Docs: Setup Wizard** for guided OAuth configuration. The wizard walks through:
1. Creating a Google Cloud project
2. Enabling required APIs
3. Configuring OAuth consent screen
4. Entering client credentials
5. Authorizing the plugin
6. Setting up a sync folder

### Manual configuration

Place credentials in the plugin data directory (`~/.config/joplin-desktop/plugins/io.github.albertbaubledeem.joplin.google-docs/`):

- `.env` with `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- `.token.json` with OAuth tokens

Alternatively, enter Client ID and Client Secret in **Settings > Google Docs Sync**.

### OAuth scopes

Enable these APIs in your Google Cloud project:

- **Drive API** (`drive.file`) -- files created by the plugin or explicitly selected
- **Docs API** (`documents`) -- read/write document content
- **Cloud Storage API** (`devstorage.full_control`) -- optional, for image sync

## Building

```sh
npm install
npm run dist
```

This compiles TypeScript, bundles all dependencies via webpack, and creates a `.jpl` archive in `publish/`.

### WSL deployment

```sh
npm run deploy:wsl
```

Copies the built plugin to the Joplin plugins directory configured in `.env` (`JOPLIN_PLUGIN_DEST`).

## Formatting configuration

User-customizable formatting lives in `config/md-mapping.json`. The plugin copies a default config to its data directory on first run. Edit the copy there to customize heading styles, code block appearance, and list markers.

## Troubleshooting

- **Commands not visible:** Quit and restart Joplin completely (File > Quit). Delete the plugin cache folder if needed.
- **Auth errors after token expiry:** Run **Tools > Google Docs: Re-authorize** or delete `.token.json` and re-run the setup wizard.
- **Push fails with index errors:** Ensure you're running the latest build (`npm run dist`). List index calculation has been fixed for documents with multiple nested lists.
