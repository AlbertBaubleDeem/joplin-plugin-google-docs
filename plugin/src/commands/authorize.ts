/**
 * Authorization Command
 * 
 * Handles Google OAuth authorization flow within Joplin.
 * Opens browser for consent, receives callback, and saves tokens.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { exec } from 'child_process';
import { getSettings } from '../services/settings';
import {
  generateAuthUrl,
  startOAuthServer,
  hasValidTokens,
  clearTokens,
  OAuthConfig,
} from '../services/oauthServer';
import {
  showAuthInstructionsDialog,
  showSuccessDialog,
  showErrorDialog,
  showInfoDialog,
} from '../services/styledDialogs';

/**
 * Load credentials from .env file in install directory.
 * This is the existing credential source used before the settings GUI.
 */
const loadEnvCredentials = (installDir: string): { clientId: string; clientSecret: string } => {
  const envPath = resolve(installDir, '.env');
  let clientId = '';
  let clientSecret = '';
  
  if (existsSync(envPath)) {
    const env = readFileSync(envPath, 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) {
        if (m[1] === 'GOOGLE_CLIENT_ID') clientId = m[2];
        if (m[1] === 'GOOGLE_CLIENT_SECRET') clientSecret = m[2];
      }
    }
  }
  
  return { clientId, clientSecret };
};

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
  const { j, installDir, dataDir, force } = params;
  
  // Get settings and resolve credentials early so we can persist them
  const settings = await getSettings(j);
  const envCreds = loadEnvCredentials(installDir);
  const clientId = settings.clientId || envCreds.clientId;
  const clientSecret = settings.clientSecret || envCreds.clientSecret;

  // Always persist credentials to dataDir if available (survives reinstalls)
  if (clientId && clientSecret) {
    const config: OAuthConfig = { clientId, clientSecret, port: 3000 };
    await saveCredentialsToEnv(installDir, config, dataDir);
  }

  // Check if already authorized
  if (!force && hasValidTokens(installDir, dataDir)) {
    return {
      success: true,
      message: 'Already authorized. Use "Re-authorize" to get new tokens.',
      alreadyAuthorized: true,
    };
  }

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
    clearTokens(installDir, dataDir);
  }
  
  // Generate auth URL and show dialog
  const authUrl = generateAuthUrl(config);
  
  // Show instructions dialog
  const shouldContinue = await showAuthInstructionsDialog(j);
  if (!shouldContinue) {
    return {
      success: false,
      message: 'Authorization cancelled.',
    };
  }
  
  // Open browser using child_process (cross-platform)
  try {
    
    const platform = process.platform;
    
    let cmd: string;
    if (platform === 'win32') {
      cmd = `start "" "${authUrl}"`;
    } else if (platform === 'darwin') {
      cmd = `open "${authUrl}"`;
    } else {
      cmd = `xdg-open "${authUrl}"`;
    }
    
    exec(cmd, (err: Error | null) => {
      if (err) {
        console.error('[gdocs] Failed to open browser:', err);
      }
    });
  } catch (e) {
    // Fallback: show URL for manual copy
    console.error('[gdocs] Browser open error:', e);
    await showInfoDialog(j, {
      title: 'Open Browser Manually',
      message: 'Could not open browser automatically.',
      details: `Please copy this URL and paste it in your browser:\n\n${authUrl}`,
      icon: '🌐',
    });
  }
  
  // Start OAuth server and wait for callback — save tokens to dataDir (persistent)
  const result = await startOAuthServer(config, installDir, 5 * 60 * 1000, dataDir);
  
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
export async function checkAuthStatus(params: { installDir: string; dataDir?: string }): Promise<{
  authorized: boolean;
  message: string;
}> {
  const { installDir, dataDir } = params;
  
  if (hasValidTokens(installDir, dataDir)) {
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
async function saveCredentialsToEnv(installDir: string, config: OAuthConfig, dataDir?: string): Promise<void> {
  const envContent = [
    `GOOGLE_CLIENT_ID=${config.clientId}`,
    `GOOGLE_CLIENT_SECRET=${config.clientSecret}`,
    `GOOGLE_REDIRECT_URI=http://localhost:${config.port || 3000}/oauth2callback`,
  ].join('\n');

  // Save to both dataDir (persistent) and installDir (for current session)
  writeFileSync(resolve(installDir, '.env'), envContent);
  if (dataDir) {
    writeFileSync(resolve(dataDir, '.env'), envContent);
  }
}

