# Joplin Google Docs Sync

Bidirectional sync between Joplin notes and Google Docs. Edit in Joplin, changes appear in Google Docs. Collaborate in Google Docs, pull changes back to Joplin. Includes image support, native list formatting, and Markdown preservation.

**Platform:** Desktop | **Version:** 1.0.0 | **Distribution:** `.jpl` (639KB, all dependencies bundled)

## Features

| Feature | Status |
|---------|--------|
| Push note to Google Doc (with Markdown formatting) | Done |
| Pull Google Doc back to Joplin note | Done |
| Export entire notebook to Google Drive folder | Done |
| Push/Pull sync with conflict detection | Done |
| Image sync (including WebP, AVIF auto-conversion) | Done |
| Background polling for remote changes | Done |
| Sync status icons in note list | Done |
| Setup wizard (OAuth configuration) | Done |
| Bind/unbind notes to existing Docs | Done |
| Import existing Google Docs via Drive picker | Done |

## Markdown conversion

Formats preserved through push and pull:

- Headings (H1-H6)
- Bold, italic, bold+italic
- Inline code and fenced code blocks (with language detection)
- Ordered and unordered lists (with nesting)
- External links and Joplin internal links (`:/resourceId`)
- Images (as text placeholders, or uploaded via GCS)
- Callout blocks (`<note>`, `<info>`, `<warning>`, `<tip>`, `<question>`, `<jarvis>`)
- Soft line breaks within list items

See [Known Issues](https://github.com/AlbertBaubleDeem/joplin-plugin-google-docs/wiki/Known-Issues) for roundtrip limitations.

## Setup

### Prerequisites

1. A Google Cloud project with these APIs enabled:
   - Google Docs API
   - Google Drive API
   - Cloud Storage API (optional, for image sync)

2. OAuth 2.0 credentials (Desktop application type)

### Installation

Install the `.jpl` file from `plugin/publish/` via Joplin **Settings > Plugins > Install from file**.

Or for development: set the plugin path in **Settings > Plugins > Advanced > Development plugins** to the `plugin/` directory.

### Configuration

The plugin includes a setup wizard (**Tools > Google Docs: Setup Wizard**) that walks through OAuth configuration step by step.

### OAuth scopes

- `drive.file` -- create/edit files and access files created or opened by the plugin
- `drive.readonly` -- list all your Google Docs in the import picker (without this, only plugin-created docs appear)
- `documents` -- read/write Google Docs content
- `devstorage.full_control` -- temporary image upload for embedding (optional)

If you already had the plugin installed and the import picker only showed Joplin-created docs, run the setup wizard again (re-authorize) so the new `drive.readonly` scope is granted.

## Repository structure

```
joplin-plugin-google-docs/
  plugin/                    # Joplin plugin (TypeScript)
    src/
      index.ts               # Entry point
      manifest.json           # Plugin metadata
      commands/               # Push, pull, bind, export, wizard
      converters/             # Markdown <-> IR <-> Google Docs
      providers/              # Google Docs API provider
      services/               # Auth, settings, sync context
      tests/                  # Roundtrip and converter tests
    config/                   # User-configurable formatting
    webpack.config.js         # Build configuration
    publish/                  # Built .jpl archive
  google-api-tests/           # Standalone API test scripts (submodule)
```

## Development

```sh
cd plugin
npm install
npm run dist        # Build to dist/ and create .jpl archive
```

The build outputs a `.jpl` file to `plugin/publish/`. All dependencies are bundled via webpack.

### Running tests

```sh
npx tsx src/tests/converter-roundtrip.test.ts   # Offline converter tests (41 tests)
npx tsx src/tests/roundtrip-integration.ts       # Full push-pull via Google Docs API
```

## Documentation

- [Wiki](https://github.com/AlbertBaubleDeem/joplin-plugin-google-docs/wiki) -- Architecture, implementation details, API research
- [Known Issues](https://github.com/AlbertBaubleDeem/joplin-plugin-google-docs/wiki/Known-Issues) -- Roundtrip fidelity limitations
- [List Implementation](https://github.com/AlbertBaubleDeem/joplin-plugin-google-docs/wiki/List-Implementation) -- Native Google Docs list handling
- [Image Sync](https://github.com/AlbertBaubleDeem/joplin-plugin-google-docs/wiki/Image-Sync-Implementation) -- GCS upload and format conversion

## Architecture

Provider-agnostic design. Google Docs is the first backend; interfaces support adding other formats. Sync uses delta detection via Drive Changes API and optimistic concurrency via `requiredRevisionId`.

See [Architecture Overview](https://github.com/AlbertBaubleDeem/joplin-plugin-google-docs/wiki/Architecture-Overview) and [Provider Architecture](https://github.com/AlbertBaubleDeem/joplin-plugin-google-docs/wiki/Provider-Architecture) for details.
