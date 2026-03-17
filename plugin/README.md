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

### Configuration (GUI)

Use the setup wizard above, or enter Client ID and Client Secret in **Settings > Google Docs Sync** and complete authorization when prompted. 

**Manual fallback:** In the plugin data directory (e.g. `~/.config/joplin-desktop/plugins/io.github.albertbaubledeem.joplin.google-docs/`), you can place `.env` (with `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`) and `.token.json` (OAuth tokens) instead.

### OAuth scopes

Enable these APIs in your Google Cloud project:

- **Drive API** (`drive.file`) -- files created by the plugin or explicitly selected
- **Docs API** (`documents`) -- read/write document content
- **Cloud Storage API** (`devstorage.full_control`) -- optional, for image sync

## Formatting configuration

User-customizable formatting lives in `md-mapping.json` in the plugin data directory. The plugin copies a default from `config/md-mapping.json` on first run. Edit the copy to customize:

- Heading styles and list markers
- **Code blocks:** font family (`code.monoFont`), font size in pt (`code.fontSize`), and foreground color (`code.foregroundColor`, hex e.g. `#333333`). Use `0` or empty for defaults.

## Multi-tab Google Docs

Importing a Doc with multiple tabs (via **Tools > Google Docs Sync: Import/Bind**) creates a Joplin notebook with one note per tab; each note syncs with its tab. The Google Docs API does not support creating tabs, so "Export Notebook" on such a notebook creates separate Google Docs in a folder, not a single multi-tab document. The import-complete dialog explains this.

## Import behaviour

When pulling a Google Doc into Joplin, consecutive paragraphs that form a single code block in the Doc are merged into one fenced code block in Markdown.

## Changelog

### 1.0.3

- **Fix: OAuth tokens survive plugin reinstalls.** Tokens and credentials are now stored in the persistent data directory instead of the ephemeral install cache.
- **Fix: multi-tab push targets the correct tab.** Previously all pushes went to the first tab regardless of binding; the Google Docs API request traversal now correctly injects `tabId`.
- **Fix: metadata fetch errors no longer overwrite local edits.** When the poller cannot retrieve document metadata it now skips the note instead of force-pulling.
- **Fix: imported documents no longer cause "File not found" during polling.** Added Shared Drive support to metadata lookups.
- Added Google Doc screenshot to the plugin listing.

### 1.0.2

- Initial public release on npm.

## Troubleshooting

- **Commands not visible:** Quit and restart Joplin completely (File > Quit). Delete the plugin cache folder if needed.
- **Auth errors after token expiry:** Run **Tools > Google Docs: Re-authorize** or delete `.token.json` and re-run the setup wizard.
- **Push fails with index errors:** Ensure you're running the latest build (`npm run dist`). List index calculation has been fixed for documents with multiple nested lists.
