/**
 * Plugin Settings Registration
 * 
 * Registers plugin settings in Joplin's preferences panel.
 * These settings control authorization, sync behavior, and debug options.
 * Also provides utilities for loading settings from .env file.
 */

import * as fs from 'fs';
import * as path from 'path';

// Setting keys (exported for use elsewhere)
export const SETTING_KEYS = {
  AUTH_MODE: 'authMode',
  CLIENT_ID: 'clientId',
  CLIENT_SECRET: 'clientSecret',
  POLL_INTERVAL_MINUTES: 'pollIntervalMinutes',
  AUTO_SYNC_ENABLED: 'autoSyncEnabled',
  SYNC_FOLDER_ID: 'syncFolderId',
  DEBUG_MODE: 'debugMode',
} as const;

// Section name for settings
export const SETTINGS_SECTION = 'googleDocsSync';

/**
 * SettingItemType enum values (matching Joplin API)
 * We define these here to avoid import issues in CommonJS runtime
 */
export const SettingItemType = {
  Int: 1,
  String: 2,
  Bool: 3,
} as const;

/**
 * Settings loaded from .env file (for GCS and other env-based config)
 */
export interface EnvSettings {
  /** GCS bucket name for image hosting */
  gcsBucketName?: string;
  /** Google OAuth Client ID (fallback if not in Joplin settings) */
  clientId?: string;
  /** Google OAuth Client Secret (fallback if not in Joplin settings) */
  clientSecret?: string;
  /** OAuth redirect URI */
  redirectUri?: string;
}

/**
 * Load settings from .env file in install directory
 */
export function loadSettingsFromEnv(installDir: string): EnvSettings {
  const envPath = path.resolve(installDir, '.env');
  const settings: EnvSettings = {};
  
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf8');
    
    for (const line of env.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) {
        const [, key, value] = m;
        switch (key) {
          case 'GCS_BUCKET_NAME':
            settings.gcsBucketName = value;
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

/**
 * Register the plugin's settings section and settings.
 * Must be called during plugin onStart.
 * 
 * @param joplin - The Joplin API object
 */
export async function registerSettings(joplin: any): Promise<void> {
  // Register the settings section (appears in Joplin preferences sidebar)
  await joplin.settings.registerSection(SETTINGS_SECTION, {
    label: 'Google Docs Sync',
    iconName: 'fas fa-cloud-upload-alt',
    description: 'Configure Google Docs synchronization settings',
  });

  // Register individual settings
  await joplin.settings.registerSettings({
    // Authorization mode: shared (company project) or personal (own credentials)
    [SETTING_KEYS.AUTH_MODE]: {
      value: 'shared',
      type: SettingItemType.String,
      section: SETTINGS_SECTION,
      isEnum: true,
      public: true,
      label: 'Authorization Mode',
      description: 'Use shared company credentials or your own Google Cloud project',
      options: {
        'shared': 'Shared (Company Project)',
        'personal': 'Personal (Own Credentials)',
      },
    },

    // OAuth Client ID (for personal mode)
    [SETTING_KEYS.CLIENT_ID]: {
      value: '',
      type: SettingItemType.String,
      section: SETTINGS_SECTION,
      public: true,
      label: 'OAuth Client ID',
      description: 'Your Google Cloud OAuth Client ID (personal mode only)',
    },

    // OAuth Client Secret (secure storage)
    [SETTING_KEYS.CLIENT_SECRET]: {
      value: '',
      type: SettingItemType.String,
      section: SETTINGS_SECTION,
      public: true,
      secure: true,
      label: 'OAuth Client Secret',
      description: 'Your Google Cloud OAuth Client Secret (personal mode only)',
    },

    // Polling interval in minutes
    [SETTING_KEYS.POLL_INTERVAL_MINUTES]: {
      value: 5,
      type: SettingItemType.Int,
      section: SETTINGS_SECTION,
      public: true,
      label: 'Sync Interval (minutes)',
      description: 'How often to check for changes (0 = manual sync only)',
      minimum: 0,
      maximum: 60,
      step: 1,
    },

    // Enable/disable automatic sync
    [SETTING_KEYS.AUTO_SYNC_ENABLED]: {
      value: false,
      type: SettingItemType.Bool,
      section: SETTINGS_SECTION,
      public: true,
      label: 'Enable Automatic Sync',
      description: 'Automatically sync changes in the background',
    },

    // Google Drive sync folder ID
    [SETTING_KEYS.SYNC_FOLDER_ID]: {
      value: '',
      type: SettingItemType.String,
      section: SETTINGS_SECTION,
      public: true,
      label: 'Sync Folder ID',
      description: 'Google Drive folder ID for synced documents (leave empty to auto-create)',
    },

    // Debug mode
    [SETTING_KEYS.DEBUG_MODE]: {
      value: false,
      type: SettingItemType.Bool,
      section: SETTINGS_SECTION,
      public: true,
      advanced: true,
      label: 'Debug Mode',
      description: 'Enable verbose logging for troubleshooting',
    },
  });
}

/**
 * Get all plugin settings values.
 * 
 * @param joplin - The Joplin API object
 * @returns Object with all setting values
 */
export async function getSettings(joplin: any): Promise<{
  authMode: 'shared' | 'personal';
  clientId: string;
  clientSecret: string;
  pollIntervalMinutes: number;
  autoSyncEnabled: boolean;
  syncFolderId: string;
  debugMode: boolean;
}> {
  const values = await joplin.settings.values([
    SETTING_KEYS.AUTH_MODE,
    SETTING_KEYS.CLIENT_ID,
    SETTING_KEYS.CLIENT_SECRET,
    SETTING_KEYS.POLL_INTERVAL_MINUTES,
    SETTING_KEYS.AUTO_SYNC_ENABLED,
    SETTING_KEYS.SYNC_FOLDER_ID,
    SETTING_KEYS.DEBUG_MODE,
  ]);

  return {
    authMode: values[SETTING_KEYS.AUTH_MODE] as 'shared' | 'personal',
    clientId: values[SETTING_KEYS.CLIENT_ID] as string,
    clientSecret: values[SETTING_KEYS.CLIENT_SECRET] as string,
    pollIntervalMinutes: values[SETTING_KEYS.POLL_INTERVAL_MINUTES] as number,
    autoSyncEnabled: values[SETTING_KEYS.AUTO_SYNC_ENABLED] as boolean,
    syncFolderId: values[SETTING_KEYS.SYNC_FOLDER_ID] as string,
    debugMode: values[SETTING_KEYS.DEBUG_MODE] as boolean,
  };
}

/**
 * Check if authorization is configured.
 * 
 * @param joplin - The Joplin API object
 * @returns true if auth credentials are available
 */
export async function isAuthConfigured(joplin: any): Promise<boolean> {
  const settings = await getSettings(joplin);
  
  if (settings.authMode === 'shared') {
    // For shared mode, check if bundled credentials exist
    // This will be checked via the auth service
    return true;
  }
  
  // For personal mode, check if credentials are provided
  return !!(settings.clientId && settings.clientSecret);
}
