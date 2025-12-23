/**
 * Converter Configuration
 * 
 * Loads and caches converter configuration from config/md-mapping.json.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ConverterConfig } from './types';

/** Default configuration */
const DEFAULT_CONFIG: ConverterConfig = {
  title: { useTitle: true, source: 'first_line' },
  subtitle: { mode: 'italic' },
  code: {
    inline: { marker: '`' },
    block: { detect: true },
    monoFont: 'Roboto Mono',
  },
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
  
  // Merge with defaults
  const merged: ConverterConfig = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    title: { ...DEFAULT_CONFIG.title, ...fileConfig.title },
    subtitle: { ...DEFAULT_CONFIG.subtitle, ...fileConfig.subtitle },
    code: { ...DEFAULT_CONFIG.code, ...fileConfig.code },
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

