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

### Decisions (adopted for next phase)
- Import existing Google Documents via Google Picker and bind using Drive `appProperties`.
- Create/ensure a dedicated "Google Docs Sync" folder in Personal Drive and push existing Joplin notes there.
- Evolve mapping to Option B: notebook → one Google Doc, each note → one tab in that Doc. Keep Option A compatibility for already-bound one-note-per-Doc items during migration.

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
3) Create Doc per "note" (synthetic input)
   - Set `appProperties` mapping; verify retrieval
4) Push flow (Joplin → Docs)
   - Read Doc `revisionId`
   - `documents.batchUpdate` to replace body content
   - Update `appProperties` with `lastKnownRevisionId`, `lastSyncTs`
5) Pull flow (Docs → Joplin)
   - `changes.list` polling → detect modified Doc
   - `documents.get(includeTabsContent=true)` and extract text
   - Update local "note" and `appProperties`
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
- Picker integration (import path):
  - Launch Google Picker, select Docs within or outside the sync folder
  - On select: copy/migrate into sync folder if needed; set `appProperties` with `joplinNoteId`/`tabId`
- Bulk push (migration path):
  - For each notebook, create/ensure one Google Doc in sync folder
  - For each note, create/ensure a tab and push Markdown content
  - Write/maintain `appProperties` and local mapping
- Polling improvements:
  - Scope by sync folder or `appProperties.pluginId`
  - Continue optimistic concurrency with `requiredRevisionId`
- Converter improvements:
  - Lists/links/images (beyond headings/bold/italic/code)
- Docs/README: update setup instructions for Picker scopes and sync folder

---

## Architecture: Provider-Agnostic Cloud Sync (December 2025)

### Goals
1. **Code deduplication** – Consolidate repeated patterns across commands
2. **Provider-agnostic design** – Abstract cloud operations so DOCX (and others) can be added later
3. **Preserve stability** – Keep `runtime/index.js` and `google-api-tests/` as-is

### Design Principles
- **Cloud sync centric, not Google-centric** – The architecture supports multiple backends
- **Deduplication first, then extensibility** – Consolidate code while introducing abstractions
- **Test APIs in sandbox first** – Use `google-api-tests/` to validate API behavior before implementation

### Directory Structure

```
plugin/src/
├── commands/           # Thin orchestration (uses services + providers)
│   ├── pushNote.ts
│   ├── pullNote.ts
│   ├── createFromNote.ts
│   ├── exportNotebook.ts
│   └── ...
├── services/           # Shared utilities
│   ├── SyncContext.ts      # Auth + API client consolidation
│   ├── SyncFolderManager.ts # Sync folder resolution/creation
│   ├── NoteOperations.ts    # Common Joplin note helpers
│   └── auth.ts              # OAuth token loading
├── providers/          # Document provider implementations
│   ├── IDocumentProvider.ts  # Provider interface
│   ├── GoogleDocsProvider.ts # Google Docs implementation
│   └── DocxProvider.ts       # DOCX stub (future)
├── converters/         # Format conversion
│   ├── IFormatConverter.ts   # Converter interface
│   ├── DocxConverter.ts      # DOCX stub (future)
│   └── index.ts
├── converter.ts        # Current Markdown ↔ Google Docs converter
├── mapping.ts          # Local binding storage
├── poller.ts           # Drive Changes polling
└── structure.ts        # Document structure analysis
```

### Key Abstractions

#### IDocumentProvider
Provider-agnostic interface for document operations:
```typescript
interface IDocumentProvider {
  providerName: string;
  
  // Document operations
  createDocument(title: string, parentFolderId?: string): Promise<CreateDocumentResult>;
  getDocument(docId: string): Promise<DocumentWithContent>;
  updateDocument(docId: string, content: any, revisionId?: string): Promise<UpdateDocumentResult>;
  deleteDocument(docId: string): Promise<void>;
  
  // Folder operations
  ensureSyncFolder(): Promise<string>;
  createFolder(name: string, parentId?: string): Promise<FolderMetadata>;
  
  // Binding operations
  setDocumentBinding(docId: string, binding: DocumentBinding): Promise<void>;
  getDocumentBinding(docId: string): Promise<DocumentBinding | null>;
  
  // Change detection
  getRevisionId(docId: string): Promise<string | undefined>;
  hasDocumentChanged(docId: string, knownRevisionId: string): Promise<boolean>;
}
```

#### IFormatConverter
Provider-agnostic interface for format conversion:
```typescript
interface IFormatConverter {
  formatName: string;
  
  fromMarkdown(markdown: string, config?: ConversionConfig): MarkdownToFormatResult;
  toMarkdown(content: any, config?: ConversionConfig): FormatToMarkdownResult;
  buildFormattingRequests(result: MarkdownToFormatResult, config?: ConversionConfig): any[];
}
```

#### SyncContext
Consolidates authentication and API client creation:
```typescript
interface SyncContext {
  google: any;      // googleapis module
  auth: any;        // OAuth2 client
  drive: any;       // Pre-created Drive client (v3)
  docs: any;        // Pre-created Docs client (v1)
  installDir: string;
  dataDir: string;
}

// Usage in commands:
const ctx = await createSyncContext(installDir, dataDir);
const files = await ctx.drive.files.list({ ... });
```

### Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| SyncContext | ✅ Done | Consolidates auth + API clients |
| SyncFolderManager | ✅ Done | Centralized folder operations |
| NoteOperations | ✅ Done | Common Joplin helpers |
| IDocumentProvider | ✅ Done | Interface defined |
| GoogleDocsProvider | ✅ Done | Full implementation |
| IFormatConverter | ✅ Done | Interface defined |
| DocxProvider | 🔲 Stub | Ready for implementation |
| DocxConverter | 🔲 Stub | Ready for implementation |
| Command refactoring | ✅ Done | Using new services |

### Future: Adding DOCX Support

When DOCX export is prioritized:

1. **Implement DocxProvider** (`src/providers/DocxProvider.ts`)
   - Use `docx` npm package for file generation
   - Store bindings in document custom properties or sidecar files
   - Output to configurable directory

2. **Implement DocxConverter** (`src/converters/DocxConverter.ts`)
   - Map Markdown headings to DOCX heading styles
   - Map inline formatting to text runs
   - Handle images and links

3. **Add provider selection**
   - User setting for default provider
   - Per-command provider override
   - UI for choosing export format

### Preserved Components

These remain unchanged to maintain stability:
- `runtime/index.js` – Plugin entry point (dynamic requires work in Joplin)
- `google-api-tests/` – API exploration sandbox (test before implementing)
- `mapping.ts` – Local binding storage format
- `converter.ts` – Current MD ↔ Docs converter (will implement IFormatConverter later)

