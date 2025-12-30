/**
 * Authorization Command
 * 
 * Handles Google OAuth authorization flow within Joplin.
 * Opens browser for consent, receives callback, and saves tokens.
 */

import { getSettings } from '../services/settings';
import {
  generateAuthUrl,
  startOAuthServer,
  hasValidTokens,
  clearTokens,
  OAuthConfig,
} from '../services/oauthServer';

// Bundled credentials for shared mode (company project)
// These are intentionally included for company users
const BUNDLED_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const BUNDLED_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

export interface AuthorizeParams {
  j: any;
  installDir: string;
  dataDir: string;
  force?: boolean; // Force re-authorization even if tokens exist
}

export interface AuthorizeResult {
  success: boolean;
  message: string;
  alreadyAuthorized?: boolean;
}

/**
 * Main authorization command.
 * 
 * 1. Checks if already authorized (unless force=true)
 * 2. Gets credentials based on auth mode (shared/personal)
 * 3. Opens browser to Google consent screen
 * 4. Waits for callback and exchanges code for tokens
 */
export async function authorize(params: AuthorizeParams): Promise<AuthorizeResult> {
  const { j, installDir, force } = params;
  
  // Check if already authorized
  if (!force && hasValidTokens(installDir)) {
    return {
      success: true,
      message: 'Already authorized. Use "Re-authorize" to get new tokens.',
      alreadyAuthorized: true,
    };
  }
  
  // Get settings to determine auth mode
  const settings = await getSettings(j);
  
  // Determine credentials based on auth mode
  let clientId: string;
  let clientSecret: string;
  
  if (settings.authMode === 'shared') {
    // Use bundled credentials
    clientId = BUNDLED_CLIENT_ID;
    clientSecret = BUNDLED_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      return {
        success: false,
        message: 'Shared credentials not available. Please switch to Personal mode and enter your own Google Cloud credentials in Settings.',
      };
    }
  } else {
    // Use personal credentials from settings
    clientId = settings.clientId;
    clientSecret = settings.clientSecret;
    
    if (!clientId || !clientSecret) {
      return {
        success: false,
        message: 'Please enter your Google Cloud OAuth credentials in Settings → Google Docs Sync before authorizing.',
      };
    }
  }
  
  const config: OAuthConfig = {
    clientId,
    clientSecret,
    port: 3000,
  };
  
  // Clear existing tokens if forcing re-auth
  if (force) {
    clearTokens(installDir);
  }
  
  // Save credentials to .env for the auth service to use
  await saveCredentialsToEnv(installDir, config);
  
  // Generate auth URL and show dialog
  const authUrl = generateAuthUrl(config);
  
  // Show instructions dialog
  await j.views.dialogs.showMessageBox(
    `Authorization will open in your browser.\n\n` +
    `1. Sign in with your Google account\n` +
    `2. Grant the requested permissions\n` +
    `3. You'll be redirected back automatically\n\n` +
    `Click OK to open the authorization page.`
  );
  
  // Open browser (cross-platform)
  try {
    const { shell } = require('electron');
    shell.openExternal(authUrl);
  } catch {
    // Fallback: show URL for manual copy
    await j.views.dialogs.showMessageBox(
      `Could not open browser automatically.\n\nPlease copy this URL and paste it in your browser:\n\n${authUrl}`
    );
  }
  
  // Start OAuth server and wait for callback
  const result = await startOAuthServer(config, installDir);
  
  if (result.success) {
    return {
      success: true,
      message: 'Authorization successful! The plugin is now connected to Google Docs.',
    };
  } else {
    return {
      success: false,
      message: result.error || 'Authorization failed. Please try again.',
    };
  }
}

/**
 * Check current authorization status
 */
export async function checkAuthStatus(params: { installDir: string }): Promise<{
  authorized: boolean;
  message: string;
}> {
  const { installDir } = params;
  
  if (hasValidTokens(installDir)) {
    return {
      authorized: true,
      message: 'Authorized and ready to sync.',
    };
  }
  
  return {
    authorized: false,
    message: 'Not authorized. Run "Authorize with Google" to connect.',
  };
}

/**
 * Re-authorize (clear tokens and start fresh)
 */
export async function reauthorize(params: AuthorizeParams): Promise<AuthorizeResult> {
  return authorize({ ...params, force: true });
}

/**
 * Save credentials to .env file for the auth service
 */
async function saveCredentialsToEnv(installDir: string, config: OAuthConfig): Promise<void> {
  const fs = require('fs');
  const path = require('path');
  
  const envPath = path.resolve(installDir, '.env');
  const envContent = [
    `GOOGLE_CLIENT_ID=${config.clientId}`,
    `GOOGLE_CLIENT_SECRET=${config.clientSecret}`,
    `GOOGLE_REDIRECT_URI=http://localhost:${config.port || 3000}/oauth2callback`,
  ].join('\n');
  
  fs.writeFileSync(envPath, envContent);
}

