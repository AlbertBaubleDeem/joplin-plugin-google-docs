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

type AutoPairParams = {
  j: any;
  google: any;
  auth: any;
  installDir: string;
  dataDir: string;
  folderId: string;
};

export async function autoPair(params: AutoPairParams): Promise<{ created: number; linkedExisting: number; ensuredMapping: number; scanned: number; folderId: string }> {
  const { j, google, auth, dataDir } = params;
  const drive = google.drive({ version: 'v3', auth });

  // Resolve or create sync folder
  let folderId = params.folderId;
  if (!folderId) {
    // Try mapping.json cached id
    const cached = loadMapping(dataDir).syncFolderId;
    if (cached) folderId = cached;
  }
  if (!folderId) {
    // Search for a folder with our plugin marker
    const { data } = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.folder' and appProperties has { key='" + APP_PROPERTY_PLUGIN_ID + "' and value='" + PLUGIN_ID + "' } and trashed=false",
      fields: 'files(id,name,appProperties),nextPageToken',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      pageSize: 50,
      spaces: 'drive',
    });
    if (data.files && data.files.length) {
      folderId = data.files[0].id as string;
    }
  }
  if (!folderId) {
    // Create in My Drive
    const created = await drive.files.create({
      requestBody: {
        name: 'Joplin Google Docs Sync',
        mimeType: 'application/vnd.google-apps.folder',
        appProperties: { [APP_PROPERTY_PLUGIN_ID]: PLUGIN_ID },
      },
      fields: 'id',
      supportsAllDrives: true,
    });
    folderId = created.data.id as string;
  }
  // Cache locally
  setSyncFolderId(dataDir, folderId);

  // Determine target notebook (folder) for new notes
  let targetFolderId: string | undefined;
  const selected = await j.workspace.selectedNoteIds();
  if (selected && selected.length) {
    const note = await j.data.get(['notes', selected[0]], { fields: ['id', 'parent_id'] });
    targetFolderId = note.parent_id;
  }
  if (!targetFolderId) {
    const folders = await j.data.get(['folders'], { limit: 1, fields: ['id'] });
    if (folders && folders.items && folders.items.length) targetFolderId = folders.items[0].id;
  }
  if (!targetFolderId) throw new Error('Could not determine a target Joplin notebook to create notes');

  let created = 0;
  let linkedExisting = 0;
  let ensuredMapping = 0;
  let scanned = 0;

  let pageToken: string | undefined = undefined;
  const mimeDoc = "mimeType='application/vnd.google-apps.document'";
  const qBase = `'${folderId}' in parents and ${mimeDoc} and trashed=false`;

  const mapping = loadMapping(dataDir);

  do {
    const { data } = await drive.files.list({
      q: qBase,
      fields: 'nextPageToken, files(id,name,appProperties)',
      pageSize: 1000,
      pageToken,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });

    for (const f of (data.files || [])) {
      scanned += 1;
      const fileId: string = f.id as string;
      const name: string = f.name as string;
      const appProps: Record<string, string> = (f.appProperties as any) || {};
      const existingNoteId = appProps['joplinNoteId'];

      if (existingNoteId) {
        // Ensure mapping contains this pairing
        if (!mapping.notes[existingNoteId] || mapping.notes[existingNoteId].fileId !== fileId) {
          bindNote(dataDir, existingNoteId, { fileId });
          ensuredMapping += 1;
        }
        linkedExisting += 1;
        continue;
      }

      // Create a new Joplin note and bind
      const newNote = await j.data.post(['notes'], null, {
        title: name,
        body: '',
        parent_id: targetFolderId,
      });

      await setDriveAppProperties(drive as unknown as DriveLike, fileId, {
        joplinNoteId: newNote.id,
        [APP_PROPERTY_VERSION]: '1',
      });

      bindNote(dataDir, newNote.id, { fileId });
      created += 1;
    }

    pageToken = data.nextPageToken as string | undefined;
  } while (pageToken);

  return { created, linkedExisting, ensuredMapping, scanned, folderId };
}



