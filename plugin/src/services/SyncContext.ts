/**
 * SyncContext - Consolidates authentication and API client creation
 * 
 * This module provides a single point for creating authenticated API clients,
 * eliminating the repeated auth + client creation pattern across commands.
 * 
 * Uses static imports so webpack can bundle the dependencies directly.
 */

import { getAuthClient } from './auth';
import { GoogleDocsProvider } from '../providers/GoogleDocsProvider';
import { docs_v1 } from 'googleapis/build/src/apis/docs';
import { drive_v3 } from 'googleapis/build/src/apis/drive';
import { storage_v1 } from 'googleapis/build/src/apis/storage';

/**
 * Context object containing all authenticated API clients and paths
 * needed for sync operations.
 */
export interface SyncContext {
  /** OAuth2 auth client */
  auth: any;
  /** Pre-created Google Drive client (v3) */
  drive: any;
  /** Pre-created Google Docs client (v1) */
  docs: any;
  /** Google API factory for creating additional clients (e.g., storage) */
  google: {
    storage: (opts: { version: string; auth: any }) => any;
  };
  /** Document provider for OOP access to document operations */
  provider: GoogleDocsProvider;
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
 * @param joplin - Optional Joplin API object for settings access
 * @returns Promise resolving to a SyncContext with ready-to-use API clients
 * 
 * @example
 * ```typescript
 * const ctx = await createSyncContext(installDir, dataDir, joplin);
 * const files = await ctx.drive.files.list({ ... });
 * const doc = await ctx.docs.documents.get({ ... });
 * ```
 */
export async function createSyncContext(
  installDir: string,
  dataDir: string,
  joplin?: any
): Promise<SyncContext> {
  const auth = await getAuthClient(installDir);
  
  // Create API clients using static imports
  const drive = new drive_v3.Drive({ auth });
  const docs = new docs_v1.Docs({ auth });
  
  // Create a google factory object for additional APIs (e.g., storage)
  const google = {
    storage: (opts: { version: string; auth: any }) => {
      return new storage_v1.Storage({ auth: opts.auth });
    },
  };
  
  // Create a partial context for the provider (it needs drive/docs)
  const partialCtx = { auth, drive, docs, google, installDir, dataDir };
  const provider = new GoogleDocsProvider(partialCtx as SyncContext, joplin);
  
  return {
    auth,
    drive,
    docs,
    google,
    provider,
    installDir,
    dataDir,
  };
}
