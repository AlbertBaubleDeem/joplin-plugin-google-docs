import type { DriveLike } from '../mapping';
import { createSyncContext } from '../services/SyncContext';
import { ensureSyncFolder } from '../services/SyncFolderManager';
import { determineTargetFolder } from '../services/NoteOperations';
import {
  bindNote,
  loadMapping,
  setDriveAppProperties,
  APP_PROPERTY_VERSION,
  APP_PROPERTY_PLUGIN_ID,
  PLUGIN_ID,
} from '../mapping';

type Params = {
  j: any;
  installDir: string;
  dataDir: string;
  sourceFileId?: string;
  deleteOriginal?: boolean;
};

export async function migrateToAppDoc(params: Params): Promise<{
  sourceFileId: string;
  newFileId: string;
  noteId: string;
  syncFolderId: string;
}> {
  const { j, installDir, dataDir } = params;
  
  // Create sync context with authenticated API clients
  const ctx = await createSyncContext(installDir, dataDir);
  const { drive } = ctx;

  // Resolve or create sync folder using the consolidated service
  const syncFolderId = await ensureSyncFolder(drive, dataDir);

  // Determine source file and target note
  let sourceFileId = params.sourceFileId || '';
  let noteId: string | undefined;
  const mapping = loadMapping(dataDir);
  if (!sourceFileId) {
    const selected = await j.workspace.selectedNoteIds();
    if (selected && selected.length) {
      noteId = selected[0];
      if (noteId) {
        const b = mapping.notes[noteId];
        if (b?.fileId) sourceFileId = b.fileId;
      }
    }
  }
  if (!sourceFileId) throw new Error('No source fileId provided and current note is not bound.');

  // Get source name
  const srcMeta = await drive.files.get({
    fileId: sourceFileId,
    fields: 'id,name',
    supportsAllDrives: true,
  });
  const baseName = (srcMeta.data.name as string) || 'Migrated Document';

  // Create a copy owned by the app under the sync folder
  const copied = await drive.files.copy({
    fileId: sourceFileId,
    requestBody: {
      name: baseName.endsWith(' (Migrated)') ? baseName : `${baseName} (Migrated)`,
      parents: [syncFolderId],
    },
    fields: 'id',
    supportsAllDrives: true,
  });
  const newFileId = copied.data.id as string;

  // If no note preselected, create a new note; else rebind existing note
  if (!noteId) {
    const parentId = await determineTargetFolder(j);
    const newNote = await j.data.post(['notes'], null, { title: baseName, body: '', parent_id: parentId });
    noteId = newNote.id;
  }

  // Write appProperties on the new file and bind locally
  await setDriveAppProperties(drive as unknown as DriveLike, newFileId, {
    joplinNoteId: noteId!,
    [APP_PROPERTY_PLUGIN_ID]: PLUGIN_ID,
    [APP_PROPERTY_VERSION]: '1',
  });
  bindNote(dataDir, noteId!, { fileId: newFileId });

  // Optionally mark or delete the original
  if (params.deleteOriginal) {
    try {
      await drive.files.delete({ fileId: sourceFileId, supportsAllDrives: true });
    } catch (_) { /* ignore */ }
  } else {
    try {
      await drive.files.update({
        fileId: sourceFileId,
        requestBody: { name: `${baseName} (Legacy)` },
        fields: 'id',
        supportsAllDrives: true,
      });
    } catch (_) { /* ignore */ }
  }

  return { sourceFileId, newFileId, noteId: noteId!, syncFolderId };
}
