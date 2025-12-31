/**
 * Settings Service
 * 
 * Provides configuration values for the plugin.
 * Currently reads from .env file in installDir.
 * 
 * Future enhancement: Read from Joplin settings API when available.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface PluginSettings {
  /** GCS bucket name for image hosting */
  gcsBucketName?: string;
  /** Google OAuth Client ID */
  clientId?: string;
  /** Google OAuth Client Secret */
  clientSecret?: string;
  /** OAuth redirect URI */
  redirectUri?: string;
}

/**
 * Load settings from .env file in install directory
 */
export function loadSettingsFromEnv(installDir: string): PluginSettings {
  const envPath = path.resolve(installDir, '.env');
  const settings: PluginSettings = {};
  
  console.log(`[settings] Looking for .env at: ${envPath}`);
  
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf8');
    console.log(`[settings] Found .env with ${env.split('\n').length} lines`);
    
    for (const line of env.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) {
        const [, key, value] = m;
        switch (key) {
          case 'GCS_BUCKET_NAME':
            settings.gcsBucketName = value;
            console.log(`[settings] Loaded GCS_BUCKET_NAME: ${value}`);
            break;
          case 'GOOGLE_CLIENT_ID':
            settings.clientId = value;
            break;
          case 'GOOGLE_CLIENT_SECRET':
            settings.clientSecret = value;
            break;
          case 'GOOGLE_REDIRECT_URI':
            settings.redirectUri = value;
            break;
        }
      }
    }
  } else {
    console.log(`[settings] .env file not found at ${envPath}`);
  }
  
  return settings;
}

/**
 * Check if GCS is configured
 */
export function isGCSConfigured(installDir: string): boolean {
  const settings = loadSettingsFromEnv(installDir);
  return !!(settings.gcsBucketName);
}

/**
 * Get GCS bucket name
 */
export function getGCSBucketName(installDir: string): string | undefined {
  const settings = loadSettingsFromEnv(installDir);
  return settings.gcsBucketName;
}

