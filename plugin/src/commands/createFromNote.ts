import type { DriveLike } from '../mapping';
import { getAuthFromInstallDir } from '../services/auth';
import {
  loadMapping,
  setSyncFolderId,
  bindNote,
  setDriveAppProperties,
  APP_PROPERTY_PLUGIN_ID,
  APP_PROPERTY_VERSION,
  APP_PROPERTY_NOTE_ID,
  PLUGIN_ID,
} from '../mapping';

type Params = {
  j: any;
  installDir: string;
  dataDir: string;
  noteId?: string;
};

export async function createFromNote(params: Params): Promise<{
  noteId: string;
  newFileId: string;
  syncFolderId: string;
}> {
  const { j, installDir, dataDir } = params;
  const { google, auth } = await getAuthFromInstallDir(installDir);
  const drive = google.drive({ version: 'v3', auth });

  // Resolve or create sync folder (marked with our pluginId appProperty)
  let syncFolderId = loadMapping(dataDir).syncFolderId || '';
  if (!syncFolderId) {
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

  // Determine the note to create from
  let noteId = params.noteId || '';
  if (!noteId) {
    const selected = await j.workspace.selectedNoteIds();
    if (selected && selected.length) noteId = selected[0];
  }
  if (!noteId) throw new Error('No selected note.');

  const note = await j.data.get(['notes', noteId], { fields: ['id', 'title'] });
  const baseName: string = (note.title && String(note.title).trim()) || 'Untitled Note';

  // Create Google Doc under the sync folder (app-owned)
  const createdDoc = await drive.files.create({
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
  await setDriveAppProperties(drive as unknown as DriveLike, newFileId, {
    [APP_PROPERTY_NOTE_ID]: noteId,
    [APP_PROPERTY_PLUGIN_ID]: PLUGIN_ID,
    [APP_PROPERTY_VERSION]: '1',
  });
  bindNote(dataDir, noteId, { fileId: newFileId });

  return { noteId, newFileId, syncFolderId };
}


