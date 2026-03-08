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
  documentTab?: { body?: DocBody };
  body?: DocBody;
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

/**
 * Fetches a Google Doc and extracts its body content, preferring the first tab
 * when tabs are present. Returns the body, content array, end index, and revision ID.
 */
const getDocState = async (
  docs: SyncContext['docs'],
  fileId: string,
  includeTabs = true
): Promise<DocState> => {
  const res = await docs.documents.get({
    documentId: fileId,
    ...(includeTabs ? { includeTabsContent: true } : {}),
  });
  const data = res.data as DocResponseData;
  const revisionId = String(data.revisionId || '');

  let body: DocBody = data.body || {};
  if (data.tabs?.length) {
    const firstTab = data.tabs[0];
    body = firstTab?.documentTab?.body || firstTab?.body || body;
  }

  const content = Array.isArray(body.content) ? body.content : [];
  const endIndex = content.length
    ? Number(content[content.length - 1].endIndex || 1)
    : 1;

  return { body, content, endIndex, revisionId };
};

async function executePush(
  ctx: SyncContext,
  j: any,
  noteId: string,
  fileId: string,
  _dataDir: string
): Promise<{ newRevisionId: string }> {
  const { google, auth, docs, installDir } = ctx;

  const note = await getNoteById(j, noteId, ['id', 'title', 'body']);
  const mdRaw: string = String(note.body ?? '');

  // Check if GCS is configured BEFORE conversion
  // This determines whether we process images or preserve them as markdown
  const gcsBucketName = await getGCSBucketNameAsync(j, installDir);
  const processImages_flag = !!gcsBucketName;

  // When GCS is not configured, images are preserved as markdown text (no placeholder extraction)
  const { plain, paraRanges, textRanges, imageRanges, listRanges } = convertMarkdownToPlainAndStyles(mdRaw, { 
    installDir, 
    processImages: processImages_flag 
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

  // Fetch current doc state to get revision ID and content end position
  const { endIndex, revisionId } = await getDocState(docs, fileId);

  const requests: unknown[] = [];
  // Avoid empty delete range (start==end). For empty docs endIndex is often 2.
  if (endIndex > 2) {
    requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } });
  }
  requests.push({ insertText: { location: { index: 1 }, text: plain } });

  await docs.documents.batchUpdate({
    documentId: fileId,
    requestBody: {
      requests,
      writeControl: revisionId ? { requiredRevisionId: revisionId } : undefined,
    },
  });

  // Re-fetch to get post-insert state for bullet clearing and style application
  let afterState = await getDocState(docs, fileId);
  let newRevisionId = afterState.revisionId;

  // Find the last PARAGRAPH element (skip section breaks and other structural elements)
  // to get the true end of the writable body segment
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

  // Clear all existing bullet formatting before applying new styles
  // This prevents list formatting from persisting across pushes
  if (endIndexAfterInsert > 2) {
    await docs.documents.batchUpdate({
      documentId: fileId,
      requestBody: {
        requests: [{
          deleteParagraphBullets: {
            range: { startIndex: 1, endIndex: endIndexAfterInsert },
          },
        }],
      },
    });
  }

  // Apply paragraph and inline styles (WITHOUT list bullets)
  const styleReqs = buildDocsStyleUpdateRequests(paraRanges, textRanges, { installDir });
  if (styleReqs.length) {
    await docs.documents.batchUpdate({ documentId: fileId, requestBody: { requests: styleReqs } });
  }

  // Apply list bullets in a SEPARATE batchUpdate call to avoid interactions
  // with paragraph styles. List ranges are already adjusted for tab consumption.
  if (listRanges.length > 0) {
    const bulletReqs = buildListBulletRequests(listRanges);
    if (bulletReqs.length) {
      await docs.documents.batchUpdate({ documentId: fileId, requestBody: { requests: bulletReqs } });
    }
  }

  // Insert images if GCS upload succeeded
  const afterTextState = await getDocState(docs, fileId, false);
  if (uploadedObjects.length > 0 && resourceIdToUrl.size > 0) {
    const { requests: imageRequests } = buildImageInsertRequests(imageRanges, resourceIdToUrl, 0);

    if (imageRequests.length > 0) {
      await docs.documents.batchUpdate({
        documentId: fileId,
        requestBody: { requests: imageRequests },
      });

      afterState = await getDocState(docs, fileId, false);
      newRevisionId = afterState.revisionId;
    }

    // Clean up GCS public access
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
  fileId: string,
  newRevisionId: string
): Promise<void> {
  const { dataDir } = ctx;
  const mapping = loadMapping(dataDir);

  const nb: NoteBinding = mapping.notes[noteId] || {};
  nb.fileId = fileId;
  nb.lastKnownRevisionId = newRevisionId;
  nb.lastSyncTs = Date.now();
  mapping.notes[noteId] = nb;
  saveMapping(dataDir, mapping);

  // Update Drive appProperties via provider (best-effort)
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

  const result = await executePush(ctx, j, noteId, fileId, dataDir);
  await updateMappingAfterPush(ctx, noteId, fileId, result.newRevisionId);

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
