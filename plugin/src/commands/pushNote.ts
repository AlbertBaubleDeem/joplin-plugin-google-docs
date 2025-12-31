import type { DriveLike, NoteBinding } from '../mapping';
import {
  loadMapping,
  saveMapping,
  getBinding,
  setDriveAppProperties,
} from '../mapping';
import { convertMarkdownToPlainAndStyles, buildDocsStyleUpdateRequests } from '../converter';
import { createSyncContext, SyncContext } from '../services/SyncContext';
import { getSelectedNoteId, getNoteById } from '../services/NoteOperations';
import { getGCSBucketName } from '../services/settings';
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
};

/**
 * Result of a successful push operation
 */
type PushResult = {
  noteId: string;
  fileId: string;
  newRevisionId: string;
  debugLog?: string[];
};

/**
 * Core push logic - extracted to avoid duplication
 */
import * as fs from 'fs';
import * as path from 'path';

// Debug log collector - writes to file for persistence
let debugLogPath: string | null = null;
const debugLines: string[] = [];

function debugLog(message: string) {
  debugLines.push(message);
  // Also write to file for persistence
  if (debugLogPath) {
    fs.appendFileSync(debugLogPath, message + '\n');
  }
}

function clearDebugLog() {
  debugLines.length = 0;
}

function setDebugLogPath(dataDir: string) {
  debugLogPath = path.join(dataDir, 'push-debug.log');
  // Clear the file
  fs.writeFileSync(debugLogPath, '=== Push Debug Log ===\n');
}

export function getDebugLog(): string[] {
  return [...debugLines];
}

export function getDebugLogFromFile(dataDir: string): string {
  const logPath = path.join(dataDir, 'push-debug.log');
  try {
    return fs.readFileSync(logPath, 'utf8');
  } catch {
    return 'No debug log file';
  }
}

async function executePush(
  ctx: SyncContext,
  j: any,
  noteId: string,
  fileId: string
): Promise<{ newRevisionId: string; debugLog: string[] }> {
  const { google, auth, docs, installDir } = ctx;

  debugLog(`=== executePush for note ${noteId} ===`);

  // Read note body (Markdown) using NoteOperations
  const note = await getNoteById(j, noteId, ['id', 'title', 'body']);
  const mdRaw: string = String(note.body ?? '');
  debugLog(`Note body length: ${mdRaw.length}`);
  
  // Convert Markdown to plain text, style ranges, and image positions
  // The converter now also extracts images from markdown
  const { plain, paraRanges, textRanges, imageRanges } = convertMarkdownToPlainAndStyles(mdRaw, { installDir });

  debugLog(`Converted: ${mdRaw.length} chars -> ${plain.length} plain, ${imageRanges.length} images`);
  console.log(`[pushNote] Converted markdown: ${mdRaw.length} chars -> ${plain.length} plain chars`);
  console.log(`[pushNote] Found ${imageRanges.length} images in note`);
  if (imageRanges.length > 0) {
    debugLog( `Image resources: ${JSON.stringify(imageRanges.map(r => r.resourceId))}`);
    console.log(`[pushNote] Image resources:`, imageRanges.map(r => r.resourceId));
  }

  // Check if we have images to process and GCS is configured
  const gcsBucketName = getGCSBucketName(installDir);
  debugLog( `GCS bucket: ${gcsBucketName || 'NOT CONFIGURED'}`);
  console.log(`[pushNote] GCS bucket configured: ${gcsBucketName || 'NOT CONFIGURED'}`);
  
  let uploadedObjects: GCSUploadResult[] = [];
  let resourceIdToUrl = new Map<string, string>();
  
  if (imageRanges.length > 0 && gcsBucketName) {
    debugLog( `Processing ${imageRanges.length} images via GCS`);
    console.log(`[pushNote] Processing ${imageRanges.length} images via GCS bucket: ${gcsBucketName}`);
    
    // Initialize GCS storage client
    debugLog( `Initializing GCS storage client...`);
    const storage = google.storage({ version: 'v1', auth });
    debugLog( `GCS storage client created`);
    
    // Upload images to GCS
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

  // Get current doc state to obtain revisionId and endIndex
  const docRes = await docs.documents.get({ documentId: fileId });
  const revisionId: string = String((docRes.data as any).revisionId || '');
  const body = (docRes.data as any).body || {};
  const content = Array.isArray(body.content) ? body.content : [];
  const endIndex = content.length ? Number(content[content.length - 1].endIndex || 1) : 1;

  // Build content replacement requests
  const requests: any[] = [];
  // Avoid empty delete range (start==end). For empty docs endIndex is often 2.
  if (endIndex > 2) {
    requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } });
  }
  requests.push({ insertText: { location: { index: 1 }, text: plain } });

  // Push with optimistic concurrency
  await docs.documents.batchUpdate({
    documentId: fileId,
    requestBody: {
      requests,
      writeControl: revisionId ? { requiredRevisionId: revisionId } : undefined,
    },
  });

  // Read new revisionId after text insertion
  let afterRes = await docs.documents.get({ documentId: fileId });
  let newRevisionId: string = String((afterRes.data as any).revisionId || '');

  // Apply paragraph and inline styles
  // buildDocsStyleUpdateRequests handles monoFont internally via config
  const styleReqs = buildDocsStyleUpdateRequests(paraRanges, textRanges, { installDir });
  if (styleReqs.length) {
    await docs.documents.batchUpdate({ documentId: fileId, requestBody: { requests: styleReqs } });
  }

  // Insert images if we have any uploaded
  // First, get the actual document length after text insertion
  const docAfterText = await docs.documents.get({ documentId: fileId });
  const bodyAfterText = (docAfterText.data as any).body || {};
  const contentAfterText = Array.isArray(bodyAfterText.content) ? bodyAfterText.content : [];
  const endIndexAfterText = contentAfterText.length ? Number(contentAfterText[contentAfterText.length - 1].endIndex || 1) : 1;
  debugLog(`Document endIndex after text insertion: ${endIndexAfterText}`);
  debugLog(`Image insertion check: uploadedObjects.length=${uploadedObjects.length}, resourceIdToUrl.size=${resourceIdToUrl.size}`);
  if (uploadedObjects.length > 0 && resourceIdToUrl.size > 0) {
    console.log(`[pushNote] Inserting ${uploadedObjects.length} images into doc`);
    debugLog(`Inserting ${uploadedObjects.length} images into doc`);
    
    // Build image insertion requests
    // textOffset of 0 because we're inserting at positions within the already-inserted text
    debugLog(`Building image insert requests...`);
    debugLog(`Plain text length: ${plain.length}, Doc endIndex: ${endIndexAfterText}`);
    debugLog(`First image position: ${imageRanges[0]?.position}, Last image position: ${imageRanges[imageRanges.length-1]?.position}`);
    const imageRequests = buildImageInsertRequests(imageRanges, resourceIdToUrl, 0, debugLog);
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
        // Log the response to see what happened
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
      
      // Get final revisionId after image insertion
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
  const { drive, dataDir } = ctx;
  const mapping = loadMapping(dataDir);

  const nb: NoteBinding = mapping.notes[noteId] || {};
  nb.fileId = fileId;
  nb.lastKnownRevisionId = newRevisionId;
  nb.lastSyncTs = Date.now();
  mapping.notes[noteId] = nb;
  saveMapping(dataDir, mapping);

  // Update Drive appProperties (best-effort)
  try {
    await setDriveAppProperties(drive as unknown as DriveLike, fileId, {
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
  
  // Create sync context with authenticated API clients
  debugLog('Creating sync context...');
  const ctx = await createSyncContext(installDir, dataDir);
  debugLog('Sync context created');

  // Determine the note ID using NoteOperations
  const noteId = params.noteId || await getSelectedNoteId(j);

  // Get binding and validate
  const binding = getBinding(dataDir, noteId);
  if (!binding?.fileId) throw new Error('Note is not bound to a Google Doc.');
  const fileId = binding.fileId;

  // Execute the push
  const result = await executePush(ctx, j, noteId, fileId);

  // Update mapping
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
