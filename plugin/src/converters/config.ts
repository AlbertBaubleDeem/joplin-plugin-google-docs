/**
 * Converter Configuration
 * 
 * Loads converter configuration with the following priority:
 * 1. User customizations from dataDir/md-mapping.json (survives plugin updates)
 * 2. Default config from installDir/config/md-mapping.json (from plugin archive)
 * 3. Built-in DEFAULT_CONFIG
 */

import * as fs from 'fs';
import * as path from 'path';
import { ConverterConfig, ElementSpacing } from './types';

/** Default configuration */
const DEFAULT_CONFIG: ConverterConfig = {
  title: { useTitle: true, source: 'first_line' },
  subtitle: { mode: 'italic' },
  code: {
    inline: { marker: '`' },
    block: { detect: true, marker: '```' },
    monoFont: 'Roboto Mono',
  },
  mdPrefixes: {
    TITLE: '# ',
    HEADING_1: '# ',
    HEADING_2: '## ',
    HEADING_3: '### ',
    HEADING_4: '#### ',
    HEADING_5: '##### ',
    HEADING_6: '###### ',
  },
};

/**
 * Default element spacing configuration.
 * 
 * - Empty object {} = use Google Docs named style default
 * - { spaceAbove: N } = explicit N points above
 * - { spaceBelow: N } = explicit N points below
 */
const DEFAULT_ELEMENT_SPACING: Record<string, ElementSpacing> = {
  // Named styles - use Google Docs defaults (no explicit spacing)
  title: {},
  subtitle: {},
  heading_1: {},
  heading_2: {},
  heading_3: {},
  heading_4: {},
  heading_5: {},
  heading_6: {},
  paragraph: {},
  // Custom styled elements - explicit spacing
  code_block: { spaceBelow: 12, insertSeparatorBetweenConsecutive: true },
  code_lang_label: { spaceAbove: 0, spaceBelow: 6 },
  callout: { spaceAbove: 8, spaceBelow: 8 },
};

/** Cached config */
const configCache = new Map<string, ConverterConfig>();

/** Current installDir for loading default config */
let currentInstallDir: string | undefined;

/** Current dataDir for loading user customizations */
let currentDataDir: string | undefined;

/**
 * Set the install directory for loading default config.
 * Call this once at plugin initialization.
 */
export function setInstallDir(installDir: string): void {
  currentInstallDir = installDir;
  
  // Try to copy default config if dataDir was already set
  ensureUserConfig();
}

/**
 * Set the data directory for loading user customizations.
 * Call this once at plugin initialization.
 * 
 * If md-mapping.json doesn't exist in dataDir, copies the default from installDir.
 */
export function setDataDir(dataDir: string): void {
  currentDataDir = dataDir;
  
  // Auto-copy default config to dataDir if it doesn't exist
  ensureUserConfig();
}

/**
 * Ensure the user config file exists in dataDir.
 * Copies from installDir/config/md-mapping.json if not present.
 */
function ensureUserConfig(): void {
  if (!currentDataDir || !currentInstallDir) {
    return;
  }
  
  const userCfgPath = path.resolve(currentDataDir, 'md-mapping.json');
  const defaultCfgPath = path.resolve(currentInstallDir, 'config/md-mapping.json');
  
  // Only copy if user config doesn't exist and default exists
  if (!fs.existsSync(userCfgPath) && fs.existsSync(defaultCfgPath)) {
    try {
      const defaultContent = fs.readFileSync(defaultCfgPath, 'utf8');
      fs.writeFileSync(userCfgPath, defaultContent, 'utf8');
      console.log('[gdocs] Created user config at', userCfgPath);
    } catch (err) {
      console.warn('[gdocs] Failed to copy default config to dataDir:', err);
    }
  }
}

/**
 * Load converter configuration.
 * 
 * Priority:
 * 1. User customizations from dataDir/md-mapping.json
 * 2. Default config from installDir/config/md-mapping.json
 * 3. Built-in DEFAULT_CONFIG
 * 
 * @param installDir - Optional override for install directory
 * @returns The merged configuration (defaults + file overrides)
 */
export function loadConfig(installDir?: string): ConverterConfig {
  const dir = installDir || currentInstallDir;
  
  // Use a cache key that includes both directories
  const cacheKey = `${currentDataDir || ''}:${dir || ''}`;
  
  // Check cache
  if (configCache.has(cacheKey)) {
    return configCache.get(cacheKey)!;
  }
  
  // Load from file - check dataDir first (user customizations), then installDir (defaults)
  let fileConfig: Partial<ConverterConfig> = {};
  
  // Try dataDir/md-mapping.json first (user customizations)
  if (currentDataDir) {
    try {
      const userCfgPath = path.resolve(currentDataDir, 'md-mapping.json');
      if (fs.existsSync(userCfgPath)) {
        const raw = fs.readFileSync(userCfgPath, 'utf8');
        fileConfig = JSON.parse(raw);
      }
    } catch (err) {
      // Ignore errors, try installDir next
    }
  }
  
  // Fall back to installDir/config/md-mapping.json if no user config found
  if (Object.keys(fileConfig).length === 0 && dir) {
    try {
      const defaultCfgPath = path.resolve(dir, 'config/md-mapping.json');
      if (fs.existsSync(defaultCfgPath)) {
        const raw = fs.readFileSync(defaultCfgPath, 'utf8');
        fileConfig = JSON.parse(raw);
      }
    } catch (err) {
      // Ignore errors, use defaults
    }
  }
  
  // Merge elementSpacing: for each element type, merge default with file override
  const mergedElementSpacing: Record<string, ElementSpacing> = {};
  for (const key of Object.keys(DEFAULT_ELEMENT_SPACING)) {
    mergedElementSpacing[key] = {
      ...DEFAULT_ELEMENT_SPACING[key],
      ...fileConfig.elementSpacing?.[key],
    };
  }
  // Also include any custom element types from file config
  if (fileConfig.elementSpacing) {
    for (const key of Object.keys(fileConfig.elementSpacing)) {
      if (!mergedElementSpacing[key]) {
        mergedElementSpacing[key] = fileConfig.elementSpacing[key];
      }
    }
  }

  // Merge with defaults (deep merge nested objects)
  const merged: ConverterConfig = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    title: { ...DEFAULT_CONFIG.title, ...fileConfig.title },
    subtitle: { ...DEFAULT_CONFIG.subtitle, ...fileConfig.subtitle },
    code: { ...DEFAULT_CONFIG.code, ...fileConfig.code },
    mdPrefixes: { ...DEFAULT_CONFIG.mdPrefixes, ...fileConfig.mdPrefixes },
    elementSpacing: mergedElementSpacing,
  };
  
  // Cache and return
  configCache.set(cacheKey, merged);
  return merged;
}

/**
 * Clear the config cache.
 * Useful for testing or when config file changes.
 */
export function clearConfigCache(): void {
  configCache.clear();
}

/**
 * Get the monospace font from config.
 */
export function getMonoFont(installDir?: string): string {
  const config = loadConfig(installDir);
  return config.code?.monoFont || 'Roboto Mono';
}

/**
 * Get spacing configuration for an element type.
 * 
 * @param elementType - The element type (e.g., 'code_block', 'callout', 'heading_1')
 * @param installDir - Optional install directory for config
 * @returns The spacing configuration for the element
 */
export function getElementSpacing(elementType: string, installDir?: string): ElementSpacing {
  const config = loadConfig(installDir);
  return config.elementSpacing?.[elementType] || DEFAULT_ELEMENT_SPACING[elementType] || {};
}

