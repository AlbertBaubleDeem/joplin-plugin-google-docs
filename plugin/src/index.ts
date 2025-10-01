import joplin from 'api';
import path from 'path';
import fs from 'fs';
import { bindNote, unbindNote, loadMapping } from './mapping';
// Defer loading heavy deps (googleapis, poller) until command execution

console.warn('[gdocs] root index executing (dist)');

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
            // Load tokens/env from the plugin folder
            const installDir = (await joplin.plugins.installationDir()) || '';
            const dataDir = await joplin.plugins.dataDir();

            const pluginEnv = path.resolve(installDir, '.env');
            const pluginToken = path.resolve(installDir, '.token.json');
            const chosenEnvPath = fs.existsSync(pluginEnv) ? pluginEnv : '';
            if (chosenEnvPath) {
              const env = fs.readFileSync(chosenEnvPath, 'utf8');
              for (const line of env.split('\n')) {
                const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
                if (m) process.env[m[1]] = m[2];
              }
            }

            const tokenPath = process.env.GOOGLE_TOKENS_PATH
              ? process.env.GOOGLE_TOKENS_PATH
              : (fs.existsSync(pluginToken) ? pluginToken : '');
            const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
            const auth = new google.auth.OAuth2(
              process.env.GOOGLE_CLIENT_ID,
              process.env.GOOGLE_CLIENT_SECRET,
              process.env.GOOGLE_REDIRECT_URI,
            );
            auth.setCredentials(tokens);
            const poller = new MinimalPoller(dataDir);
            const maybe = await poller.initIfNeeded(auth);
            if (maybe === null) {
              await joplin.views.dialogs.showMessageBox('Initialized Drive pageToken. Run Poll Once again.');
              return; // first-run init only
            }
            const res = await poller.processOnce(auth);
            const lines = res.items.map((it: any) => `- noteId=${it.noteId} fileId=${it.fileId} tabMatched=${it.tabMatched}`);
            await joplin.views.dialogs.showMessageBox(`Poll completed. Matches: ${res.matched}${lines.length ? ('\n' + lines.join('\n')) : ''}`);
          } catch (e: any) {
            const msg = (e && e.response && e.response.data) || (e && e.message) || e;
            console.error('[gdocs] poll error', msg);
          }
        },
      });

      await joplin.commands.register({
        name: 'gdocsBind',
        label: 'Google Docs Sync: Bind note to Drive fileId',
        execute: async () => {
          const noteIds = await joplin.workspace.selectedNoteIds();
          if (!noteIds.length) return;
          const [noteId] = noteIds;
          const dataDir = await joplin.plugins.dataDir();
          const dId = 'gdocsBindDialog-' + Date.now();
          const d = await joplin.views.dialogs.create(dId);
          const html = `
            <form name="f" style="min-width: 420px">
              <p>Enter Google Drive fileId and optional tabId:</p>
              <label>fileId:<br/><input name="fileId" style="width: 98%" /></label><br/>
              <label>tabId (optional):<br/><input name="tabId" style="width: 98%" /></label>
            </form>
          `;
          await joplin.views.dialogs.setHtml(d, html);
          await joplin.views.dialogs.setButtons(d, [{ id: 'ok' }, { id: 'cancel' }]);
          const r = await joplin.views.dialogs.open(d);
          if (!r || r.id !== 'ok') return;
          const fd: any = (r.formData && (r.formData.f || r.formData)) || {};
          const fileId = fd.fileId ? String(fd.fileId).trim() : '';
          const tabId = fd.tabId ? String(fd.tabId).trim() : '';
          if (!fileId) { await joplin.views.dialogs.showMessageBox('fileId is required.'); return; }
          bindNote(dataDir, noteId, { fileId, tabId: tabId || undefined });
          await joplin.views.dialogs.showMessageBox('Bound note to fileId: ' + fileId + (tabId ? (' tabId: ' + tabId) : ''));
        },
      });

      await joplin.commands.register({
        name: 'gdocsUnbind',
        label: 'Google Docs Sync: Unbind note',
        execute: async () => {
          const noteIds = await joplin.workspace.selectedNoteIds();
          if (!noteIds.length) return;
          const [noteId] = noteIds;
          const dataDir = await joplin.plugins.dataDir();
          unbindNote(dataDir, noteId);
          console.info('[gdocs] unbound note', noteId);
        },
      });

      await joplin.views.menuItems.create('gdocsBindMenu', 'gdocsBind', joplin.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Bind note' });
      await joplin.views.menuItems.create('gdocsUnbindMenu', 'gdocsUnbind', joplin.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Unbind note' });
      console.info('[gdocs] onStart: commands registered');

      // Add menu items under Tools for quick visibility
      try {
        await joplin.views.menuItems.create('gdocsHelloMenu', 'gdocsHello', joplin.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Hello' });
        await joplin.views.menuItems.create('gdocsPollOnceMenu', 'gdocsPollOnce', joplin.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Poll Once (log-only)' });
        // Pull command
        await joplin.commands.register({
          name: 'gdocsPullNow',
          label: 'Google Docs Sync: Pull (update note)',
          execute: async () => {
            try {
              const noteIds = await joplin.workspace.selectedNoteIds();
              if (!noteIds.length) return;
              const [noteId] = noteIds;
              const dataDir = await joplin.plugins.dataDir();
              const installDir = (await joplin.plugins.installationDir()) || '';
              const mapping = loadMapping(dataDir);
              const binding: any = mapping.notes[noteId];
              if (!binding?.fileId) { await joplin.views.dialogs.showMessageBox('Note is not bound.'); return; }
              const { google } = require('googleapis');
              const pluginToken = path.resolve(installDir, '.token.json');
              const tokens = JSON.parse(fs.readFileSync(pluginToken, 'utf8'));
              const auth = new (require('googleapis').google).auth.OAuth2(
                process.env.GOOGLE_CLIENT_ID,
                process.env.GOOGLE_CLIENT_SECRET,
                process.env.GOOGLE_REDIRECT_URI,
              );
              auth.setCredentials(tokens);
              const docs = require('googleapis').google.docs({ version: 'v1', auth });
              const doc = await docs.documents.get({ documentId: binding.fileId });
              const content = (doc.data.body && doc.data.body.content) || [];
              const lines: string[] = [];
              for (const c of content) {
                const p: any = (c as any).paragraph;
                if (!p || !p.elements) continue;
                let line = '';
                for (const el of p.elements) {
                  const tr: any = el.textRun;
                  if (tr && tr.content) line += tr.content;
                }
                if (line.trim().length) lines.push(line.replace(/\n+$/, '').trimEnd());
              }
              const md = lines.join('\n\n');
              await joplin.data.put(['notes', noteId], null, { body: md });
              await joplin.views.dialogs.showMessageBox('Pulled content into the note.');
            } catch (e: any) {
              const msg = (e && e.response && e.response.data) || (e && e.message) || String(e);
              await joplin.views.dialogs.showMessageBox('Pull error: ' + msg);
            }
          },
        });
        await joplin.views.menuItems.create('gdocsPullNowMenu', 'gdocsPullNow', joplin.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Pull (update note)' });
        console.info('[gdocs] onStart: menu items created');
      } catch (menuErr: any) {
        const msg = (menuErr && menuErr.message) || menuErr;
        console.error('[gdocs] menu create error', msg);
      }

      // No marker writes to install dir
    } catch (err: any) {
      const msg = (err && err.message) || err;
      console.error('[gdocs] onStart error', msg);
    }
  },
});
