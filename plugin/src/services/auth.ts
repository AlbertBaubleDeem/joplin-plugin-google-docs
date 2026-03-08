/**
 * Authentication module using static imports
 * 
 * Uses static imports so webpack can bundle the dependencies directly.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { OAuth2Client } from 'google-auth-library';

/**
 * Load environment variables from .env file
 */
const loadEnvFromFile = (installDir: string): void => {
  const envPath = resolve(installDir, '.env');
  if (existsSync(envPath)) {
    const env = readFileSync(envPath, 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) (process as any).env[m[1]] = m[2];
    }
  }
};

/**
 * Get OAuth2 client credentials from environment
 */
export function getOAuthCredentials(): { clientId: string; clientSecret: string; redirectUri: string } {
  return {
    clientId: (process as any).env.GOOGLE_CLIENT_ID || '',
    clientSecret: (process as any).env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: (process as any).env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback',
  };
}

/**
 * Create an authenticated OAuth2Client from saved tokens
 * 
 * @param installDir - Path to the plugin installation directory
 * @returns Authenticated OAuth2Client ready for API calls
 */
export async function getAuthClient(installDir: string): Promise<OAuth2Client> {
  // Load env from installDir/.env if present
  loadEnvFromFile(installDir);
  
  const { clientId, clientSecret, redirectUri } = getOAuthCredentials();
  
  // Load OAuth tokens
  const tokenPath = resolve(installDir, '.token.json');
  const tokens = JSON.parse(readFileSync(tokenPath, 'utf8'));
  
  // Create OAuth2 client with credentials
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
