/**
 * SyncFolderManager - Consolidates sync folder resolution and creation
 * 
 * This module provides a single point for managing the Drive sync folder,
 * eliminating duplicated folder resolution logic across commands.
 */

import {
  loadMapping,
  setSyncFolderId,
  APP_PROPERTY_PLUGIN_ID,
  PLUGIN_ID,
} from '../mapping';

/** Default name for the sync folder in Google Drive */
export const SYNC_FOLDER_NAME = 'Joplin Google Docs Sync';

/**
 * Options for sync folder resolution
 */
export interface EnsureSyncFolderOptions {
  /** Override folder ID to use (skips resolution if provided) */
  folderId?: string;
  /** Custom folder name (defaults to SYNC_FOLDER_NAME) */
  folderName?: string;
}

/**
 * Ensures a sync folder exists in Google Drive, creating one if necessary.
 * 
 * Resolution order:
 * 1. Use provided folderId if specified
 * 2. Check local mapping cache for syncFolderId
 * 3. Search Drive for folder with pluginId appProperty
 * 4. Create new folder if not found
 * 
 * @param drive - Google Drive API client
 * @param dataDir - Path to plugin data directory (for mapping cache)
 * @param options - Optional configuration
 * @returns Promise resolving to the sync folder ID
 * 
 * @example
 * ```typescript
 * const ctx = await createSyncContext(installDir, dataDir);
 * const syncFolderId = await ensureSyncFolder(ctx.drive, dataDir);
 * ```
 */
export async function ensureSyncFolder(
  drive: any,
  dataDir: string,
  options: EnsureSyncFolderOptions = {}
): Promise<string> {
  const folderName = options.folderName || SYNC_FOLDER_NAME;

  // 1. Use provided folderId if specified
  if (options.folderId) {
    // Cache it locally
    setSyncFolderId(dataDir, options.folderId);
    return options.folderId;
  }

  // 2. Check local mapping cache
  const cached = loadMapping(dataDir).syncFolderId;
  if (cached) {
    return cached;
  }

  // 3. Search Drive for folder with our plugin marker
  const { data } = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and appProperties has { key='${APP_PROPERTY_PLUGIN_ID}' and value='${PLUGIN_ID}' } and trashed=false`,
    fields: 'files(id,name)',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    pageSize: 50,
    spaces: 'drive',
  });

  if (data.files && data.files.length > 0) {
    const folderId = data.files[0].id as string;
    setSyncFolderId(dataDir, folderId);
    return folderId;
  }

  // 4. Create new folder
  const created = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: { [APP_PROPERTY_PLUGIN_ID]: PLUGIN_ID },
    },
    fields: 'id',
    supportsAllDrives: true,
  });

  const folderId = created.data.id as string;
  setSyncFolderId(dataDir, folderId);
  return folderId;
}

/**
 * Creates a subfolder within the sync folder.
 * 
 * @param drive - Google Drive API client
 * @param parentFolderId - ID of the parent folder
 * @param folderName - Name for the new folder
 * @param appProperties - Optional app properties to set on the folder
 * @returns Promise resolving to the new folder ID
 */
export async function createSubfolder(
  drive: any,
  parentFolderId: string,
  folderName: string,
  appProperties?: Record<string, string>
): Promise<string> {
  const requestBody: any = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentFolderId],
  };

  if (appProperties) {
    requestBody.appProperties = appProperties;
  }

  const created = await drive.files.create({
    requestBody,
    fields: 'id',
    supportsAllDrives: true,
  });

  return created.data.id as string;
}

/**
 * Gets the current sync folder ID from local cache without querying Drive.
 * 
 * @param dataDir - Path to plugin data directory
 * @returns The cached sync folder ID or undefined if not set
 */
export function getCachedSyncFolderId(dataDir: string): string | undefined {
  return loadMapping(dataDir).syncFolderId;
}

