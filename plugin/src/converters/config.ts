/**
 * Converter Configuration
 * 
 * Loads converter configuration with the following priority:
 * 1. User customizations from dataDir/md-mapping.json (survives plugin updates)
 * 2. Default config from installDir/config/md-mapping.json (from plugin archive)
 * 3. Built-in defaultConfig
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { ConverterConfig, ElementSpacing } from './types';

/** Default configuration */
const defaultConfig: ConverterConfig = {
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
  list: {
    unorderedMarker: '-',
  },
};

/**
 * Default element spacing configuration.
 * 
 * - Empty object {} = use Google Docs named style default
 * - { spaceAbove: N } = explicit N points above
 * - { spaceBelow: N } = explicit N points below
 */
const defaultElementSpacing: Record<string, ElementSpacing> = {
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
const ensureUserConfig = (): void => {
  if (!currentDataDir || !currentInstallDir) {
    return;
  }
  
  const userCfgPath = resolve(currentDataDir, 'md-mapping.json');
  const defaultCfgPath = resolve(currentInstallDir, 'config/md-mapping.json');
  
  // Only copy if user config doesn't exist and default exists
  if (!existsSync(userCfgPath) && existsSync(defaultCfgPath)) {
    try {
      const defaultContent = readFileSync(defaultCfgPath, 'utf8');
      writeFileSync(userCfgPath, defaultContent, 'utf8');
    } catch (err) {
      console.warn('[gdocs] Failed to copy default config to dataDir:', err);
    }
  }
};

/**
 * Load converter configuration.
 * 
 * Priority:
 * 1. User customizations from dataDir/md-mapping.json
 * 2. Default config from installDir/config/md-mapping.json
 * 3. Built-in defaultConfig
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
      const userCfgPath = resolve(currentDataDir, 'md-mapping.json');
      if (existsSync(userCfgPath)) {
        const raw = readFileSync(userCfgPath, 'utf8');
        fileConfig = JSON.parse(raw);
      }
    } catch (err) {
      // Ignore errors, try installDir next
    }
  }
  
  // Fall back to installDir/config/md-mapping.json if no user config found
  if (Object.keys(fileConfig).length === 0 && dir) {
    try {
      const defaultCfgPath = resolve(dir, 'config/md-mapping.json');
      if (existsSync(defaultCfgPath)) {
        const raw = readFileSync(defaultCfgPath, 'utf8');
        fileConfig = JSON.parse(raw);
      }
    } catch (err) {
      // Ignore errors, use defaults
    }
  }
  
  // Merge elementSpacing: for each element type, merge default with file override
  const mergedElementSpacing: Record<string, ElementSpacing> = {};
  for (const key of Object.keys(defaultElementSpacing)) {
    mergedElementSpacing[key] = {
      ...defaultElementSpacing[key],
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
    ...defaultConfig,
    ...fileConfig,
    title: { ...defaultConfig.title, ...fileConfig.title },
    subtitle: { ...defaultConfig.subtitle, ...fileConfig.subtitle },
    code: { ...defaultConfig.code, ...fileConfig.code },
    mdPrefixes: { ...defaultConfig.mdPrefixes, ...fileConfig.mdPrefixes },
    elementSpacing: mergedElementSpacing,
    list: { ...defaultConfig.list, ...fileConfig.list },
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

/** RGB in 0–1 range for Google Docs API */
export type CodeForegroundRgb = { red: number; green: number; blue: number };

/**
 * Parse a hex color to RGB 0–1. Supports #RGB and #RRGGBB.
 * Returns null if invalid or empty.
 */
export function parseHexToRgb(hex: string | undefined | null): CodeForegroundRgb | null {
  if (!hex || typeof hex !== 'string') return null;
  const s = hex.trim().replace(/^#/, '');
  if (s.length === 3) {
    const r = parseInt(s[0] + s[0], 16);
    const g = parseInt(s[1] + s[1], 16);
    const b = parseInt(s[2] + s[2], 16);
    if (!Number.isNaN(r + g + b)) {
      return { red: r / 255, green: g / 255, blue: b / 255 };
    }
  }
  if (s.length === 6) {
    const r = parseInt(s.slice(0, 2), 16);
    const g = parseInt(s.slice(2, 4), 16);
    const b = parseInt(s.slice(4, 6), 16);
    if (!Number.isNaN(r + g + b)) {
      return { red: r / 255, green: g / 255, blue: b / 255 };
    }
  }
  return null;
}

/**
 * Get code foreground color from config (from md-mapping.json).
 * Returns RGB in 0–1 or null if not set.
 */
export function getCodeForegroundColor(installDir?: string): CodeForegroundRgb | null {
  const config = loadConfig(installDir);
  return parseHexToRgb(config.code?.foregroundColor);
}

/**
 * Get code font size from config (from md-mapping.json).
 * Returns size in points or null if not set or invalid (use Docs default).
 */
export function getCodeFontSize(installDir?: string): number | null {
  const config = loadConfig(installDir);
  const n = config.code?.fontSize;
  if (typeof n !== 'number' || n <= 0) return null;
  return n;
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
  return config.elementSpacing?.[elementType] || defaultElementSpacing[elementType] || {};
}

