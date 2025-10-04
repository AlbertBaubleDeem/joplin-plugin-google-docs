import type { DriveLike } from '../mapping';
import {
  bindNote,
  loadMapping,
  setDriveAppProperties,
  APP_PROPERTY_VERSION,
  APP_PROPERTY_NOTE_ID,
  APP_PROPERTY_PLUGIN_ID,
  PLUGIN_ID,
  setSyncFolderId,
} from '../mapping';

type Params = {
  j: any;
  google: any;
  auth: any;
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
  const { j, google, auth, dataDir } = params;
  const drive = google.drive({ version: 'v3', auth });
  const docs = google.docs({ version: 'v1', auth });

  // Resolve or create sync folder
  let syncFolderId = loadMapping(dataDir).syncFolderId || '';
  if (!syncFolderId) {
    // Search for folder with our plugin marker
    const { data } = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.folder' and appProperties has { key='" + APP_PROPERTY_PLUGIN_ID + "' and value='" + PLUGIN_ID + "' } and trashed=false",
      fields: 'files(id,name)',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      pageSize: 50,
      spaces: 'drive',
    });
    if (data.files && data.files.length) {
      syncFolderId = data.files[0].id as string;
    } else {
      const created = await drive.files.create({
        requestBody: {
          name: 'Joplin Google Docs Sync',
          mimeType: 'application/vnd.google-apps.folder',
          appProperties: { [APP_PROPERTY_PLUGIN_ID]: PLUGIN_ID },
        },
        fields: 'id',
        supportsAllDrives: true,
      });
      syncFolderId = created.data.id as string;
    }
    setSyncFolderId(dataDir, syncFolderId);
  }

  // Determine source file and target note
  let sourceFileId = params.sourceFileId || '';
  let noteId: string | undefined;
  const mapping = loadMapping(dataDir);
  if (!sourceFileId) {
    const selected = await j.workspace.selectedNoteIds();
    if (selected && selected.length) {
      noteId = selected[0];
      const b = mapping.notes[noteId];
      if (b?.fileId) sourceFileId = b.fileId;
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
    // Choose notebook: current selection's parent or first folder
    let parentId: string | undefined;
    const sel = await j.workspace.selectedNoteIds();
    if (sel && sel.length) {
      const note = await j.data.get(['notes', sel[0]], { fields: ['parent_id'] });
      parentId = note.parent_id;
    }
    if (!parentId) {
      const folders = await j.data.get(['folders'], { limit: 1, fields: ['id'] });
      if (folders && folders.items && folders.items.length) parentId = folders.items[0].id;
    }
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


