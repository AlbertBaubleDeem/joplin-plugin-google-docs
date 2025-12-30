/**
 * Authorization Command
 * 
 * Handles Google OAuth authorization flow within Joplin.
 * Opens browser for consent, receives callback, and saves tokens.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getSettings } from '../services/settings';
import {
  generateAuthUrl,
  startOAuthServer,
  hasValidTokens,
  clearTokens,
  OAuthConfig,
} from '../services/oauthServer';

/**
 * Load credentials from .env file in install directory.
 * This is the existing credential source used before the settings GUI.
 */
function loadEnvCredentials(installDir: string): { clientId: string; clientSecret: string } {
  const envPath = path.resolve(installDir, '.env');
  let clientId = '';
  let clientSecret = '';
  
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) {
        if (m[1] === 'GOOGLE_CLIENT_ID') clientId = m[2];
        if (m[1] === 'GOOGLE_CLIENT_SECRET') clientSecret = m[2];
      }
    }
  }
  
  return { clientId, clientSecret };
}

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
  
  // Get settings
  const settings = await getSettings(j);
  
  // Credential priority: Joplin Settings > .env file
  const envCreds = loadEnvCredentials(installDir);
  
  const clientId = settings.clientId || envCreds.clientId;
  const clientSecret = settings.clientSecret || envCreds.clientSecret;
  
  if (!clientId || !clientSecret) {
    return {
      success: false,
      message: 'Google API credentials not found.\n\nPlease either:\n1. Enter credentials in Settings → Google Docs Sync, or\n2. Run the Setup Wizard to configure the plugin.\n\nGet credentials from your admin or create your own at console.cloud.google.com',
    };
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

