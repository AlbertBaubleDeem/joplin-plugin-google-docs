# Joplin ↔ Google Docs Sync (Plugin)

This repository contains the work-in-progress plugin to sync Joplin notes with Google Drive/Docs.

### Intent
- Sync a Joplin notebook to a Google Document and each note to a tab inside that document (notebook → doc, note → tab).
- Support bidirectional updates:
  - Joplin → Docs: convert Markdown (headings, bold/italic, etc.) into Google Docs styles.
  - Docs → Joplin: detect edits using Drive Changes API and pull updated tab content back.
- Keep durable mapping between note IDs and Google file/tab IDs; resilient to file moves/renames.

### Current status
- A standalone test harness (as a submodule) validates auth, Drive Changes polling, Docs tabs access, and minimal MD→Docs formatting.
- Baseline decisions and design notes live in the plan (see below).

### Repository structure
- `PLAN.md` — goals, scope, achieved baseline, next steps
- `CHANGELOG.md` — notable changes
- `google-api-tests/` (submodule) — minimal Node scripts to exercise APIs
  - See `google-api-tests/README.md` for scripts, roadmap, and references

### Key docs & references
- Google Docs tabs
  - Work with tabs: https://developers.google.com/workspace/docs/api/how-tos/tabs
- Google Drive Changes API
  - Start page token, list changes, removed flag
- Optimistic concurrency (Docs)
  - `documents.batchUpdate` with `writeControl.requiredRevisionId`

### Development quickstart (tests)
- Clone and init submodule:
  - `git submodule update --init --recursive`
- See `google-api-tests/README.md` for auth and scripts:
  - Polling (`pollChanges`) and formatting (`formatExplicit`, `mdToDocs`)

### Roadmap (high level)
- Plugin skeleton: settings, OAuth, mapping storage
- Push path: robust MD→Docs conversion (headings, lists, code, links, images)
- Pull path: Drive Changes poller integrated in plugin lifecycle
- Conflict handling & user prompts

---

Contributions and design feedback are welcome while we iterate on the initial plugin skeleton.
