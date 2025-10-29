import * as path from 'path';
import { getAuthFromInstallDir } from '../services/auth';

type Params = {
  j: any;
  installDir: string;
  dataDir: string;
};

export async function autoPairRun(params: Params): Promise<{ folderId: string; scanned: number; created: number; linkedExisting: number; ensuredMapping: number }> {
  const { j, installDir, dataDir } = params;
  const { google, auth } = await getAuthFromInstallDir(installDir);

  const folderId = process.env.GOOGLE_SYNC_FOLDER_ID || '';
  const mod = require(path.resolve(installDir, 'dist/commands/autoPair.js'));
  return await mod.autoPair({ j, google, auth, installDir, dataDir, folderId });
}


