# Changelog

## 1.0.4

### Table roundtrip
- **Tables:** Full Markdown table roundtrip (push and pull). Push uses Google Docs InsertTableRequest plus per-cell insertText (reverse index order); pull converts Docs tables to GFM Markdown with column-aligned formatting.
- **Multiline cells:** Cell content with line breaks uses `<br>` in Markdown and `\n` in Docs/IR; pull joins cell paragraphs with `\n`, roundtrip uses `<br>` without surrounding spaces to avoid space growth.

### Other
- Screenshots (screenshot_doc.png, screenshot_wizard.png) at repo root for plugin listing display.

## 1.0.0

Full bidirectional sync between Joplin notes and Google Docs.

### Features
- Push notes to Google Docs with Markdown formatting (headings, bold/italic, code blocks, lists, links, images)
- Pull Google Docs content back to Joplin notes
- Export entire notebooks to Google Drive folders
- Background polling for remote changes via Drive Changes API
- Sync status icons in note list
- Setup wizard for OAuth configuration
- Bind/unbind notes to existing Google Docs
- Import existing Google Docs via Drive picker dialog
- Image sync via Google Cloud Storage (with WebP/AVIF auto-conversion)
- Multi-note push/pull/unbind from selection
- Callout block support (note, info, warning, tip, question, jarvis)
- Native Google Docs list support (ordered, unordered, nested)
- Configurable formatting via md-mapping.json

### Architecture
- Provider-agnostic design (IDocumentProvider, IFormatConverter interfaces)
- Intermediate Representation (IR) for bidirectional Markdown conversion
- Delta sync via Drive Changes API with optimistic concurrency
- Webpack bundling with all dependencies in a single .jpl file (639KB)

### Recent fixes
- Fix list boundary bug: cumulative tab offset for multi-list documents
- Fix content after lists being absorbed into the list
- Preserve Joplin internal links (:/resourceId) through roundtrip
- Reduce extra blank lines on pull using hasPrecedingSeparator detection
- Fix ordered list detection on pull (NUMBERED_DECIMAL_NESTED)
- Add soft line breaks for multi-line list items (images within bullets)
- Add tip callout type

### Code quality
- Align with Joplin coding standards (camelCase constants, arrow functions, named imports)
- 41 offline converter tests + full push-pull integration test
- Known issues documented in wiki
