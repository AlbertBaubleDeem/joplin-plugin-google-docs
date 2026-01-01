/**
 * exportNotebook - Export a Joplin notebook as individual Google Docs in a folder
 * 
 * Uses GoogleDocsProvider for document operations.
 */

import { loadMapping, saveMapping, bindNote, PLUGIN_ID } from '../mapping';
import { createSyncContext } from '../services/SyncContext';
import { getSelectedFolder, getFolderById, getNotesInFolder } from '../services/NoteOperations';
import { convertMarkdownToPlainAndStyles, buildDocsStyleUpdateRequests } from '../converter';

const APP_PROPERTY_NOTE_ID = 'joplinNoteId';
const APP_PROPERTY_NOTEBOOK_ID = 'joplinNotebookId';

/**
 * Parameters for exportNotebook command
 */
type ExportParams = {
  j: any;
  installDir: string;
  dataDir: string;
  /** Optional folder ID - if not provided, uses selected folder */
  folderId?: string;
};

/**
 * Result of notebook export
 */
type ExportResult = {
  /** ID of the created folder in Drive */
  fileId: string;
  /** Number of notes exported */
  noteCount: number;
};

/**
 * Exports a Joplin notebook as individual Google Docs in a folder.
 * 
 * This function:
 * 1. Gets all notes in the specified notebook
 * 2. Creates a folder in Google Drive for the notebook
 * 3. Creates a Google Doc for each unbound note
 * 4. Binds each note to its corresponding doc
 * 
 * @param args - Export parameters
 * @returns Promise resolving to export result or undefined if nothing to export
 */
export async function exportNotebook(args: ExportParams): Promise<ExportResult | undefined> {
  const { j, installDir, dataDir } = args;

  // Create sync context with authenticated API clients
  const ctx = await createSyncContext(installDir, dataDir);

  // Get the folder to export
  let folderId = args.folderId;
  if (!folderId) {
    const folder = await getSelectedFolder(j);
    if (!folder) {
      throw new Error('Please select a notebook first');
    }
    folderId = folder.id;
  }

  // Get folder details
  const folderData = await getFolderById(j, folderId);
  if (!folderData) {
    throw new Error('Could not find notebook');
  }

  // Get all notes in the folder
  const notes = await getNotesInFolder(j, folderId, {
    fields: ['id', 'title', 'body', 'user_created_time', 'user_updated_time'],
    orderBy: 'user_created_time',
    orderDir: 'ASC',
    limit: 100, // Google Docs max tab limit
  });

  // Check limits
  if (notes.length === 0) {
    throw new Error('Notebook has no notes');
  }

  if (notes.length > 100) {
    throw new Error(`Notebook has ${notes.length} notes, which exceeds Google Docs limit of 100 tabs`);
  }

  if (notes.length > 50) {
    // Warn but continue
    await j.views.dialogs.showMessageBox(
      `Warning: This notebook has ${notes.length} notes. Google Docs supports up to 100 tabs, ` +
      `but performance may degrade with many tabs. Continuing...`
    );
  }

  // Filter out already synced notes
  const mapping = loadMapping(dataDir);
  const unboundNotes = notes.filter((note: any) => !mapping.notes[note.id]?.fileId);

  if (unboundNotes.length === 0) {
    await j.views.dialogs.showMessageBox(
      'All notes in this notebook are already synced to Google Docs. Nothing to export.'
    );
    return;
  }

  const boundCount = notes.length - unboundNotes.length;
  if (boundCount > 0) {
    await j.views.dialogs.showMessageBox(
      `${boundCount} notes in this notebook are already synced and will be skipped. ` +
      `${unboundNotes.length} unsynced notes will be exported to a new folder.`
    );
  }

  // Ensure sync folder exists via provider
  const syncFolderId = await ctx.provider.ensureSyncFolder();

  // Create a folder for the notebook inside sync folder via provider
  console.log('[exportNotebook] Creating folder for notebook:', folderData.title);
  const notebookFolder = await ctx.provider.createFolder(
    folderData.title || 'Untitled Notebook',
    syncFolderId
  );
  const notebookFolderId = notebookFolder.id;

  // Create individual Google Docs for each note
  console.log('[exportNotebook] Creating individual documents for each note in the notebook');

  const converterOpts = { installDir };

  // Create a document for each unbound note
  for (let i = 0; i < unboundNotes.length; i++) {
    const note = unboundNotes[i];
    console.log(`[exportNotebook] Creating document ${i + 1}/${unboundNotes.length} for note: ${note.title}`);

    // Create the document via provider (in the notebook folder)
    const createResult = await ctx.provider.createDocument(
      note.title || `Note ${i + 1}`,
      notebookFolderId
    );
    const docId = createResult.metadata.id;

    // Convert note content to Google Docs format
    const { plain, paraRanges, textRanges } = convertMarkdownToPlainAndStyles(
      note.body || '',
      converterOpts
    );

    // Update document with content via provider
    await ctx.provider.updateDocument(docId, { plainText: plain });

    // Apply formatting via provider
    const formatRequests = buildDocsStyleUpdateRequests(paraRanges, textRanges, { installDir });
    if (formatRequests.length > 0) {
      await ctx.provider.applyFormattingRequests(docId, formatRequests);
    }

    // Set app properties for binding via provider
    await ctx.provider.updateAppProperties(docId, {
      [APP_PROPERTY_NOTE_ID]: note.id,
      pluginId: PLUGIN_ID,
      [APP_PROPERTY_NOTEBOOK_ID]: folderId!,
    });

    // Update local binding for this note
    bindNote(dataDir, note.id, {
      fileId: docId,
      lastSyncTs: Date.now(),
    });
    console.log(`[exportNotebook] Bound note ${note.id} to doc ${docId}`);
  }

  // Set notebook folder app properties
  // Note: Using direct drive call since provider doesn't have folder-specific appProperties method
  await ctx.drive.files.update({
    fileId: notebookFolderId,
    requestBody: {
      appProperties: {
        [APP_PROPERTY_NOTEBOOK_ID]: folderId,
        pluginId: PLUGIN_ID,
        noteCount: String(unboundNotes.length),
      },
    },
    supportsAllDrives: true,
  });

  // Update local mappings - reload to get the note bindings we just created
  const updatedMapping = loadMapping(dataDir);
  updatedMapping.notebooks[folderId!] = {
    fileId: notebookFolderId,
    noteIds: unboundNotes.map((n: any) => n.id),
    lastSyncTs: Date.now(),
  };
  saveMapping(dataDir, updatedMapping);

  console.log(
    `[exportNotebook] Successfully created notebook folder ${notebookFolderId} with ${unboundNotes.length} documents`
  );

  return {
    fileId: notebookFolderId,
    noteCount: unboundNotes.length,
  };
}
