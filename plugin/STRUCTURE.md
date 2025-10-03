### Google Docs structure: business logic and implementation

#### Goals
- Provide a single place to reason about how a Google Doc maps to Joplin entities.
- Work uniformly for single‑tab and multi‑tab Docs for both Pull and future Push.
- Keep conversion stable: always pass a normalized `DocLike` with `body.content` filled.

#### Responsibilities
- Analyze a document for high‑level structure (tabs, potential titles).
- Decide naming (note vs. notebook + per‑tab notes) without mutating content.
- Produce a normalized document object for conversion, regardless of tabs.

#### Key APIs (from `src/structure.ts`)
- Types: `DocLike`, `TabInfo`, `StructureAnalysis`, `SingleDecision`, `MultiDecision`, `StructuralDecision`.
- Strategies:
  - `SingleDocumentBindingStrategy`: TITLE extraction; note title for single‑tab.
  - `MultiTabNotebookBindingStrategy`: derives notebook title and per‑tab note titles.
  - `SyncStructureManager`: runs the appropriate strategy based on detected tabs.
- Tabs‑aware normalization:
  - `buildConversionDocFromTabs(docsClient, documentId, { tabId? }) → { convertDoc, tabCount, usedTabTitle }`
    - Fetches with `includeTabsContent=true` to enumerate tabs.
    - Selects a tab (by `tabId` if bound, else first).
    - Reads content from `document.tabs[i].documentTab.body.content` (correct field when tabs are enabled).
    - Returns `convertDoc` as a minimal `{ title, body: { content } }` suitable for the converter.
    - Falls back to a plain `documents.get()` if no tabs array is returned.

#### How runtime uses it (Pull)
- `runtime/index.js` calls `buildConversionDocFromTabs` with the bound `fileId` (and `tabId` if provided).
- Passes the returned `convertDoc` into `convertDocumentToMarkdown` to keep conversion logic stable.
- Optionally, `SyncStructureManager` can be used for naming decisions (title only), while the body comes from the converter.

#### Single‑tab vs multi‑tab behavior
- Single‑tab:
  - Tabs request still returns a `tabs` array with one element.
  - We select that tab and use `documentTab.body.content` (equivalent to plain body).
- Multi‑tab:
  - `tabCount > 1` indicates notebook mapping territory.
  - Current Pull uses the selected tab only (first by default, or bound `tabId`).
  - Future: create a notebook and one Joplin note per tab.

#### Future push (high‑level outline)
- Use the same tab‑selection to determine target tab.
- Convert Markdown → Docs requests (write to `document.tabs[i]` via batchUpdate against the tab’s `documentTab` range).
- Guard with `revisionId` to detect conflicts; expose a resolve flow in the plugin.

#### Error handling and fallbacks
- If tabs request fails or returns no tabs, fall back to plain `documents.get()` and use `document.body.content`.
- If selected tab has no content array, treat as empty and avoid overwriting the Joplin body with empty content unless intended.

#### Rationale
- Tabs fetch shifts content out of `document.body` into `document.tabs[].documentTab.body.content`. Normalizing this early prevents empty pulls.
- A single normalization function keeps Pull and Push consistent and testable.


