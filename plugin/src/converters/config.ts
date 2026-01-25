/**
 * Converter Configuration
 * 
 * Loads and caches converter configuration from config/md-mapping.json.
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
  code_block: { spaceBelow: 12 },
  code_lang_label: { spaceAbove: 0, spaceBelow: 6 },
  callout: { spaceAbove: 8, spaceBelow: 8 },
};

/** Cached config per installDir */
const configCache = new Map<string, ConverterConfig>();

/** Current installDir for loading config */
let currentInstallDir: string | undefined;

/**
 * Set the install directory for loading config.
 * Call this once at plugin initialization.
 */
export function setInstallDir(installDir: string): void {
  currentInstallDir = installDir;
}

/**
 * Load converter configuration.
 * 
 * @param installDir - Optional override for install directory
 * @returns The merged configuration (defaults + file overrides)
 */
export function loadConfig(installDir?: string): ConverterConfig {
  const dir = installDir || currentInstallDir;
  
  if (!dir) {
    return DEFAULT_CONFIG;
  }
  
  // Check cache
  if (configCache.has(dir)) {
    return configCache.get(dir)!;
  }
  
  // Load from file
  let fileConfig: Partial<ConverterConfig> = {};
  try {
    const cfgPath = path.resolve(dir, 'config/md-mapping.json');
    if (fs.existsSync(cfgPath)) {
      const raw = fs.readFileSync(cfgPath, 'utf8');
      fileConfig = JSON.parse(raw);
    }
  } catch (err) {
    // Ignore errors, use defaults
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
  configCache.set(dir, merged);
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

