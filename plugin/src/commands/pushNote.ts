import type { DriveLike, NoteBinding } from '../mapping';
import {
  loadMapping,
  saveMapping,
  getBinding,
  setDriveAppProperties,
} from '../mapping';
import { convertMarkdownToPlainAndStyles, buildDocsStyleUpdateRequests, loadMdMappingConfig } from '../converter';
import { processImages, buildImageInsertRequests } from '../imageHandler';
import { createSyncContext, SyncContext } from '../services/SyncContext';

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
};

/**
 * Core push logic - extracted to avoid duplication
 */
async function executePush(
  ctx: SyncContext,
  j: any,
  noteId: string,
  fileId: string
): Promise<{ newRevisionId: string }> {
  const { docs, drive, installDir, dataDir } = ctx;

  // Read note body (Markdown)
  const note = await j.data.get(['notes', noteId], { fields: ['id', 'title', 'body'] });
  const mdRaw: string = String(note.body ?? '');
  const { plain, paraRanges, textRanges, imageRanges } = convertMarkdownToPlainAndStyles(mdRaw, { installDir });

  const mappingCfg = loadMdMappingConfig(installDir);
  const monoFont = mappingCfg?.code?.monoFont || 'Roboto Mono';

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

  // Read new revisionId
  const afterRes = await docs.documents.get({ documentId: fileId });
  const newRevisionId: string = String((afterRes.data as any).revisionId || '');

  // Apply paragraph and inline styles using converter heuristics
  const styleReqs = buildDocsStyleUpdateRequests(paraRanges, textRanges, { monoFont });
  if (styleReqs.length) {
    await docs.documents.batchUpdate({ documentId: fileId, requestBody: { requests: styleReqs } });
  }

  // Process and insert images if present
  if (imageRanges && imageRanges.length > 0) {
    const mapping = loadMapping(dataDir);
    const syncFolderId = mapping.syncFolderId;

    if (syncFolderId) {
      try {
        // Upload images to Drive
        const resourceIdToDriveId = await processImages(j, drive, imageRanges, syncFolderId);

        // Build image insertion requests
        const imageRequests = buildImageInsertRequests(imageRanges, resourceIdToDriveId);

        if (imageRequests.length > 0) {
          await docs.documents.batchUpdate({
            documentId: fileId,
            requestBody: { requests: imageRequests },
          });
        }
      } catch (imageError: any) {
        console.error('Image insertion error:', imageError);
        // Continue with the push even if images fail - content is already saved
      }
    }
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
  
  // Create sync context with authenticated API clients
  const ctx = await createSyncContext(installDir, dataDir);

  // Determine the note ID
  let noteId: string;
  if (params.noteId) {
    noteId = params.noteId;
  } else {
    const selected = await j.workspace.selectedNoteIds();
    if (!selected || !selected.length) throw new Error('No selected note.');
    noteId = selected[0];
  }

  // Get binding and validate
  const binding = getBinding(dataDir, noteId);
  if (!binding?.fileId) throw new Error('Note is not bound to a Google Doc.');
  const fileId = binding.fileId;

  // Execute the push
  const { newRevisionId } = await executePush(ctx, j, noteId, fileId);

  // Update mapping
  await updateMappingAfterPush(ctx, noteId, fileId, newRevisionId);

  return { noteId, fileId, newRevisionId };
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
