import * as fs from 'fs';
import * as path from 'path';

export async function getAuthFromInstallDir(installDir: string): Promise<{ google: any; auth: any }>{
  // Load env from installDir/.env if present
  const envPath = path.resolve(installDir, '.env');
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) (process as any).env[m[1]] = m[2];
    }
  }
  // OAuth tokens
  const tokenPath = path.resolve(installDir, '.token.json');
  const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
  const googleapisPath = path.resolve(installDir, 'node_modules/googleapis');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { google } = require(googleapisPath);
  const auth = new google.auth.OAuth2(
    (process as any).env.GOOGLE_CLIENT_ID,
    (process as any).env.GOOGLE_CLIENT_SECRET,
    (process as any).env.GOOGLE_REDIRECT_URI,
  );
  auth.setCredentials(tokens);
  return { google, auth };
}


