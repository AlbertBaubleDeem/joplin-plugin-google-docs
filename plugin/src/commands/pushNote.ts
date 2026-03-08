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
  debugLog?: string[];
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

import { appendFileSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

// Debug log collector - writes to file for persistence
let debugLogPath: string | null = null;
const debugLines: string[] = [];

const debugLog = (message: string) => {
  debugLines.push(message);
  // Also write to file for persistence
  if (debugLogPath) {
    appendFileSync(debugLogPath, message + '\n');
  }
};

const clearDebugLog = () => {
  debugLines.length = 0;
};

const setDebugLogPath = (dataDir: string) => {
  debugLogPath = join(dataDir, 'push-debug.log');
  // Clear the file
  writeFileSync(debugLogPath, '=== Push Debug Log ===\n');
};

export function getDebugLog(): string[] {
  return [...debugLines];
}

export function getDebugLogFromFile(dataDir: string): string {
  const logPath = join(dataDir, 'push-debug.log');
  try {
    return readFileSync(logPath, 'utf8');
  } catch {
    return 'No debug log file';
  }
}

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
  dataDir: string
): Promise<{ newRevisionId: string; debugLog: string[] }> {
  const { google, auth, docs, installDir } = ctx;

  setDebugLogPath(dataDir);
  clearDebugLog();
  
  debugLog(`=== executePush for note ${noteId} ===`);

  const note = await getNoteById(j, noteId, ['id', 'title', 'body']);
  const mdRaw: string = String(note.body ?? '');
  debugLog(`Note body length: ${mdRaw.length}`);
  
  // Check if GCS is configured BEFORE conversion
  // This determines whether we process images or preserve them as markdown
  const gcsBucketName = await getGCSBucketNameAsync(j, installDir);
  const processImages_flag = !!gcsBucketName;
  debugLog(`GCS bucket: ${gcsBucketName || 'NOT CONFIGURED'}, processImages: ${processImages_flag}`);
  
  // When GCS is not configured, images are preserved as markdown text (no placeholder extraction)
  const { plain, paraRanges, textRanges, imageRanges, listRanges } = convertMarkdownToPlainAndStyles(mdRaw, { 
    installDir, 
    processImages: processImages_flag 
  });

  debugLog(`Converted: ${mdRaw.length} chars -> ${plain.length} plain, ${imageRanges.length} images, ${listRanges.length} list ranges`);
  if (imageRanges.length > 0) {
    debugLog(`Image resources: ${JSON.stringify(imageRanges.map(r => r.resourceId))}`);
  }
  
  let uploadedObjects: GCSUploadResult[] = [];
  let resourceIdToUrl = new Map<string, string>();
  
  if (imageRanges.length > 0 && gcsBucketName) {
    debugLog(`Processing ${imageRanges.length} images via GCS`);
    
    debugLog(`Initializing GCS storage client...`);
    const storage = google.storage({ version: 'v1', auth });
    debugLog(`GCS storage client created`);
    
    try {
      debugLog(`Calling processImages...`);
      const imageResult = await processImages(j, auth, storage, gcsBucketName, imageRanges, debugLog);
      uploadedObjects = imageResult.uploadedObjects;
      resourceIdToUrl = imageResult.resourceIdToUrl;
      debugLog(`processImages returned: ${uploadedObjects.length} uploaded`);
    } catch (imageError: unknown) {
      debugLog(`processImages ERROR: ${imageError instanceof Error ? imageError.message : imageError}`);
    }
  } else if (imageRanges.length > 0) {
    debugLog(`Images found but GCS not configured`);
    console.warn(`[pushNote] Note has ${imageRanges.length} images but GCS is not configured. Images will not be synced.`);
  } else {
    debugLog(`No images in note`);
  }

  // Fetch current doc state to get revision ID and content end position
  const { endIndex, revisionId } = await getDocState(docs, fileId);
  
  const requests: any[] = [];
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
    debugLog(`Clearing bullet formatting from 1 to ${endIndexAfterInsert}`);
    await docs.documents.batchUpdate({
      documentId: fileId,
      requestBody: {
        requests: [{
          deleteParagraphBullets: {
            range: {
              startIndex: 1,
              endIndex: endIndexAfterInsert,
            },
          },
        }],
      },
    });
  }

  // Apply paragraph and inline styles (WITHOUT list bullets)
  // buildDocsStyleUpdateRequests handles monoFont internally via config
  const styleReqs = buildDocsStyleUpdateRequests(paraRanges, textRanges, { installDir });
  if (styleReqs.length) {
    await docs.documents.batchUpdate({ documentId: fileId, requestBody: { requests: styleReqs } });
  }

  // Apply list bullets in a SEPARATE batchUpdate call
  // This avoids potential interactions between paragraph styles and bullet formatting
  // Note: List ranges are already adjusted in ir-to-docs.ts to account for tab consumption
  // by the createParagraphBullets API (tabs used for nesting are consumed by the API)
  if (listRanges.length > 0) {
    const bulletReqs = buildListBulletRequests(listRanges);
    if (bulletReqs.length) {
      debugLog(`Applying ${bulletReqs.length} list bullet requests separately`);
      await docs.documents.batchUpdate({ documentId: fileId, requestBody: { requests: bulletReqs } });
    }
  }

  // Re-fetch to get end index for image insertion positioning
  const afterTextState = await getDocState(docs, fileId, false);
  debugLog(`Document endIndex after text insertion: ${afterTextState.endIndex}`);
  debugLog(`Image insertion check: uploadedObjects.length=${uploadedObjects.length}, resourceIdToUrl.size=${resourceIdToUrl.size}`);
  if (uploadedObjects.length > 0 && resourceIdToUrl.size > 0) {
    debugLog(`Inserting ${uploadedObjects.length} images into doc`);
    
    // textOffset of 0 because we're inserting at positions within the already-inserted text
    debugLog(`Building image insert requests...`);
    debugLog(`Plain text length: ${plain.length}, Doc endIndex: ${afterTextState.endIndex}`);
    debugLog(`First image position: ${imageRanges[0]?.position}, Last image position: ${imageRanges[imageRanges.length-1]?.position}`);
    const { requests: imageRequests } = buildImageInsertRequests(imageRanges, resourceIdToUrl, 0, debugLog);
    debugLog(`Built ${imageRequests.length} image requests`);
    
    if (imageRequests.length > 0) {
      debugLog(`Executing image batchUpdate with ${imageRequests.length} requests...`);
      // Log first request as sample
      if (imageRequests[0]) {
        debugLog(`Sample request: ${JSON.stringify(imageRequests[0])}`);
      }
      
      try {
        const imgResult = await docs.documents.batchUpdate({
          documentId: fileId,
          requestBody: { requests: imageRequests },
        });
        debugLog(`Image batchUpdate succeeded`);
        const replies = (imgResult.data as { replies?: unknown[] })?.replies || [];
        debugLog(`Got ${replies.length} replies from batchUpdate`);
        if (replies[0]) {
          debugLog(`First reply: ${JSON.stringify(replies[0])}`);
        }
      } catch (imgError: unknown) {
        const errMsg = imgError instanceof Error ? imgError.message : String(imgError);
        debugLog(`Image batchUpdate ERROR: ${errMsg}`);
        throw imgError;
      }
      
      afterState = await getDocState(docs, fileId, false);
      newRevisionId = afterState.revisionId;
    } else {
      debugLog(`No image requests to execute`);
    }
    
    // Clean up GCS public access - this is critical for security
    debugLog(`Cleaning up GCS public access for ${uploadedObjects.length} objects`);
    const storage = google.storage({ version: 'v1', auth });
    await cleanupImageAccess(storage, gcsBucketName!, uploadedObjects);
    debugLog(`GCS cleanup complete`);
  }

  debugLog(`Push complete, newRevisionId: ${newRevisionId}`);
  return { newRevisionId, debugLog: getDebugLog() };
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
  
  setDebugLogPath(dataDir);
  clearDebugLog();
  debugLog('pushNote started');
  
  debugLog('Creating sync context...');
  const ctx = params.ctx || await createSyncContext(installDir, dataDir, j);
  debugLog('Sync context created');

  const noteId = params.noteId || await getSelectedNoteId(j);

  const binding = getBinding(dataDir, noteId);
  if (!binding?.fileId) throw new Error('Note is not bound to a Google Doc.');
  const fileId = binding.fileId;

  const result = await executePush(ctx, j, noteId, fileId, dataDir);

  await updateMappingAfterPush(ctx, noteId, fileId, result.newRevisionId);

  return { noteId, fileId, newRevisionId: result.newRevisionId, debugLog: result.debugLog };
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
