# Changelog

## 1.0.6

### Table stability rewrite
- **Push: reverse table insertion.** Tables are now inserted in reverse document order using `location.index` instead of `endOfSegmentLocation`. All text is inserted in a single pass first, then paragraph/text styles are applied (before tables — styles survive table insertion), then tables are placed at their exact positions. Eliminates the forward-pass segment insertion that caused cumulative table drift.
- **Pull: in-place IR post-processing.** Code block merging and language label extraction now operate directly on the block list with tables in place. The old algorithm separated tables from paragraphs and re-interleaved with a counter, which desynced when paragraphs were absorbed (e.g. language labels), shifting later tables down.
- **Batched cell fills.** All cell text insertions for a single table are sent in one `batchUpdate` call (sorted in reverse index order). Reduces write API calls from ~1 per cell to ~1 per table, avoiding the 60 writes/minute quota on larger documents.

## 1.0.5

### Bug fixes
- **Table drift fix:** Trim trailing newlines from text segments before inserting into Google Docs, preventing extra empty paragraphs that caused tables to shift position on each roundtrip.

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
