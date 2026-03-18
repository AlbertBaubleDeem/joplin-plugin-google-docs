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

/** Result of applyTableRanges: new revision and offsets for adjusting style/list ranges. */
type TableOffsets = { plainEnd: number; docEnd: number }[];

/**
 * Find the last table in content and return its endIndex and cell indices for insertText.
 * Per wiki: startIndex/endIndex are on the StructuralElement (cell.content[0]), not on .paragraph.
 */
function findLastTableAndCells(content: ContentElement[]): { endIndex: number; cells: { startIndex: number; text: string }[] } | null {
  let lastTable: { endIndex: number; table: TableEl } | null = null;
  for (let i = 0; i < content.length; i++) {
    const el = content[i];
    if (el?.table && el.endIndex != null) {
      lastTable = { endIndex: el.endIndex, table: el.table };
    }
  }
  if (!lastTable) return null;
  const { table, endIndex } = lastTable;
  const cells: { startIndex: number; text: string }[] = [];
  const rows = table.tableRows ?? [];
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    const tableCells = row.tableCells ?? [];
    for (let colIdx = 0; colIdx < tableCells.length; colIdx++) {
      const cell = tableCells[colIdx];
      const firstContent = cell.content?.[0];
      const startIndex = firstContent?.startIndex ?? cell.startIndex;
      if (startIndex != null) {
        cells.push({ startIndex, text: '' });
      }
    }
  }
  return { endIndex, cells };
}

/**
 * Segment-based table insert: InsertTable at end, re-fetch, fill cells (reverse index order), then append next text segment.
 * Returns new revision id, final end index, and table offsets for adjusting style/list ranges.
 */
async function applyTableRanges(
  docs: SyncContext['docs'],
  fileId: string,
  tabId: string | undefined,
  tables: TableRange[],
  plain: string,
  initialState: DocState
): Promise<{ newRevisionId: string; endIndex: number; tableOffsets: TableOffsets }> {
  let state = initialState;
  const tableOffsets: TableOffsets = [];

  for (let i = 0; i < tables.length; i++) {
    const tr = tables[i];
    const insertReq = {
      insertTable: {
        rows: tr.rowCount,
        columns: tr.columnCount,
        endOfSegmentLocation: { segmentId: '', tabId },
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
    const found = findLastTableAndCells(state.content);
    if (!found) {
      throw new Error('Table insert did not return a table in document.');
    }
    const { endIndex: tableEndIndex, cells } = found;

    const cellTexts: string[] = [...tr.headerRow];
    for (const row of tr.dataRows) {
      cellTexts.push(...row);
    }
    const cellsWithText = cells.map((c, idx) => ({ ...c, text: cellTexts[idx] ?? '' }));
    cellsWithText.sort((a, b) => b.startIndex - a.startIndex);
    for (const c of cellsWithText) {
      const text = (c.text ?? '').replace(/\u000B/g, '\n');
      if (text === '') continue;
      const req = { insertText: { location: { index: c.startIndex, tabId }, text } };
      await docs.documents.batchUpdate({
        documentId: fileId,
        requestBody: { requests: withTabId([req], tabId) },
      });
    }
    state = await getDocState(docs, fileId, { includeTabs: true, tabId });

    const nextSegmentEnd = i + 1 < tables.length ? tables[i + 1].position + 1 : plain.length;
    const nextSegment = plain.slice(tr.position + 1, nextSegmentEnd).replace(/\n+$/, '');
    const insertIndex = state.endIndex - 1;
    const docEnd0Based = insertIndex - 1;
    tableOffsets.push({ plainEnd: tr.position + 1, docEnd: docEnd0Based });

    if (nextSegment.length > 0) {
      const segReq = { insertText: { location: { index: insertIndex, tabId }, text: nextSegment } };
      await docs.documents.batchUpdate({
        documentId: fileId,
        requestBody: { requests: withTabId([segReq], tabId) },
      });
      state = await getDocState(docs, fileId, { includeTabs: true, tabId });
    }
  }

  return {
    newRevisionId: state.revisionId,
    endIndex: state.endIndex,
    tableOffsets,
  };
}

/**
 * Offset to add to a plain position to get the doc position.
 * Content after table i lives in a segment that starts at plainEnd_i in plain and docEnd_i in doc,
 * so we use the offset for the segment that contains plainPosition (last table with plainEnd <= plainPosition).
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

  // Check if GCS is configured BEFORE conversion
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

  // Trim trailing newlines before first table so we don't create extra empty paragraphs in Docs
  // (InsertTable already inserts one newline before the table.)
  const initialText = tables.length > 0
    ? plain.slice(0, tables[0].position + 1).replace(/\n+$/, '')
    : plain;
  let requests: unknown[] = [];
  if (endIndex > 2) {
    requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } });
  }
  requests.push({ insertText: { location: { index: 1 }, text: initialText } });
  requests = withTabId(requests, tabId);

  await docs.documents.batchUpdate({
    documentId: fileId,
    requestBody: {
      requests,
      writeControl: revisionId ? { requiredRevisionId: revisionId } : undefined,
    },
  });

  let afterState = await getDocState(docs, fileId, docStateOpts);
  let newRevisionId = afterState.revisionId;
  let endIndexAfterInsert = 1;
  let effectiveParaRanges = paraRanges;
  let effectiveTextRanges = textRanges;
  let effectiveListRanges = listRanges;
  let effectiveImageRanges = imageRanges;

  if (tables.length > 0) {
    const result = await applyTableRanges(docs, fileId, tabId, tables, plain, afterState);
    newRevisionId = result.newRevisionId;
    endIndexAfterInsert = result.endIndex;
    afterState = await getDocState(docs, fileId, docStateOpts);
    const off = (p: number) => offsetAt(result.tableOffsets, p);
    effectiveParaRanges = paraRanges.map(r => ({ ...r, start: r.start + off(r.start), end: r.end + off(r.end) }));
    effectiveTextRanges = textRanges.map(r => ({ ...r, start: r.start + off(r.start), end: r.end + off(r.end) }));
    effectiveListRanges = listRanges.map(r => ({
      ...r,
      startIndex: r.startIndex + off(r.startIndex),
      endIndex: r.endIndex + off(r.endIndex),
    }));
    effectiveImageRanges = imageRanges.map(img => ({ ...img, position: img.position + off(img.position) }));
  } else {
    for (let i = afterState.content.length - 1; i >= 0; i--) {
      if (afterState.content[i].paragraph) {
        endIndexAfterInsert = Number(afterState.content[i].endIndex || 1);
        break;
      }
    }
    if (endIndexAfterInsert === 1 && afterState.content.length > 0) {
      endIndexAfterInsert = afterState.endIndex;
    }
  }

  if (endIndexAfterInsert > 2) {
    const bulletClearReqs = withTabId([{
      deleteParagraphBullets: {
        range: { startIndex: 1, endIndex: endIndexAfterInsert },
      },
    }], tabId);
    await docs.documents.batchUpdate({
      documentId: fileId,
      requestBody: { requests: bulletClearReqs },
    });
  }

  const styleReqs = buildDocsStyleUpdateRequests(effectiveParaRanges, effectiveTextRanges, { installDir });
  if (styleReqs.length) {
    await docs.documents.batchUpdate({
      documentId: fileId,
      requestBody: { requests: withTabId(styleReqs, tabId) },
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
