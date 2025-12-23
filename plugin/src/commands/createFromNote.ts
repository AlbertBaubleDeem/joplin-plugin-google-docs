/**
 * createFromNote - Create a new Google Doc from a Joplin note
 */

import type { DriveLike } from '../mapping';
import {
  bindNote,
  setDriveAppProperties,
  APP_PROPERTY_PLUGIN_ID,
  APP_PROPERTY_VERSION,
  APP_PROPERTY_NOTE_ID,
  PLUGIN_ID,
} from '../mapping';
import { createSyncContext } from '../services/SyncContext';
import { ensureSyncFolder } from '../services/SyncFolderManager';
import { getSelectedNoteId, getNoteById } from '../services/NoteOperations';

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
 * 1. Ensures the sync folder exists
 * 2. Gets the note title
 * 3. Creates a new Google Doc in the sync folder
 * 4. Sets appProperties to bind the doc to the note
 * 5. Updates the local mapping
 * 
 * @param params - Create parameters including Joplin API, paths, and optional noteId
 * @returns Promise resolving to creation result with IDs
 * @throws Error if no note is selected/specified
 */
export async function createFromNote(params: Params): Promise<CreateResult> {
  const { j, installDir, dataDir } = params;

  // Create sync context with authenticated API clients
  const ctx = await createSyncContext(installDir, dataDir);

  // Ensure sync folder exists
  const syncFolderId = await ensureSyncFolder(ctx.drive, dataDir);

  // Determine the note ID
  let noteId: string;
  if (params.noteId) {
    noteId = params.noteId;
  } else {
    noteId = await getSelectedNoteId(j);
  }

  // Get note title
  const note = await getNoteById(j, noteId, ['id', 'title']);
  const baseName: string = (note.title && String(note.title).trim()) || 'Untitled Note';

  // Create Google Doc under the sync folder (app-owned)
  const createdDoc = await ctx.drive.files.create({
    requestBody: {
      name: baseName,
      parents: [syncFolderId],
      mimeType: 'application/vnd.google-apps.document',
    },
    fields: 'id',
    supportsAllDrives: true,
  });
  const newFileId = createdDoc.data.id as string;

  // Set appProperties and bind locally
  await setDriveAppProperties(ctx.drive as unknown as DriveLike, newFileId, {
    [APP_PROPERTY_NOTE_ID]: noteId,
    [APP_PROPERTY_PLUGIN_ID]: PLUGIN_ID,
    [APP_PROPERTY_VERSION]: '1',
  });
  bindNote(dataDir, noteId, { fileId: newFileId });

  return { noteId, newFileId, syncFolderId };
}
