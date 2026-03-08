/**
 * SyncFolderManager - Consolidates sync folder resolution and creation
 * 
 * This module provides a single point for managing the Drive sync folder,
 * eliminating duplicated folder resolution logic across commands.
 */

import {
  loadMapping,
  setSyncFolderId,
  appPropertyPluginId,
  pluginId,
} from '../mapping';
import { settingKeys } from './settings';

/** Default name for the sync folder in Google Drive */
export const syncFolderName = 'Joplin Google Docs Sync';

/**
 * Options for sync folder resolution
 */
export interface EnsureSyncFolderOptions {
  /** Override folder ID to use (skips resolution if provided) */
  folderId?: string;
  /** Custom folder name (defaults to syncFolderName) */
  folderName?: string;
  /** Joplin API object for checking settings (optional but recommended) */
  joplin?: any;
}

/**
 * Ensures a sync folder exists in Google Drive, creating one if necessary.
 * 
 * Resolution order:
 * 1. Use provided folderId if specified
 * 2. Check Joplin settings (settingKeys.SYNC_FOLDER_ID)
 * 3. Check local mapping cache for syncFolderId
 * 4. Search Drive for folder with pluginId appProperty
 * 5. Create new folder if not found
 * 
 * @param drive - Google Drive API client
 * @param dataDir - Path to plugin data directory (for mapping cache)
 * @param options - Optional configuration (pass joplin for settings check)
 * @returns Promise resolving to the sync folder ID
 * 
 * @example
 * ```typescript
 * const ctx = await createSyncContext(installDir, dataDir);
 * const syncFolderId = await ensureSyncFolder(ctx.drive, dataDir, { joplin });
 * ```
 */
export async function ensureSyncFolder(
  drive: any,
  dataDir: string,
  options: EnsureSyncFolderOptions = {}
): Promise<string> {
  const folderName = options.folderName || syncFolderName;

  // 1. Use provided folderId if specified
  if (options.folderId) {
    // Cache it locally
    setSyncFolderId(dataDir, options.folderId);
    return options.folderId;
  }

  // 2. Check Joplin settings for sync folder ID
  if (options.joplin) {
    try {
      const settingsFolderId = await options.joplin.settings.value(settingKeys.SYNC_FOLDER_ID);
      if (settingsFolderId && typeof settingsFolderId === 'string' && settingsFolderId.trim()) {
        const folderId = settingsFolderId.trim();
        // Cache it locally for future use
        setSyncFolderId(dataDir, folderId);
        return folderId;
      }
    } catch {
      // Settings not available, fall through to cache
    }
  }

  // 3. Check local mapping cache
  const cached = loadMapping(dataDir).syncFolderId;
  if (cached) {
    return cached;
  }

  // 4. Search Drive for folder with our plugin marker
  const { data } = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and appProperties has { key='${appPropertyPluginId}' and value='${pluginId}' } and trashed=false`,
    fields: 'files(id,name,appProperties)',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    pageSize: 50,
    spaces: 'drive',
  });

  if (data.files && data.files.length > 0) {
    // Filter out notebook subfolders (they have joplinNotebookId property)
    // The sync root folder should NOT have joplinNotebookId
    const syncRootCandidates = data.files.filter((f: any) => {
      const props = f.appProperties || {};
      return !props.joplinNotebookId;
    });
    
    if (syncRootCandidates.length > 0) {
      const folderId = syncRootCandidates[0].id as string;
      setSyncFolderId(dataDir, folderId);
      return folderId;
    }
  }

  // 5. Create new folder
  const created = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: { [appPropertyPluginId]: pluginId },
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

