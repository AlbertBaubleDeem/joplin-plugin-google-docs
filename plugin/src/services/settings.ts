/**
 * Plugin Settings Registration
 * 
 * Registers plugin settings in Joplin's preferences panel.
 * These settings control authorization, sync behavior, and debug options.
 * Also provides utilities for loading settings from .env file.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// Setting keys (exported for use elsewhere)
export const settingKeys = {
  CLIENT_ID: 'clientId',
  CLIENT_SECRET: 'clientSecret',
  POLL_INTERVAL_MINUTES: 'pollIntervalMinutes',
  AUTO_SYNC_ENABLED: 'autoSyncEnabled',
  SYNC_FOLDER_ID: 'syncFolderId',
  DEBUG_MODE: 'debugMode',
  GCS_BUCKET_NAME: 'gcsBucketName',
  ENABLE_SYNC_ICONS: 'enableSyncIcons',
  // Internal settings (not shown in UI)
  WIZARD_COMPLETED: 'wizardCompleted',
} as const;

// Section name for settings
export const settingsSection = 'googleDocsSync';

/**
 * SettingItemType enum values (matching Joplin API)
 * We define these here to avoid import issues in CommonJS runtime
 */
export const SettingItemType = {
  Int: 1,
  String: 2,
  Bool: 3,
  Button: 6,
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
  const envPath = resolve(installDir, '.env');
  const settings: EnvSettings = {};
  
  if (existsSync(envPath)) {
    const env = readFileSync(envPath, 'utf8');
    
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
 * Get GCS bucket name from Joplin settings (async version)
 * Falls back to .env file if not set in settings
 */
export async function getGCSBucketNameAsync(joplin: any, installDir: string): Promise<string | undefined> {
  // First try Joplin settings
  try {
    const value = await joplin.settings.value(settingKeys.GCS_BUCKET_NAME);
    if (value && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  } catch {
    // Settings not available, fall through to .env
  }
  
  // Fallback to .env file
  const envSettings = loadSettingsFromEnv(installDir);
  return envSettings.gcsBucketName;
}

/**
 * Get GCS bucket name (sync version - only checks .env file)
 * @deprecated Use getGCSBucketNameAsync when possible
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
  await joplin.settings.registerSection(settingsSection, {
    label: 'Google Docs Sync',
    iconName: 'fas fa-cloud-upload-alt',
    description: 'Synchronize Joplin notes with Google Docs.',
  });

  // Register individual settings
  await joplin.settings.registerSettings({
    // Getting Started - informational text at the top
    ['gettingStarted']: {
      value: 'New to Google Docs Sync? ⤵️',
      type: SettingItemType.String,
      section: settingsSection,
      public: true,
      label: '🚀 Getting Started',
      description: 'Run "Google Docs Sync: 09 Setup Wizard" from the Command Palette (Ctrl+Shift+P) for guided setup.',
    },

    // OAuth Client ID
    [settingKeys.CLIENT_ID]: {
      value: '',
      type: SettingItemType.String,
      section: settingsSection,
      public: true,
      label: 'OAuth Client ID',
      description: 'Google Cloud OAuth Client ID (get from your admin or create your own GCP project)',
    },

    // OAuth Client Secret (secure storage)
    [settingKeys.CLIENT_SECRET]: {
      value: '',
      type: SettingItemType.String,
      section: settingsSection,
      public: true,
      secure: true,
      label: 'OAuth Client Secret',
      description: 'Google Cloud OAuth Client Secret (stored securely)',
    },

    // Enable sync status icons in note list
    [settingKeys.ENABLE_SYNC_ICONS]: {
      value: true,
      type: SettingItemType.Bool,
      section: settingsSection,
      public: true,
      label: 'Enable Sync Icons',
      description: 'Shows Google Docs sync icons in note list. Go to View → Note list style and select "Compact with sync status".',
    },

    // Enable/disable automatic sync
    [settingKeys.AUTO_SYNC_ENABLED]: {
      value: false,
      type: SettingItemType.Bool,
      section: settingsSection,
      public: true,
      label: 'Enable Automatic Sync',
      description: 'Automatically sync changes in the background',
    },

    // Polling interval in minutes
    [settingKeys.POLL_INTERVAL_MINUTES]: {
      value: 5,
      type: SettingItemType.Int,
      section: settingsSection,
      public: true,
      label: 'Sync Interval (minutes)',
      description: 'How often to check for changes (0 = manual sync only)',
      minimum: 0,
      maximum: 60,
      step: 1,
    },

    // Google Drive sync folder ID
    [settingKeys.SYNC_FOLDER_ID]: {
      value: '',
      type: SettingItemType.String,
      section: settingsSection,
      public: true,
      label: 'Sync Folder ID',
      description: 'Google Drive folder ID for synced documents',
    },

    // Debug mode
    [settingKeys.DEBUG_MODE]: {
      value: false,
      type: SettingItemType.Bool,
      section: settingsSection,
      public: true,
      advanced: true,
      label: 'Debug Mode',
      description: 'Enable verbose logging for troubleshooting',
    },

    // GCS Bucket Name for image sync
    [settingKeys.GCS_BUCKET_NAME]: {
      value: 'images-to-docs',
      type: SettingItemType.String,
      section: settingsSection,
      public: true,
      label: 'GCS Bucket Name',
      description: 'Google Cloud Storage bucket for image sync. Leave empty to skip image syncing.',
    },

    // Internal settings (not visible in UI)
    [settingKeys.WIZARD_COMPLETED]: {
      value: false,
      type: SettingItemType.Bool,
      section: settingsSection,
      public: false,
      label: 'Wizard Completed (internal)',
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
  clientId: string;
  clientSecret: string;
  pollIntervalMinutes: number;
  autoSyncEnabled: boolean;
  syncFolderId: string;
  debugMode: boolean;
  gcsBucketName: string;
  enableSyncIcons: boolean;
}> {
  const values = await joplin.settings.values([
    settingKeys.CLIENT_ID,
    settingKeys.CLIENT_SECRET,
    settingKeys.POLL_INTERVAL_MINUTES,
    settingKeys.AUTO_SYNC_ENABLED,
    settingKeys.SYNC_FOLDER_ID,
    settingKeys.DEBUG_MODE,
    settingKeys.GCS_BUCKET_NAME,
    settingKeys.ENABLE_SYNC_ICONS,
  ]);

  return {
    clientId: values[settingKeys.CLIENT_ID] as string,
    clientSecret: values[settingKeys.CLIENT_SECRET] as string,
    pollIntervalMinutes: values[settingKeys.POLL_INTERVAL_MINUTES] as number,
    autoSyncEnabled: values[settingKeys.AUTO_SYNC_ENABLED] as boolean,
    syncFolderId: values[settingKeys.SYNC_FOLDER_ID] as string,
    debugMode: values[settingKeys.DEBUG_MODE] as boolean,
    gcsBucketName: values[settingKeys.GCS_BUCKET_NAME] as string,
    enableSyncIcons: values[settingKeys.ENABLE_SYNC_ICONS] as boolean,
  };
}

/**
 * Check if credentials are configured in settings.
 * 
 * @param joplin - The Joplin API object
 * @returns true if credentials are available in settings
 */
export async function hasCredentialsInSettings(joplin: any): Promise<boolean> {
  const settings = await getSettings(joplin);
  return !!(settings.clientId && settings.clientSecret);
}
