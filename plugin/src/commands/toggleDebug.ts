/**
 * Toggle converter debug mode command.
 */

import * as fs from 'fs';
import { setDebugMode, getDebugLogPath } from '../converter';
import { showInfoDialog } from '../services/styledDialogs';

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
    const exists = fs.existsSync(logPath);
    await showInfoDialog(j, {
      title: 'Debug Enabled',
      message: `Converter debug ON.\n\nLog: ${logPath}\nExists: ${exists}`,
      icon: '🐛',
    });
  } else {
    await showInfoDialog(j, {
      title: 'Debug Disabled',
      message: 'Converter debug OFF.',
      icon: '🐛',
    });
  }
}

