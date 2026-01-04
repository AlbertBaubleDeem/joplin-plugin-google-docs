/**
 * OAuth Authorization Server
 * 
 * Handles the OAuth 2.0 authorization flow by:
 * 1. Starting a local HTTP server to receive callbacks
 * 2. Generating the Google authorization URL
 * 3. Exchanging authorization codes for tokens
 * 4. Saving tokens to the plugin directory
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';

// OAuth scopes required by the plugin
// - drive.file: Only files created by this app or explicitly opened by user
// - documents: Read/write access to Google Docs
// - devstorage.full_control: Upload images to GCS and set public ACLs for embedding in docs
const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/devstorage.full_control',
];

// Default callback port
const DEFAULT_PORT = 3000;
const REDIRECT_PATH = '/oauth2callback';

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
  const port = config.port || DEFAULT_PORT;
  const redirectUri = `http://localhost:${port}${REDIRECT_PATH}`;
  
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: OAUTH_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
  });
  
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
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
  return new Promise((resolve) => {
    const port = config.port || DEFAULT_PORT;
    const redirectUri = `http://localhost:${port}${REDIRECT_PATH}`;
    
    let server: http.Server | null = null;
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
      resolve({ success: false, error: 'Authorization timed out. Please try again.' });
    }, timeoutMs);
    
    server = http.createServer(async (req, res) => {
      const parsedUrl = url.parse(req.url || '', true);
      
      if (parsedUrl.pathname !== REDIRECT_PATH) {
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
        resolve({ success: false, error: `Authorization denied: ${error}` });
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
        resolve({ success: false, error: 'No authorization code received' });
        return;
      }
      
      // Exchange code for tokens
      try {
        const tokens = await exchangeCodeForTokens(config, code, redirectUri, installDir);
        
        // Save tokens
        const tokenPath = path.resolve(installDir, '.token.json');
        fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
        
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
        resolve({ success: true, tokens });
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
        resolve({ success: false, error: `Token exchange failed: ${err.message || err}` });
      }
    });
    
    server.on('error', (err: any) => {
      cleanup();
      if (err.code === 'EADDRINUSE') {
        resolve({ success: false, error: `Port ${port} is already in use. Close other applications using this port and try again.` });
      } else {
        resolve({ success: false, error: `Server error: ${err.message}` });
      }
    });
    
    server.listen(port, () => {
      console.log(`[gdocs-oauth] Listening on http://localhost:${port}${REDIRECT_PATH}`);
    });
  });
}

/**
 * Exchange authorization code for tokens using direct HTTP POST
 */
async function exchangeCodeForTokens(
  config: OAuthConfig,
  code: string,
  redirectUri: string,
  _installDir: string
): Promise<any> {
  const https = require('https');
  
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString();
    
    const options = {
      hostname: 'oauth2.googleapis.com',
      port: 443,
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };
    
    const req = https.request(options, (res: any) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        try {
          const tokens = JSON.parse(data);
          if (tokens.error) {
            reject(new Error(tokens.error_description || tokens.error));
          } else {
            resolve(tokens);
          }
        } catch (e) {
          reject(new Error(`Failed to parse token response: ${data}`));
        }
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Check if tokens exist and are valid
 */
export function hasValidTokens(installDir: string): boolean {
  const tokenPath = path.resolve(installDir, '.token.json');
  
  if (!fs.existsSync(tokenPath)) {
    return false;
  }
  
  try {
    const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
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
  const tokenPath = path.resolve(installDir, '.token.json');
  
  if (fs.existsSync(tokenPath)) {
    fs.unlinkSync(tokenPath);
  }
}

