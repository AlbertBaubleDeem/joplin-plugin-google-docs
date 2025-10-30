## Google Docs Import UX: Picker vs. In-App Drive Browser

This document captures two alternative implementations for importing/binding existing Google Docs to Joplin notes.

### Variant A — Google Picker (official JS widget)

Summary: Use Google Picker UI inside a Joplin webview panel/dialog. Picker returns selected Drive file(s); we bind or migrate them into the sync folder.

Requirements
- Enable API: Google Picker API in the GCP project.
- Credentials: existing OAuth client (already used by the plugin) + API Key for Picker.
- Env: add `GOOGLE_API_KEY=...` to the plugin `.env` (installDir).
- Scopes: existing Drive/Docs scopes are fine.

User Flow
1) Tools → “Google Docs Sync: Open Google Picker”.
2) Panel/Dialog shows “Open Picker” button; clicking opens Picker.
3) User selects one or more Docs; we capture file IDs.
4) For the first selection, we bind to current note (quick-test). Longer term, show options: Bind, Migrate (copy into sync folder), or Create new note.

Implementation Notes
- Auth: reuse current OAuth access token (`getAuthFromInstallDir`).
- Developer Key: pass only if present; otherwise Picker may not initialize.
- CSP caveat: Joplin webview may block `https://apis.google.com/js/api.js`. If it fails to load, Picker won’t render.
- If blocked, fall back to Variant B automatically.

Pros
- Familiar Google UX.
- Automatic multi-select and filtering.

Cons
- Requires API key and loading remote scripts in the webview (may be blocked by CSP).
- Extra setup for users (enable Picker API + API key).

Rollout Checklist
- [ ] Enable Picker API in Cloud Console.
- [ ] Create API key; add to `.env` as `GOOGLE_API_KEY`.
- [ ] Test command: Tools → “Open Google Picker”.
- [ ] Verify selected file IDs are received and binding/migration works.

---

### Variant B — In-App Drive Browser (Dialog)

Summary: Replace Google Picker with a custom dialog powered by the Drive API. Lists Docs (in sync folder or all Drive), provides search, multi-select, and actions.

Requirements
- No API key; reuse existing OAuth and scopes.
- UI: Joplin dialog (not a webview panel) to avoid remote script/CSP issues.

User Flow
1) Tools → “Google Docs Sync: Import/Bind (Dialog)”.
2) Dialog lists recent Docs (or only Docs in the sync folder).
3) Search/filter; select one or more Docs.
4) Choose action: Bind to current note, Create note(s) and bind, or Migrate into sync folder and bind.

Implementation Plan
- Backend: use `drive.files.list` with `supportsAllDrives`, paging, and optional `q` filters.
- Dialog: HTML form with search box, paginated table, checkboxes; on submit, send selected file IDs back to plugin.
- Actions:
  - Bind: write local mapping; best-effort `appProperties` (may 403 unless app-owned).
  - Migrate: copy into sync folder (app-owned), set `appProperties`, bind locally.
  - Create notes: for multiple files, create notes and bind each.
- Scope: default to sync folder; toggle to “All Drive” if needed.

Pros
- No API key, no remote JS, predictable in Joplin.
- Full control over UX and actions.

Cons
- Heavier to implement than Picker.
- Less “native Google” feel.

Rollout Checklist
- [ ] Add command: Tools → “Import/Bind (Dialog)”.
- [ ] Implement listing (paging, search) and selection UI.
- [ ] Implement Bind/Migrate/Create flows and confirmations.
- [ ] Persist mapping; update `appProperties` when app-owned.

---

### Decision Guidance
- Try Variant A first only if CSP allows remote script loading and you prefer native Google UI.
- Otherwise adopt Variant B; it fits our existing auth model, avoids API keys, and is reliable inside Joplin.

### Next Steps
- Short-term: test Picker with API key; if blocked, pivot to dialog.
- Mid-term: add Notebook→Doc (tabs) alignment into the import/migrate actions.


