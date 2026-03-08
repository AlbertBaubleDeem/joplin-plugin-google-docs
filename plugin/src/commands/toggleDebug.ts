/**
 * Toggle converter debug mode command.
 * Uses showMessageBox intentionally - distinct style for debug functionality.
 */

import { existsSync } from 'fs';
import { setDebugMode, getDebugLogPath } from '../converters';

type JoplinApi = any;

// Debug mode state
let converterDebugEnabled = false;

/**
 * Returns whether debug mode is currently enabled.
 */
export function isDebugEnabled(): boolean {
  return converterDebugEnabled;
}

interface ToggleDebugParams {
  j: JoplinApi;
  dataDir: string;
}

/**
 * Toggles converter debug mode on/off.
 */
export async function toggleConverterDebug(params: ToggleDebugParams): Promise<void> {
  const { j, dataDir } = params;

  converterDebugEnabled = !converterDebugEnabled;
  setDebugMode(converterDebugEnabled, dataDir);

  const logPath = getDebugLogPath();
  console.log('[gdocs] Debug enabled:', converterDebugEnabled, 'logPath:', logPath);

  if (converterDebugEnabled && logPath) {
    const exists = existsSync(logPath);
    await j.views.dialogs.showMessageBox(
      `Converter debug ENABLED.\n\nLog file: ${logPath}\nFile exists: ${exists}\nDataDir: ${dataDir}`
    );
  } else {
    await j.views.dialogs.showMessageBox('Converter debug DISABLED.');
  }
}

