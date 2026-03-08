/**
 * Background poller service for automatic sync.
 * Handles interval-based polling with configurable settings.
 */

import { createSyncContext } from './syncContext';
import { MinimalPoller } from '../poller';
import { getSettings } from './settings';
import { hasValidTokens } from './oauthServer';

type JoplinApi = any;

let pollIntervalId: ReturnType<typeof setInterval> | null = null;

interface PollerConfig {
  j: JoplinApi;
  installDir: string;
  dataDir: string;
}

/**
 * Starts the background poller with configurable interval.
 * Clears any existing interval before starting a new one.
 */
export async function startBackgroundPoller(config: PollerConfig): Promise<void> {
  const { j, installDir, dataDir } = config;

  // Clear existing interval if any
  stopBackgroundPoller();

  try {
    const settings = await getSettings(j);

    if (!settings.autoSyncEnabled) {
      console.warn('[gdocs-poller] Auto sync is disabled in settings');
      return;
    }
    if (!hasValidTokens(installDir)) {
      console.warn('[gdocs-poller] No valid tokens at', installDir);
      return;
    }

    const intervalMs = (settings.pollIntervalMinutes || 5) * 60 * 1000;
    if (intervalMs <= 0) {
      console.warn('[gdocs-poller] Poll interval is 0, skipping');
      return;
    }

    console.warn('[gdocs-poller] Starting with interval', settings.pollIntervalMinutes, 'min');

    // Run poller function
    async function runPoller() {
      try {
        const ctx = await createSyncContext(installDir, dataDir, j);
        const poller = new MinimalPoller(ctx);
        await poller.initIfNeeded();
        await poller.syncOnce(j);
      } catch (e) {
        console.error('[gdocs] Background sync error:', e);
      }
    }

    // Start interval
    pollIntervalId = setInterval(runPoller, intervalMs);

    // Run immediately on start (after 5 second delay)
    setTimeout(runPoller, 5000);
  } catch (e) {
    console.error('[gdocs] Failed to start background poller:', e);
  }
}

/**
 * Stops the background poller if running.
 */
export function stopBackgroundPoller(): void {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
}

/**
 * Restarts the background poller (useful when settings change).
 */
export async function restartBackgroundPoller(config: PollerConfig): Promise<void> {
  await startBackgroundPoller(config);
}

/**
 * Registers a settings change listener to auto-restart poller.
 */
export async function registerPollerSettingsListener(config: PollerConfig): Promise<void> {
  const { j } = config;
  try {
    await j.settings.onChange(async (event: { keys?: Record<string, unknown> }) => {
      const relevantKeys = ['pollIntervalMinutes', 'autoSyncEnabled'];
      const changed = Object.keys(event.keys || {}).some((k: string) =>
        relevantKeys.some(rk => k.endsWith(rk))
      );
      if (changed) {
        console.warn('[gdocs-poller] Settings changed, restarting');
        await restartBackgroundPoller(config);
      }
    });
  } catch (e) {
    console.warn('[gdocs] Could not register settings change listener:', e);
  }
}

