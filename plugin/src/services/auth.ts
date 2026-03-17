/**
 * Authentication module using static imports
 * 
 * Uses static imports so webpack can bundle the dependencies directly.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { OAuth2Client } from 'google-auth-library';

/**
 * Load environment variables from .env file.
 * Checks dataDir first (persistent), then installDir (cache/legacy).
 */
const loadEnvFromFile = (installDir: string, dataDir?: string): void => {
  for (const dir of [dataDir, installDir]) {
    if (!dir) continue;
    const envPath = resolve(dir, '.env');
    if (existsSync(envPath)) {
      const env = readFileSync(envPath, 'utf8');
      for (const line of env.split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m) process.env[m[1]] = m[2];
      }
      return;
    }
  }
};

/**
 * Get OAuth2 client credentials from environment
 */
export function getOAuthCredentials(): { clientId: string; clientSecret: string; redirectUri: string } {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback',
  };
}

/**
 * Create an authenticated OAuth2Client from saved tokens.
 * Checks dataDir first (persistent across updates), then installDir (legacy/cache).
 */
export async function getAuthClient(installDir: string, dataDir?: string): Promise<OAuth2Client> {
  loadEnvFromFile(installDir, dataDir);

  const { clientId, clientSecret, redirectUri } = getOAuthCredentials();

  // Try dataDir first (persistent), fall back to installDir (cache/legacy)
  let tokenPath = '';
  if (dataDir) {
    const dp = resolve(dataDir, '.token.json');
    if (existsSync(dp)) tokenPath = dp;
  }
  if (!tokenPath) {
    tokenPath = resolve(installDir, '.token.json');
  }

  const tokens = JSON.parse(readFileSync(tokenPath, 'utf8'));

  const auth = new OAuth2Client(clientId, clientSecret, redirectUri);
  auth.setCredentials(tokens);

  return auth;
}

/**
 * @deprecated Use getAuthClient instead. This exists for backward compatibility.
 */
export async function getAuthFromInstallDir(installDir: string): Promise<{ google: any; auth: OAuth2Client }> {
  const auth = await getAuthClient(installDir);
  // Return a minimal google object for backward compatibility during migration
  // The google object is no longer needed - use the specific API imports directly
  return { google: null, auth };
}
