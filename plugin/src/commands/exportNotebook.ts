/**
 * exportNotebook - Export a Joplin notebook as individual Google Docs in a folder
 * 
 * Uses GoogleDocsProvider for document operations.
 */

import { loadMapping, saveMapping, bindNote, pluginId } from '../mapping';
import { createSyncContext } from '../services/syncContext';
import { getSelectedFolder, getFolderById, getNotesInFolder } from '../services/noteOperations';
import { pushNoteById } from './pushNote';
import { showWarningDialog, showInfoDialog } from '../services/styledDialogs';

const appPropertyNoteId = 'joplinNoteId';
const appPropertyNotebookId = 'joplinNotebookId';

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

  const ctx = await createSyncContext(installDir, dataDir, j);

  let folderId = args.folderId;
  if (!folderId) {
    const folder = await getSelectedFolder(j);
    if (!folder) {
      throw new Error('Please select a notebook first');
    }
    folderId = folder.id;
  }

  const folderData = await getFolderById(j, folderId);
  if (!folderData) {
    throw new Error('Could not find notebook');
  }

  const notes = await getNotesInFolder(j, folderId, {
    fields: ['id', 'title', 'body', 'user_created_time', 'user_updated_time'],
    orderBy: 'user_created_time',
    orderDir: 'ASC',
    limit: 100, // Google Docs max tab limit
  });

  if (notes.length === 0) {
    throw new Error('Notebook has no notes');
  }

  if (notes.length > 100) {
    throw new Error(`Notebook has ${notes.length} notes, which exceeds Google Docs limit of 100 tabs`);
  }

  if (notes.length > 50) {
    // Warn but continue
    await showWarningDialog(j, 'Large Notebook', `This notebook has ${notes.length} notes. Performance may degrade with many documents.`);
  }

  const mapping = loadMapping(dataDir);
  const unboundNotes = notes.filter((note: any) => !mapping.notes[note.id]?.fileId);

  if (unboundNotes.length === 0) {
    await showInfoDialog(j, { title: 'Already Synced', message: 'All notes in this notebook are already synced.', icon: 'ℹ️' });
    return;
  }

  const boundCount = notes.length - unboundNotes.length;
  if (boundCount > 0) {
    await showInfoDialog(j, { 
      title: 'Partial Export', 
      message: `${boundCount} notes already synced (skipped). Exporting ${unboundNotes.length} new notes.`,
      icon: 'ℹ️' 
    });
  }

  const syncFolderId = await ctx.provider.ensureSyncFolder();

  const notebookFolder = await ctx.provider.createFolder(
    folderData.title || 'Untitled Notebook',
    syncFolderId
  );
  const notebookFolderId = notebookFolder.id;

  for (let i = 0; i < unboundNotes.length; i++) {
    const note = unboundNotes[i];

    const createResult = await ctx.provider.createDocument(
      note.title || `Note ${i + 1}`,
      notebookFolderId
    );
    const docId = createResult.metadata.id;

    await ctx.provider.updateAppProperties(docId, {
      [appPropertyNoteId]: note.id,
      pluginId: pluginId,
      [appPropertyNotebookId]: folderId!,
    });

    bindNote(dataDir, note.id, {
      fileId: docId,
      lastSyncTs: Date.now(),
    });
    await pushNoteById({ j, installDir, dataDir, noteId: note.id });
  }

  // Using direct drive call since provider doesn't have folder-specific appProperties method
  await ctx.drive.files.update({
    fileId: notebookFolderId,
    requestBody: {
      appProperties: {
        [appPropertyNotebookId]: folderId,
        pluginId: pluginId,
        noteCount: String(unboundNotes.length),
      },
    },
    supportsAllDrives: true,
  });

  const updatedMapping = loadMapping(dataDir);
  updatedMapping.notebooks[folderId!] = {
    fileId: notebookFolderId,
    noteIds: unboundNotes.map((n: { id: string }) => n.id),
    lastSyncTs: Date.now(),
  };
  saveMapping(dataDir, updatedMapping);

  return {
    fileId: notebookFolderId,
    noteCount: unboundNotes.length,
  };
}
