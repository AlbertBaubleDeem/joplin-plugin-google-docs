## Joplin ↔ Google Docs Plugin: Initial Plan

### Repos
- Plugin: `joplin-plugin-google-docs` (this repo)
- Submodule (local): `google-api-tests` → minimal Node tests for Drive/Docs

### MVP scope (v0)
- One Doc per Joplin note; one Drive folder per Joplin notebook (Option A)
- Mapping persisted in Drive `appProperties` and local store:
  - `joplinNoteId`, `joplinNotebookId`
  - `fileId`, `lastKnownRevisionId`, `lastSyncTs`
- Change detection: Drive Changes API polling (`getStartPageToken`, `changes.list`)
- Optimistic concurrency: Docs `documents.batchUpdate` with `writeControl.requiredRevisionId`
- Basic conversion: MD ⇄ plain text (phase 1); formatting later
- Errors surfaced in Joplin UI (lost access, conflicts)

### Tabs (exploration track)
- Read/write per-tab content and target requests via `Location.tabId`
- Only if creating/renaming tabs fits our needs; otherwise stay with Option A for MVP
- Reference: Google Docs API – Work with tabs: https://developers.google.com/workspace/docs/api/how-tos/tabs

### Test milestones (google-api-tests)
1) Bootstrap
   - Node 18+, `googleapis`, `dotenv`
   - OAuth2: `drive.file`, `drive.metadata.readonly`, `documents`
2) Drive folder mgmt
   - Create/find a root folder for sync
3) Create Doc per “note” (synthetic input)
   - Set `appProperties` mapping; verify retrieval
4) Push flow (Joplin → Docs)
   - Read Doc `revisionId`
   - `documents.batchUpdate` to replace body content
   - Update `appProperties` with `lastKnownRevisionId`, `lastSyncTs`
5) Pull flow (Docs → Joplin)
   - `changes.list` polling → detect modified Doc
   - `documents.get(includeTabsContent=true)` and extract text
   - Update local “note” and `appProperties`
6) Conflict handling
   - Simulate concurrent edit → expect precondition failure → reload and resolve
7) Ownership/permission loss
   - Simulate `removed=true` in Changes → mark mapping as access-lost
8) Move/rename
   - Move Doc and rename; verify `fileId` mapping holds

### Baseline achieved (google-api-tests)
- Mapping: `mapping.json` with notebook→doc, note→tab
- Write: `writeToTab`, `replaceTabBody`, `pullPushByNote`
- Poller: `pollChanges` pulls bound tab into `google-api-tests/local/{noteId}.md`
- Docs: `google-api-tests/README.md` documents scripts and references

### Next steps
- Scaffold `google-api-tests` with minimal auth + Drive Changes + Docs get/update
- Document env setup (OAuth client, token cache) in a README
- Commit and iterate on push/pull/conflict cases


