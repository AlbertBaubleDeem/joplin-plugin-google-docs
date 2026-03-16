import type { NoteBinding } from '../mapping';
import {
  loadMapping,
  saveMapping,
  getBinding,
} from '../mapping';
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

// Typed subset of a Google Docs API document response
type ContentElement = {
  endIndex?: number;
  paragraph?: unknown;
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
    const out = { ...req };
    if (out.range && typeof out.range === 'object') {
      out.range = { ...out.range, tabId };
    }
    if (out.location && typeof out.location === 'object') {
      out.location = { ...out.location, tabId };
    }
    return out;
  });
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

  const { plain, paraRanges, textRanges, imageRanges, listRanges } = convertMarkdownToPlainAndStyles(mdRaw, {
    installDir,
    processImages: processImages_flag,
  });

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

  let requests: unknown[] = [];
  if (endIndex > 2) {
    requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } });
  }
  requests.push({ insertText: { location: { index: 1 }, text: plain } });
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
  for (let i = afterState.content.length - 1; i >= 0; i--) {
    if (afterState.content[i].paragraph) {
      endIndexAfterInsert = Number(afterState.content[i].endIndex || 1);
      break;
    }
  }
  if (endIndexAfterInsert === 1 && afterState.content.length > 0) {
    endIndexAfterInsert = afterState.endIndex;
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

  const styleReqs = buildDocsStyleUpdateRequests(paraRanges, textRanges, { installDir });
  if (styleReqs.length) {
    await docs.documents.batchUpdate({
      documentId: fileId,
      requestBody: { requests: withTabId(styleReqs, tabId) },
    });
  }

  if (listRanges.length > 0) {
    const bulletReqs = buildListBulletRequests(listRanges);
    if (bulletReqs.length) {
      await docs.documents.batchUpdate({
        documentId: fileId,
        requestBody: { requests: withTabId(bulletReqs, tabId) },
      });
    }
  }

  if (uploadedObjects.length > 0 && resourceIdToUrl.size > 0) {
    const { requests: imageRequests } = buildImageInsertRequests(imageRanges, resourceIdToUrl, 0);
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
