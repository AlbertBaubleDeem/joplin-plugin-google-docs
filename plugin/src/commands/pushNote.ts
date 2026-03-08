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

/**
 * Core push logic - extracted to avoid duplication
 */
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
  console.log(`[pushNote] GCS bucket configured: ${gcsBucketName || 'NOT CONFIGURED'}`);
  
  // When GCS is not configured, images are preserved as markdown text (no placeholder extraction)
  const { plain, paraRanges, textRanges, imageRanges, listRanges } = convertMarkdownToPlainAndStyles(mdRaw, { 
    installDir, 
    processImages: processImages_flag 
  });

  debugLog(`Converted: ${mdRaw.length} chars -> ${plain.length} plain, ${imageRanges.length} images, ${listRanges.length} list ranges`);
  console.log(`[pushNote] Converted markdown: ${mdRaw.length} chars -> ${plain.length} plain chars`);
  console.log(`[pushNote] Found ${imageRanges.length} images and ${listRanges.length} list ranges in note`);
  if (imageRanges.length > 0) {
    debugLog( `Image resources: ${JSON.stringify(imageRanges.map(r => r.resourceId))}`);
    console.log(`[pushNote] Image resources:`, imageRanges.map(r => r.resourceId));
  }
  
  let uploadedObjects: GCSUploadResult[] = [];
  let resourceIdToUrl = new Map<string, string>();
  
  if (imageRanges.length > 0 && gcsBucketName) {
    debugLog( `Processing ${imageRanges.length} images via GCS`);
    console.log(`[pushNote] Processing ${imageRanges.length} images via GCS bucket: ${gcsBucketName}`);
    
    debugLog( `Initializing GCS storage client...`);
    const storage = google.storage({ version: 'v1', auth });
    debugLog( `GCS storage client created`);
    
    try {
      debugLog(`Calling processImages...`);
      const imageResult = await processImages(j, auth, storage, gcsBucketName, imageRanges, debugLog);
      uploadedObjects = imageResult.uploadedObjects;
      resourceIdToUrl = imageResult.resourceIdToUrl;
      debugLog(`processImages returned: ${uploadedObjects.length} uploaded`);
    } catch (imageError: any) {
      debugLog(`processImages ERROR: ${imageError?.message || imageError}`);
    }
  } else if (imageRanges.length > 0) {
    debugLog( `Images found but GCS not configured`);
    console.warn(`[pushNote] Note has ${imageRanges.length} images but GCS is not configured. Images will not be synced.`);
  } else {
    debugLog( `No images in note`);
  }

  // Use includeTabsContent to handle documents with tabs correctly
  const docRes = await docs.documents.get({ documentId: fileId, includeTabsContent: true });
  const docResData = docRes.data as any;
  const revisionId: string = String(docResData.revisionId || '');
  
  let body = docResData.body || {};
  const mainBodyEndIndex = body.content?.length ? Number(body.content[body.content.length - 1].endIndex || 1) : 1;
  if (docResData.tabs?.length > 0) {
    const firstTab = docResData.tabs[0];
    body = firstTab?.documentTab?.body || firstTab?.body || body;
  }
  const content = Array.isArray(body.content) ? body.content : [];
  const endIndex = content.length ? Number(content[content.length - 1].endIndex || 1) : 1;
  
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

  // Use includeTabsContent to handle documents with tabs correctly
  let afterRes = await docs.documents.get({ documentId: fileId, includeTabsContent: true });
  const afterResData = afterRes.data as any;
  let newRevisionId: string = String(afterResData.revisionId || '');
  
  let bodyAfterInsert = afterResData.body || {};
  if (afterResData.tabs?.length > 0) {
    const firstTab = afterResData.tabs[0];
    bodyAfterInsert = firstTab?.documentTab?.body || firstTab?.body || bodyAfterInsert;
  }
  const contentAfterInsert = Array.isArray(bodyAfterInsert.content) ? bodyAfterInsert.content : [];
  
  // Find the actual last PARAGRAPH element (not section breaks or other structural elements)
  // This gives us the true end of the writable body segment
  let endIndexAfterInsert = 1;
  for (let i = contentAfterInsert.length - 1; i >= 0; i--) {
    const el = contentAfterInsert[i];
    if (el.paragraph) {
      endIndexAfterInsert = Number(el.endIndex || 1);
      break;
    }
  }
  // Fallback to last element if no paragraph found
  if (endIndexAfterInsert === 1 && contentAfterInsert.length > 0) {
    endIndexAfterInsert = Number(contentAfterInsert[contentAfterInsert.length - 1].endIndex || 1);
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

  const docAfterText = await docs.documents.get({ documentId: fileId });
  const bodyAfterText = (docAfterText.data as any).body || {};
  const contentAfterText = Array.isArray(bodyAfterText.content) ? bodyAfterText.content : [];
  const endIndexAfterText = contentAfterText.length ? Number(contentAfterText[contentAfterText.length - 1].endIndex || 1) : 1;
  debugLog(`Document endIndex after text insertion: ${endIndexAfterText}`);
  debugLog(`Image insertion check: uploadedObjects.length=${uploadedObjects.length}, resourceIdToUrl.size=${resourceIdToUrl.size}`);
  if (uploadedObjects.length > 0 && resourceIdToUrl.size > 0) {
    console.log(`[pushNote] Inserting ${uploadedObjects.length} images into doc`);
    debugLog(`Inserting ${uploadedObjects.length} images into doc`);
    
    // textOffset of 0 because we're inserting at positions within the already-inserted text
    debugLog(`Building image insert requests...`);
    debugLog(`Plain text length: ${plain.length}, Doc endIndex: ${endIndexAfterText}`);
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
        const replies = (imgResult.data as any)?.replies || [];
        debugLog(`Got ${replies.length} replies from batchUpdate`);
        if (replies[0]) {
          debugLog(`First reply: ${JSON.stringify(replies[0])}`);
        }
      } catch (imgError: any) {
        debugLog(`Image batchUpdate ERROR: ${imgError?.message || imgError}`);
        debugLog(`Error details: ${JSON.stringify(imgError?.response?.data || {})}`);
        throw imgError;
      }
      
      afterRes = await docs.documents.get({ documentId: fileId });
      newRevisionId = String((afterRes.data as any).revisionId || '');
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
