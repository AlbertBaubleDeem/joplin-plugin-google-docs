/**
 * autoPairRun - Auto-pair notes with Google Docs using SyncContext
 */

import * as path from 'path';
import { createSyncContext } from '../services/SyncContext';

type Params = {
  j: any;
  installDir: string;
  dataDir: string;
};

export async function autoPairRun(params: Params): Promise<{ folderId: string; scanned: number; created: number; linkedExisting: number; ensuredMapping: number }> {
  const { j, installDir, dataDir } = params;
  
  // Use SyncContext for authenticated API access
  const ctx = await createSyncContext(installDir, dataDir);

  const folderId = process.env.GOOGLE_SYNC_FOLDER_ID || '';
  const mod = require(path.resolve(installDir, 'dist/commands/autoPair.js'));
  return await mod.autoPair({ j, google: ctx.google, auth: ctx.auth, installDir, dataDir, folderId });
}
