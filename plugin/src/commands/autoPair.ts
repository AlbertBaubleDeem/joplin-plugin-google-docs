/**
 * autoPair - Automatically pair Google Docs in a folder with Joplin notes
 */

import type { DriveLike } from '../mapping';
import {
  bindNote,
  loadMapping,
  setDriveAppProperties,
  APP_PROPERTY_VERSION,
  APP_PROPERTY_PLUGIN_ID,
  PLUGIN_ID,
} from '../mapping';
import { ensureSyncFolder } from '../services/SyncFolderManager';
import { determineTargetFolder } from '../services/NoteOperations';

/**
 * Parameters for autoPair command
 * Note: This command receives pre-created auth/google from autoPairRun
 */
type AutoPairParams = {
  j: any;
  google: any;
  auth: any;
  installDir: string;
  dataDir: string;
  /** Optional folder ID to use - if not provided, resolves/creates sync folder */
  folderId: string;
};

/**
 * Result of auto-pairing operation
 */
type AutoPairResult = {
  /** Number of new notes created */
  created: number;
  /** Number of existing docs that already had bindings */
  linkedExisting: number;
  /** Number of mappings that were ensured/repaired */
  ensuredMapping: number;
  /** Total documents scanned */
  scanned: number;
  /** The folder ID used */
  folderId: string;
};

/**
 * Automatically pairs Google Docs in a folder with Joplin notes.
 * 
 * For each Google Doc in the folder:
 * - If it has a joplinNoteId appProperty, ensures local mapping exists
 * - If it has no binding, creates a new Joplin note and binds it
 * 
 * @param params - AutoPair parameters including API clients and folder ID
 * @returns Promise resolving to pairing statistics
 */
export async function autoPair(params: AutoPairParams): Promise<AutoPairResult> {
  const { j, google, auth, dataDir } = params;
  const drive = google.drive({ version: 'v3', auth });

  // Resolve or create sync folder
  let folderId = params.folderId;
  if (!folderId) {
    folderId = await ensureSyncFolder(drive, dataDir);
  }

  // Determine target notebook (folder) for new notes
  const targetFolderId = await determineTargetFolder(j);

  // Initialize counters
  let created = 0;
  let linkedExisting = 0;
  let ensuredMapping = 0;
  let scanned = 0;

  // Pagination loop to scan all docs in folder
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

    for (const f of data.files || []) {
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
        [APP_PROPERTY_PLUGIN_ID]: PLUGIN_ID,
      });

      bindNote(dataDir, newNote.id, { fileId });
      created += 1;
    }

    pageToken = data.nextPageToken as string | undefined;
  } while (pageToken);

  return { created, linkedExisting, ensuredMapping, scanned, folderId };
}
