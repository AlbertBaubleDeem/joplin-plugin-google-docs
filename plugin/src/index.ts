import joplin from 'api';
import path from 'path';
import fs from 'fs';
// Defer loading heavy deps (googleapis, poller) until command execution

console.info('[gdocs] module loaded');

joplin.plugins.register({
  onStart: async () => {
    try {
      console.info('[gdocs] onStart: registering commands');
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
            const { google } = require('googleapis');
            const { MinimalPoller } = require('./poller');
            // Load tokens/env from the plugin folder if present; fallback to test harness
            const installDir = (await joplin.plugins.installationDir()) || '';
            const repoRoot = path.resolve(process.cwd(), '..');

            const pluginEnv = path.resolve(installDir, '.env');
            const pluginToken = path.resolve(installDir, '.token.json');
            const harnessEnv = path.resolve(repoRoot, 'google-api-tests/.env');
            const harnessToken = path.resolve(repoRoot, 'google-api-tests/.token.json');

            const chosenEnvPath = fs.existsSync(pluginEnv) ? pluginEnv : (fs.existsSync(harnessEnv) ? harnessEnv : '');
            if (chosenEnvPath) {
              const env = fs.readFileSync(chosenEnvPath, 'utf8');
              for (const line of env.split('\n')) {
                const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
                if (m) process.env[m[1]] = m[2];
              }
            }

            const tokenPath = process.env.GOOGLE_TOKENS_PATH
              ? process.env.GOOGLE_TOKENS_PATH
              : (fs.existsSync(pluginToken) ? pluginToken : harnessToken);
            const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
            const auth = new google.auth.OAuth2(
              process.env.GOOGLE_CLIENT_ID,
              process.env.GOOGLE_CLIENT_SECRET,
              process.env.GOOGLE_REDIRECT_URI,
            );
            auth.setCredentials(tokens);
            // Prefer plugin dir for state/mapping if present; otherwise fallback to harness layout
            const baseDir = fs.existsSync(path.resolve(installDir, 'mapping.json')) || fs.existsSync(path.resolve(installDir, 'changes.state.json'))
              ? installDir
              : repoRoot;
            const poller = new MinimalPoller(baseDir);
            const maybe = await poller.initIfNeeded(auth);
            if (maybe === null) return; // first-run init only
            await poller.processOnce(auth);
          } catch (e: any) {
            const msg = (e && e.response && e.response.data) || (e && e.message) || e;
            console.error('[gdocs] poll error', msg);
          }
        },
      });
      console.info('[gdocs] onStart: commands registered');

      // Add menu items under Tools for quick visibility
      try {
        await joplin.views.menuItems.create('gdocsHelloMenu', 'gdocsHello', joplin.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Hello' });
        await joplin.views.menuItems.create('gdocsPollOnceMenu', 'gdocsPollOnce', joplin.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Poll Once (log-only)' });
        console.info('[gdocs] onStart: menu items created');
      } catch (menuErr: any) {
        const msg = (menuErr && menuErr.message) || menuErr;
        console.error('[gdocs] menu create error', msg);
      }

      // Write a marker file to the plugin directory to prove onStart executed
      try {
        const dir = (await joplin.plugins.installationDir()) || '';
        if (dir) {
          fs.writeFileSync(require('path').resolve(dir, 'started.txt'), new Date().toISOString());
          console.info('[gdocs] wrote started.txt to', dir);
        }
      } catch (ioErr: any) {
        const msg = (ioErr && ioErr.message) || ioErr;
        console.error('[gdocs] start marker error', msg);
      }
    } catch (err: any) {
      const msg = (err && err.message) || err;
      console.error('[gdocs] onStart error', msg);
    }
  },
});
