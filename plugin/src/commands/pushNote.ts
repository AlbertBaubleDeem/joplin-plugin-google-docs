import type { NoteBinding } from '../mapping';
import {
  loadMapping,
  saveMapping,
  getBinding,
} from '../mapping';
import type { TableRange } from '../converters/types';
import { convertMarkdownToPlainAndStyles, buildDocsStyleUpdateRequests, buildListBulletRequests } from '../converters';
import { createSyncContext, SyncContext } from '../services/syncContext';
import { getSelectedNoteId, getNoteById } from '../services/noteOperations';
import { getGCSBucketNameAsync } from '../services/settings';
import {
  processImages,
  buildImageInsertRequests,
  cleanupImageAccess,
  GCSUploadResult,
} from '../imageHandler';

/**
 * Parameters for pushNote command
 */
type Params = {
  j: any;
  installDir: string;
  dataDir: string;
  /** Optional noteId - if not provided, uses the currently selected note */
  noteId?: string;
  /** Optional pre-created SyncContext - avoids re-authentication if provided */
  ctx?: SyncContext;
};

/**
 * Result of a successful push operation
 */
export type PushResult = {
  noteId: string;
  fileId: string;
  newRevisionId: string;
};

// Typed subset of a Google Docs API document response (for table handling)
type TableCellContent = { startIndex?: number; endIndex?: number; paragraph?: { elements?: unknown[] } };
type TableCell = { startIndex?: number; endIndex?: number; content?: TableCellContent[] };
type TableRow = { tableCells?: TableCell[] };
type TableEl = { tableRows?: TableRow[]; columns?: number };
type ContentElement = {
  startIndex?: number;
  endIndex?: number;
  paragraph?: unknown;
  table?: TableEl;
};

type DocBody = {
  content?: ContentElement[];
};

type DocTab = {
  tabProperties?: { tabId?: string };
  documentTab?: { body?: DocBody };
  body?: DocBody;
  childTabs?: DocTab[];
};

type DocResponseData = {
  body?: DocBody;
  tabs?: DocTab[];
  revisionId?: string;
};

type DocState = {
  body: DocBody;
  content: ContentElement[];
  endIndex: number;
  revisionId: string;
};

/** Flatten tabs and childTabs, return the tab whose tabProperties.tabId matches, or first tab. */
function findTabById(tabs: DocTab[] | undefined, tabId: string | undefined): DocTab | undefined {
  if (!Array.isArray(tabs) || tabs.length === 0) return undefined;
  for (const t of tabs) {
    if (t.tabProperties?.tabId === tabId) return t;
    const inChild = findTabById(t.childTabs, tabId);
    if (inChild) return inChild;
  }
  return tabs[0];
}

/**
 * Fetches a Google Doc and extracts body content for the given tab (or first tab).
 * Returns the body, content array, end index, and revision ID.
 */
const getDocState = async (
  docs: SyncContext['docs'],
  fileId: string,
  opts: { includeTabs?: boolean; tabId?: string } = {}
): Promise<DocState> => {
  const { includeTabs = true, tabId } = opts;
  const res = await docs.documents.get({
    documentId: fileId,
    ...(includeTabs ? { includeTabsContent: true } : {}),
  });
  const data = res.data as DocResponseData;
  const revisionId = String(data.revisionId || '');

  let body: DocBody = data.body || {};
  if (data.tabs?.length) {
    const tab = tabId ? findTabById(data.tabs, tabId) : data.tabs[0];
    body = tab?.documentTab?.body || tab?.body || body;
  }

  const content = Array.isArray(body.content) ? body.content : [];
  const endIndex = content.length
    ? Number(content[content.length - 1].endIndex || 1)
    : 1;

  return { body, content, endIndex, revisionId };
};

/** Add tabId to every request's location or range so batchUpdate targets the correct tab. */
function withTabId(requests: unknown[], tabId: string | undefined): unknown[] {
  if (!tabId) return requests;
  return requests.map((req: any) => {
    if (!req || typeof req !== 'object') return req;
    const out: any = {};
    for (const [key, val] of Object.entries(req)) {
      if (!val || typeof val !== 'object') { out[key] = val; continue; }
      const inner: any = { ...(val as any) };
      if (inner.range && typeof inner.range === 'object') {
        inner.range = { ...inner.range, tabId };
      }
      if (inner.location && typeof inner.location === 'object') {
        inner.location = { ...inner.location, tabId };
      }
      out[key] = inner;
    }
    return out;
  });
}

/** Table offsets for mapping plain-text positions to document positions after table insertion. */
type TableOffsets = { plainEnd: number; docEnd: number }[];

/**
 * Find a table element near the expected start index and extract cell positions.
 * Used after InsertTable at a known location to identify the newly created table.
 */
function findTableAndCells(
  content: ContentElement[],
  expectedStartIndex: number
): { startIndex: number; endIndex: number; cells: { startIndex: number; text: string }[] } | null {
  let best: ContentElement | null = null;
  let bestDist = Infinity;
  for (const el of content) {
    if (el?.table && el.startIndex != null) {
      const dist = Math.abs(el.startIndex - expectedStartIndex);
      if (dist < bestDist) {
        bestDist = dist;
        best = el;
      }
    }
  }
  if (!best?.table || best.startIndex == null || best.endIndex == null) return null;
  const cells: { startIndex: number; text: string }[] = [];
  for (const row of best.table.tableRows ?? []) {
    for (const cell of row.tableCells ?? []) {
      const si = cell.content?.[0]?.startIndex ?? cell.startIndex;
      if (si != null) cells.push({ startIndex: si, text: '' });
    }
  }
  return { startIndex: best.startIndex, endIndex: best.endIndex, cells };
}

/**
 * Insert tables in REVERSE order using location.index (backward-editing strategy).
 * Each table is inserted at its placeholder position in the plain text, then cells are filled.
 * Reverse order ensures earlier table positions are never shifted by later insertions.
 */
async function insertTablesReverse(
  docs: SyncContext['docs'],
  fileId: string,
  tabId: string | undefined,
  tables: TableRange[],
  initialState: DocState
): Promise<{ newRevisionId: string; endIndex: number }> {
  let state = initialState;

  for (let i = tables.length - 1; i >= 0; i--) {
    const tr = tables[i];
    const insertReq = {
      insertTable: {
        rows: tr.rowCount,
        columns: tr.columnCount,
        location: { index: tr.position + 1, tabId },
      },
    };
    await docs.documents.batchUpdate({
      documentId: fileId,
      requestBody: {
        requests: withTabId([insertReq], tabId),
        writeControl: state.revisionId ? { requiredRevisionId: state.revisionId } : undefined,
      },
    });
    state = await getDocState(docs, fileId, { includeTabs: true, tabId });

    // InsertTable adds a \n before the table, so it starts at position + 2 (1-based)
    const found = findTableAndCells(state.content, tr.position + 2);
    if (!found) {
      throw new Error(`Table insert at plain position ${tr.position} did not produce a table.`);
    }

    const cellTexts: string[] = [...tr.headerRow];
    for (const row of tr.dataRows) cellTexts.push(...row);

    const cellsWithText = found.cells.map((c, idx) => ({ ...c, text: cellTexts[idx] ?? '' }));
    cellsWithText.sort((a, b) => b.startIndex - a.startIndex);
    const cellReqs = cellsWithText
      .filter(c => (c.text ?? '') !== '')
      .map(c => ({
        insertText: { location: { index: c.startIndex, tabId }, text: (c.text ?? '').replace(/\u000B/g, '\n') },
      }));
    if (cellReqs.length > 0) {
      await docs.documents.batchUpdate({
        documentId: fileId,
        requestBody: { requests: withTabId(cellReqs, tabId) },
      });
    }

    state = await getDocState(docs, fileId, { includeTabs: true, tabId });
  }

  return { newRevisionId: state.revisionId, endIndex: state.endIndex };
}

/**
 * Build table offsets from the final document structure.
 * Each table adds (1 + tableSize) extra characters (the InsertTable \n + the table element).
 * Offsets are cumulative so that offsetAt returns the total shift for any plain-text position.
 */
function computeTableOffsets(content: ContentElement[], tablePositions: number[]): TableOffsets {
  const docTables: { startIndex: number; endIndex: number }[] = [];
  for (const el of content) {
    if (el?.table && el.startIndex != null && el.endIndex != null) {
      docTables.push({ startIndex: el.startIndex, endIndex: el.endIndex });
    }
  }
  docTables.sort((a, b) => a.startIndex - b.startIndex);

  const offsets: TableOffsets = [];
  let cumExtra = 0;
  for (let i = 0; i < tablePositions.length && i < docTables.length; i++) {
    const tableSize = docTables[i].endIndex - docTables[i].startIndex;
    cumExtra += 1 + tableSize;
    offsets.push({
      plainEnd: tablePositions[i] + 1,
      docEnd: tablePositions[i] + 1 + cumExtra,
    });
  }
  return offsets;
}

/**
 * Offset to add to a 0-based plain position to get the adjusted 0-based position in the document.
 * Uses the last table whose plainEnd <= plainPosition to determine the cumulative shift.
 */
function offsetAt(tableOffsets: TableOffsets, plainPosition: number): number {
  let offset = 0;
  for (const { plainEnd, docEnd } of tableOffsets) {
    if (plainPosition >= plainEnd) {
      offset = docEnd - plainEnd;
    }
  }
  return offset;
}

async function executePush(
  ctx: SyncContext,
  j: any,
  noteId: string,
  fileId: string,
  _dataDir: string,
  tabId: string | undefined
): Promise<{ newRevisionId: string }> {
  const { google, auth, docs, installDir } = ctx;

  const note = await getNoteById(j, noteId, ['id', 'title', 'body']);
  const mdRaw: string = String(note.body ?? '');

  const gcsBucketName = await getGCSBucketNameAsync(j, installDir);
  const processImages_flag = !!gcsBucketName;

  const { plain, paraRanges, textRanges, imageRanges, listRanges, tableRanges } = convertMarkdownToPlainAndStyles(mdRaw, {
    installDir,
    processImages: processImages_flag,
  });
  const tables = tableRanges ?? [];

  let uploadedObjects: GCSUploadResult[] = [];
  let resourceIdToUrl = new Map<string, string>();

  if (imageRanges.length > 0 && gcsBucketName) {
    const storage = google.storage({ version: 'v1', auth });
    try {
      const imageResult = await processImages(j, auth, storage, gcsBucketName, imageRanges);
      uploadedObjects = imageResult.uploadedObjects;
      resourceIdToUrl = imageResult.resourceIdToUrl;
    } catch {
      // Image processing failed; continue without images
    }
  } else if (imageRanges.length > 0) {
    console.warn(`[pushNote] Note has ${imageRanges.length} images but GCS is not configured. Images will not be synced.`);
  }

  const docStateOpts = { includeTabs: true, tabId };
  const { endIndex, revisionId } = await getDocState(docs, fileId, docStateOpts);

  // ── Phase 1: Insert ALL plain text (including \n placeholders for tables) ──
  let initReqs: unknown[] = [];
  if (endIndex > 2) {
    initReqs.push({ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } });
  }
  initReqs.push({ insertText: { location: { index: 1 }, text: plain } });
  initReqs = withTabId(initReqs, tabId);

  await docs.documents.batchUpdate({
    documentId: fileId,
    requestBody: {
      requests: initReqs,
      writeControl: revisionId ? { requiredRevisionId: revisionId } : undefined,
    },
  });

  let afterState = await getDocState(docs, fileId, docStateOpts);

  // ── Phase 2: Apply paragraph + text styles (indices are direct, no offsets) ──
  // Styles attach to paragraphs/runs and survive the table insertions in Phase 3.
  const styleReqs = buildDocsStyleUpdateRequests(paraRanges, textRanges, { installDir });
  if (styleReqs.length) {
    await docs.documents.batchUpdate({
      documentId: fileId,
      requestBody: { requests: withTabId(styleReqs, tabId) },
    });
    afterState = await getDocState(docs, fileId, docStateOpts);
  }

  // ── Phase 3: Insert tables in REVERSE order at their placeholder positions ──
  let newRevisionId = afterState.revisionId;
  if (tables.length > 0) {
    const tableResult = await insertTablesReverse(docs, fileId, tabId, tables, afterState);
    newRevisionId = tableResult.newRevisionId;
    afterState = await getDocState(docs, fileId, docStateOpts);
  }

  // ── Phase 4: Compute table offsets from final document structure ──
  let effectiveListRanges = listRanges;
  let effectiveImageRanges = imageRanges;

  if (tables.length > 0) {
    const tableOffsets = computeTableOffsets(afterState.content, tables.map(t => t.position));
    const off = (p: number) => offsetAt(tableOffsets, p);
    effectiveListRanges = listRanges.map(r => ({
      ...r,
      startIndex: r.startIndex + off(r.startIndex),
      endIndex: r.endIndex + off(r.endIndex),
    }));
    effectiveImageRanges = imageRanges.map(img => ({ ...img, position: img.position + off(img.position) }));
  }

  // ── Phase 5: Clear bullets, apply list bullets + images (with offsets) ──
  if (afterState.endIndex > 2) {
    await docs.documents.batchUpdate({
      documentId: fileId,
      requestBody: {
        requests: withTabId([{
          deleteParagraphBullets: {
            range: { startIndex: 1, endIndex: afterState.endIndex },
          },
        }], tabId),
      },
    });
  }

  if (effectiveListRanges.length > 0) {
    const bulletReqs = buildListBulletRequests(effectiveListRanges);
    if (bulletReqs.length) {
      await docs.documents.batchUpdate({
        documentId: fileId,
        requestBody: { requests: withTabId(bulletReqs, tabId) },
      });
    }
  }

  if (uploadedObjects.length > 0 && resourceIdToUrl.size > 0) {
    const { requests: imageRequests } = buildImageInsertRequests(effectiveImageRanges, resourceIdToUrl, 0);
    if (imageRequests.length > 0) {
      await docs.documents.batchUpdate({
        documentId: fileId,
        requestBody: { requests: withTabId(imageRequests, tabId) },
      });
      afterState = await getDocState(docs, fileId, { includeTabs: false });
      newRevisionId = afterState.revisionId;
    }
    const storage = google.storage({ version: 'v1', auth });
    await cleanupImageAccess(storage, gcsBucketName!, uploadedObjects);
  }

  return { newRevisionId };
}

/**
 * Updates the local mapping and Drive appProperties after a successful push
 */
async function updateMappingAfterPush(
  ctx: SyncContext,
  noteId: string,
  binding: NoteBinding,
  newRevisionId: string
): Promise<void> {
  const { dataDir } = ctx;
  const mapping = loadMapping(dataDir);

  const nb: NoteBinding = { ...binding };
  nb.fileId = binding.fileId;
  nb.tabId = binding.tabId;
  nb.lastKnownRevisionId = newRevisionId;
  nb.lastSyncTs = Date.now();
  mapping.notes[noteId] = nb;
  saveMapping(dataDir, mapping);

  // Update Drive appProperties via provider (best-effort)
  const fileId = binding.fileId!;
  try {
    await ctx.provider.updateAppProperties(fileId, {
      lastKnownRevisionId: newRevisionId,
      lastSyncTs: new Date().toISOString(),
    });
  } catch (_) {
    // ignore if insufficient permissions (e.g., not app-owned under drive.file)
  }
}

/**
 * Pushes a Joplin note to its bound Google Doc.
 * 
 * This is the consolidated function that handles both:
 * - Pushing the currently selected note (when noteId is not provided)
 * - Pushing a specific note by ID (when noteId is provided)
 * 
 * @param params - Push parameters including Joplin API, paths, and optional noteId
 * @returns Promise resolving to push result with noteId, fileId, and new revisionId
 * @throws Error if no note is selected/specified or if note is not bound
 */
export async function pushNote(params: Params): Promise<PushResult> {
  const { j, installDir, dataDir } = params;

  const ctx = params.ctx || await createSyncContext(installDir, dataDir, j);
  const noteId = params.noteId || await getSelectedNoteId(j);

  const binding = getBinding(dataDir, noteId);
  if (!binding?.fileId) throw new Error('Note is not bound to a Google Doc.');
  const fileId = binding.fileId;

  const result = await executePush(ctx, j, noteId, fileId, dataDir, binding.tabId);
  await updateMappingAfterPush(ctx, noteId, binding, result.newRevisionId);

  return { noteId, fileId, newRevisionId: result.newRevisionId };
}

/**
 * @deprecated Use pushNote({ ...params, noteId }) instead
 * 
 * Pushes a specific note by ID. This function is kept for backward compatibility
 * with existing code that imports it directly (e.g., poller.ts).
 */
export async function pushNoteById(params: Params & { noteId: string }): Promise<PushResult> {
  return pushNote(params);
}
