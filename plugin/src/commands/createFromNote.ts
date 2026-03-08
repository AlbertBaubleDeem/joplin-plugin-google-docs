/**
 * createFromNote - Create a new Google Doc from a Joplin note
 * 
 * Uses GoogleDocsProvider for document operations.
 * Creates the doc, binds it, and immediately pushes the note content.
 */

import { bindNote, pluginId } from '../mapping';
import { createSyncContext } from '../services/syncContext';
import { getSelectedNoteId, getNoteById } from '../services/noteOperations';
import { pushNoteById } from './pushNote';

/**
 * Parameters for createFromNote command
 */
type Params = {
  j: any;
  installDir: string;
  dataDir: string;
  /** Optional noteId - if not provided, uses the currently selected note */
  noteId?: string;
};

/**
 * Result of creating a document from a note
 */
type CreateResult = {
  noteId: string;
  newFileId: string;
  syncFolderId: string;
};

/**
 * Creates a new Google Doc from a Joplin note.
 * 
 * This function:
 * 1. Ensures the sync folder exists (via provider)
 * 2. Gets the note title
 * 3. Creates a new Google Doc in the sync folder (via provider)
 * 4. Sets appProperties to bind the doc to the note (via provider)
 * 5. Updates the local mapping
 * 
 * @param params - Create parameters including Joplin API, paths, and optional noteId
 * @returns Promise resolving to creation result with IDs
 * @throws Error if no note is selected/specified
 */
export async function createFromNote(params: Params): Promise<CreateResult> {
  const { j, installDir, dataDir } = params;

  const ctx = await createSyncContext(installDir, dataDir, j);
  const syncFolderId = await ctx.provider.ensureSyncFolder();

  const noteId = params.noteId || await getSelectedNoteId(j);

  const note = await getNoteById(j, noteId, ['id', 'title']);
  const baseName: string = (note.title && String(note.title).trim()) || 'Untitled Note';

  const createResult = await ctx.provider.createDocument(baseName, syncFolderId);
  const newFileId = createResult.metadata.id;

  await ctx.provider.setDocumentBinding(newFileId, {
    noteId,
    pluginId: pluginId,
    version: '1',
  });
  bindNote(dataDir, noteId, { fileId: newFileId });

  await pushNoteById({ j, installDir, dataDir, noteId });

  return { noteId, newFileId, syncFolderId };
}
