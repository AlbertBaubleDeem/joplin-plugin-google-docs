/**
 * OAuth Authorization Server
 * 
 * Handles the OAuth 2.0 authorization flow by:
 * 1. Starting a local HTTP server to receive callbacks
 * 2. Generating the Google authorization URL
 * 3. Exchanging authorization codes for tokens
 * 4. Saving tokens to the plugin directory
 * 
 * Uses static imports so webpack can bundle the dependencies directly.
 */

import { createServer, Server } from 'http';
import { writeFileSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'url';
import { OAuth2Client } from 'google-auth-library';

// OAuth scopes required by the plugin
// - drive.file: Only files created by this app or explicitly opened by user
// - documents: Read/write access to Google Docs
// - devstorage.full_control: Upload images to GCS and set public ACLs for embedding in docs
const oauthScopes = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/devstorage.full_control',
];

// Default callback port
const defaultPort = 3000;
const redirectPath = '/oauth2callback';

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  port?: number;
}

export interface OAuthResult {
  success: boolean;
  error?: string;
  tokens?: any;
}

/**
 * Generate the Google OAuth authorization URL
 */
export function generateAuthUrl(config: OAuthConfig): string {
  const port = config.port || defaultPort;
  const redirectUri = `http://localhost:${port}${redirectPath}`;
  
  const oauth2Client = new OAuth2Client(config.clientId, config.clientSecret, redirectUri);
  
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: oauthScopes,
    prompt: 'consent',
  });
}

/**
 * Start the OAuth callback server and wait for authorization
 * 
 * @param config - OAuth configuration
 * @param installDir - Plugin installation directory for saving tokens
 * @param timeoutMs - Timeout in milliseconds (default: 5 minutes)
 * @returns Promise resolving to OAuth result
 */
export function startOAuthServer(
  config: OAuthConfig,
  installDir: string,
  timeoutMs: number = 5 * 60 * 1000
): Promise<OAuthResult> {
  return new Promise((done) => {
    const port = config.port || defaultPort;
    const redirectUri = `http://localhost:${port}${redirectPath}`;
    
    // Create OAuth2 client for token exchange
    const oauth2Client = new OAuth2Client(config.clientId, config.clientSecret, redirectUri);
    
    let server: Server | null = null;
    let timeoutId: NodeJS.Timeout | null = null;
    
    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (server) {
        server.close();
        server = null;
      }
    };
    
    // Set timeout
    timeoutId = setTimeout(() => {
      cleanup();
      done({ success: false, error: 'Authorization timed out. Please try again.' });
    }, timeoutMs);
    
    server = createServer(async (req, res) => {
      const parsedUrl = parse(req.url || '', true);
      
      if (parsedUrl.pathname !== redirectPath) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      
      const code = parsedUrl.query.code as string;
      const error = parsedUrl.query.error as string;
      
      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body style="font-family: sans-serif; padding: 40px; text-align: center;">
              <h1 style="color: #d32f2f;">Authorization Failed</h1>
              <p>Error: ${error}</p>
              <p>You can close this window and try again.</p>
            </body>
          </html>
        `);
        cleanup();
        done({ success: false, error: `Authorization denied: ${error}` });
        return;
      }
      
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body style="font-family: sans-serif; padding: 40px; text-align: center;">
              <h1 style="color: #d32f2f;">Missing Authorization Code</h1>
              <p>No authorization code received. Please try again.</p>
            </body>
          </html>
        `);
        cleanup();
        done({ success: false, error: 'No authorization code received' });
        return;
      }
      
      // Exchange code for tokens using OAuth2Client
      try {
        const { tokens } = await oauth2Client.getToken(code);
        
        // Save tokens
        const tokenPath = resolve(installDir, '.token.json');
        writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
        
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body style="font-family: sans-serif; padding: 40px; text-align: center;">
              <h1 style="color: #4caf50;">Authorization Successful!</h1>
              <p>You can close this window and return to Joplin.</p>
              <p style="color: #666; font-size: 14px;">Tokens have been saved. The plugin is now ready to use.</p>
            </body>
          </html>
        `);
        cleanup();
        done({ success: true, tokens });
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body style="font-family: sans-serif; padding: 40px; text-align: center;">
              <h1 style="color: #d32f2f;">Token Exchange Failed</h1>
              <p>Error: ${err.message || err}</p>
              <p>You can close this window and try again.</p>
            </body>
          </html>
        `);
        cleanup();
        done({ success: false, error: `Token exchange failed: ${err.message || err}` });
      }
    });
    
    server.on('error', (err: any) => {
      cleanup();
      if (err.code === 'EADDRINUSE') {
        done({ success: false, error: `Port ${port} is already in use. Close other applications using this port and try again.` });
      } else {
        done({ success: false, error: `Server error: ${err.message}` });
      }
    });
    
    server.listen(port);
  });
}

/**
 * Check if tokens exist and are valid
 */
export function hasValidTokens(installDir: string): boolean {
  const tokenPath = resolve(installDir, '.token.json');
  
  if (!existsSync(tokenPath)) {
    return false;
  }
  
  try {
    const tokens = JSON.parse(readFileSync(tokenPath, 'utf8'));
    // Check if we have at least an access token or refresh token
    return !!(tokens.access_token || tokens.refresh_token);
  } catch {
    return false;
  }
}

/**
 * Delete stored tokens (for re-authorization)
 */
export function clearTokens(installDir: string): void {
  const tokenPath = resolve(installDir, '.token.json');
  
  if (existsSync(tokenPath)) {
    unlinkSync(tokenPath);
  }
}
