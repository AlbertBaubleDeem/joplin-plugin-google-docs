console.warn('[gdocs] root index executing');
(function(){
  try {
    const j = (typeof globalThis !== 'undefined' && globalThis.joplin) ? globalThis.joplin : (typeof joplin !== 'undefined' ? joplin : null);
    if (!j) { return; }

    async function pollOnce() {
      try {
        const path = require('path');
        const fs = require('fs');
        const dataDir = await j.plugins.dataDir();
        const installDir = (await j.plugins.installationDir()) || '';
        const googleapisPath = path.resolve(installDir, 'node_modules/googleapis');
        const { google } = require(googleapisPath);
        const pollerPath = path.resolve(installDir, 'dist/poller.js');
        const { MinimalPoller } = require(pollerPath);
        const envPath = path.resolve(installDir, '.env');
        const tokenPath = path.resolve(installDir, '.token.json');
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
        const poller = new MinimalPoller(dataDir);
        const maybe = await poller.initIfNeeded(auth);
        if (maybe === null) { await j.views.dialogs.showMessageBox('Initialized Drive pageToken. Run Poll Once again.'); return; }
        const res = await poller.processOnce(auth);
        const lines = res.items.map(it => `- noteId=${it.noteId} fileId=${it.fileId} tabMatched=${it.tabMatched}`);
        await j.views.dialogs.showMessageBox('Poll completed. Matches: ' + res.matched + (lines.length ? ('\n' + lines.join('\n')) : ''));
      } catch (e) {
        const raw = (e && e.response && e.response.data) || (e && e.message) || e;
        const msg = (typeof raw === 'string') ? raw : JSON.stringify(raw, null, 2);
        await j.views.dialogs.showMessageBox('Poll error: ' + msg);
      }
    }

    async function bindCurrentNote() {
      const noteIds = await j.workspace.selectedNoteIds();
      if (!noteIds.length) return;
      const [noteId] = noteIds;
      const path = require('path');
      const installDir = (await j.plugins.installationDir()) || '';
      const dataDir = await j.plugins.dataDir();
      const mappingPath = path.resolve(installDir, 'dist/mapping.js');
      const { bindNote } = require(mappingPath);
      const dId = 'gdocsBindDialog-' + Date.now();
      const d = await j.views.dialogs.create(dId);
      const html = `
        <form name="f" style="min-width: 420px">
          <p>Enter Google Drive fileId and optional tabId:</p>
          <label>fileId:<br/><input name="fileId" style="width: 98%" /></label><br/>
          <label>tabId (optional):<br/><input name="tabId" style="width: 98%" /></label>
        </form>
      `;
      await j.views.dialogs.setHtml(d, html);
      await j.views.dialogs.setButtons(d, [{ id: 'ok' }, { id: 'cancel' }]);
      const r = await j.views.dialogs.open(d);
      if (!r || r.id !== 'ok') return;
      const fd = (r.formData && (r.formData.f || r.formData)) || {};
      const fileId = fd.fileId ? String(fd.fileId).trim() : '';
      const tabId = fd.tabId ? String(fd.tabId).trim() : '';
      if (!fileId) { await j.views.dialogs.showMessageBox('fileId is required.'); return; }
      bindNote(dataDir, noteId, { fileId, tabId: tabId || undefined });
      await j.views.dialogs.showMessageBox('Bound note to fileId: ' + fileId + (tabId ? (' tabId: ' + tabId) : ''));
    }

    async function unbindCurrentNote() {
      const noteIds = await j.workspace.selectedNoteIds();
      if (!noteIds.length) return;
      const [noteId] = noteIds;
      const path = require('path');
      const installDir = (await j.plugins.installationDir()) || '';
      const dataDir = await j.plugins.dataDir();
      const mappingPath = path.resolve(installDir, 'dist/mapping.js');
      const { unbindNote } = require(mappingPath);
      unbindNote(dataDir, noteId);
      await j.views.dialogs.showMessageBox('Unbound note.');
    }

    async function pullNow() {
      try {
        const noteIds = await j.workspace.selectedNoteIds();
        if (!noteIds.length) return;
        const [noteId] = noteIds;
        const path = require('path');
        const fs = require('fs');
        const installDir = (await j.plugins.installationDir()) || '';
        const dataDir = await j.plugins.dataDir();
        const mappingPath = path.resolve(installDir, 'dist/mapping.js');
        const { loadMapping } = require(mappingPath);
        const mapping = loadMapping(dataDir);
        const binding = mapping.notes[noteId];
        if (!binding?.fileId) { await j.views.dialogs.showMessageBox('Note is not bound.'); return; }
        const googleapisPath = path.resolve(installDir, 'node_modules/googleapis');
        const { google } = require(googleapisPath);
        const pluginToken = path.resolve(installDir, '.token.json');
        const tokens = JSON.parse(fs.readFileSync(pluginToken, 'utf8'));
        const auth = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI,
        );
        auth.setCredentials(tokens);
        const docs = google.docs({ version: 'v1', auth });
        const doc = await docs.documents.get({ documentId: binding.fileId });
        const conv = require(path.resolve(installDir, 'dist/converter.js'));
            const md = conv.convertDocumentToMarkdown(doc.data, { installDir });
        await j.data.put(['notes', noteId], null, { body: md });
        await j.views.dialogs.showMessageBox('Pulled content into the note.');
      } catch (e) {
        const raw = (e && e.response && e.response.data) || (e && e.message) || e;
        const msg = (typeof raw === 'string') ? raw : JSON.stringify(raw, null, 2);
        await j.views.dialogs.showMessageBox('Pull error: ' + msg);
      }
    }

    j.plugins.register({
      onStart: async () => {
        await j.commands.register({ name: 'gdocsHello', label: 'Google Docs Sync: Hello', execute: async () => { await j.views.dialogs.showMessageBox('Google Docs plugin is active.'); } });
        await j.commands.register({ name: 'gdocsPollOnce', label: 'Google Docs Sync: Poll Once (log-only)', execute: async () => { await pollOnce(); } });
        await j.commands.register({ name: 'gdocsBind', label: 'Google Docs Sync: Bind note to Drive fileId', execute: async () => { await bindCurrentNote(); } });
        await j.commands.register({ name: 'gdocsUnbind', label: 'Google Docs Sync: Unbind note', execute: async () => { await unbindCurrentNote(); } });
        await j.commands.register({ name: 'gdocsPullNow', label: 'Google Docs Sync: Pull (update note)', execute: async () => { await pullNow(); } });
        await j.views.menuItems.create('gdocsHelloMenu','gdocsHello', j.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Hello' });
        await j.views.menuItems.create('gdocsPollOnceMenu','gdocsPollOnce', j.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Poll Once (log-only)' });
        await j.views.menuItems.create('gdocsBindMenu','gdocsBind', j.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Bind note' });
        await j.views.menuItems.create('gdocsUnbindMenu','gdocsUnbind', j.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Unbind note' });
        await j.views.menuItems.create('gdocsPullNowMenu','gdocsPullNow', j.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Pull (update note)' });
      },
    });
  } catch (_) { /* ignore */ }
})();


