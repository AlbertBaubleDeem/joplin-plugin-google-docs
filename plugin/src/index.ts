import joplin from 'api';
import path from 'path';
import fs from 'fs';
import { google } from 'googleapis';
import { MinimalPoller } from './poller';

(async () => {
  await joplin.plugins.register({
    onStart: async () => {
      await joplin.commands.register({
        name: 'gdocsHello',
        label: 'Google Docs Sync: Hello',
        execute: async () => {
          console.info('[gdocs] Skeleton plugin loaded');
        },
      });

      await joplin.commands.register({
        name: 'gdocsPollOnce',
        label: 'Google Docs Sync: Poll Once (log-only)',
        execute: async () => {
          try {
            // Load tokens/env from the test harness location for now
            const cwd = (await joplin.plugins.installationDir()) || '';
            // The repo root is two levels up from dist when packaged; here we assume dev layout
            const repoRoot = path.resolve(process.cwd(), '..');
            const envPath = path.resolve(repoRoot, 'google-api-tests/.env');
            const tokenPath = process.env.GOOGLE_TOKENS_PATH || path.resolve(repoRoot, 'google-api-tests/.token.json');
            if (fs.existsSync(envPath)) {
              const env = fs.readFileSync(envPath, 'utf8');
              for (const line of env.split('\n')) {
                const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
                if (m) process.env[m[1]] = m[2];
              }
            }
            const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
            const auth = new google.auth.OAuth2(
              process.env.GOOGLE_CLIENT_ID,
              process.env.GOOGLE_CLIENT_SECRET,
              process.env.GOOGLE_REDIRECT_URI,
            );
            auth.setCredentials(tokens);
            const poller = new MinimalPoller(repoRoot);
            const maybe = await poller.initIfNeeded(auth);
            if (maybe === null) return; // first-run init only
            await poller.processOnce(auth);
          } catch (e: any) {
            console.error('[gdocs] poll error', e?.response?.data || e?.message || e);
          }
        },
      });
    },
  });
})();
