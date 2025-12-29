/**
 * SyncContext - Consolidates authentication and API client creation
 * 
 * This module provides a single point for creating authenticated API clients,
 * eliminating the repeated auth + client creation pattern across commands.
 */

import { getAuthFromInstallDir } from './auth';

/**
 * Context object containing all authenticated API clients and paths
 * needed for sync operations.
 */
export interface SyncContext {
  /** The googleapis module */
  google: any;
  /** OAuth2 auth client */
  auth: any;
  /** Pre-created Google Drive client (v3) */
  drive: any;
  /** Pre-created Google Docs client (v1) */
  docs: any;
  /** Path to the plugin installation directory */
  installDir: string;
  /** Path to the plugin data directory */
  dataDir: string;
}

/**
 * Creates a fully initialized SyncContext with authenticated API clients.
 * 
 * @param installDir - Path to the plugin installation directory
 * @param dataDir - Path to the plugin data directory
 * @returns Promise resolving to a SyncContext with ready-to-use API clients
 * 
 * @example
 * ```typescript
 * const ctx = await createSyncContext(installDir, dataDir);
 * const files = await ctx.drive.files.list({ ... });
 * const doc = await ctx.docs.documents.get({ ... });
 * ```
 */
export async function createSyncContext(
  installDir: string,
  dataDir: string
): Promise<SyncContext> {
  const { google, auth } = await getAuthFromInstallDir(installDir);
  
  const drive = google.drive({ version: 'v3', auth });
  const docs = google.docs({ version: 'v1', auth });
  
  return {
    google,
    auth,
    drive,
    docs,
    installDir,
    dataDir,
  };
}

