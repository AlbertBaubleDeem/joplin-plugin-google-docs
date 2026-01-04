import * as fs from 'fs';
import * as path from 'path';

// Declare __non_webpack_require__ for TypeScript
declare const __non_webpack_require__: NodeRequire;

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
  
  // Use __non_webpack_require__ to bypass webpack bundling
  // This tells webpack to leave this require alone and let Node.js handle it at runtime
  const nodeModulesPath = path.resolve(installDir, 'node_modules');
  const googleapisPath = path.join(nodeModulesPath, 'googleapis');
  
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { google } = __non_webpack_require__(googleapisPath);
  
  const auth = new google.auth.OAuth2(
    (process as any).env.GOOGLE_CLIENT_ID,
    (process as any).env.GOOGLE_CLIENT_SECRET,
    (process as any).env.GOOGLE_REDIRECT_URI,
  );
  auth.setCredentials(tokens);
  return { google, auth };
}
