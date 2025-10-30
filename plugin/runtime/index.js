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
        const pollerPath = path.resolve(installDir, 'dist/poller.js');
        const { MinimalPoller } = require(pollerPath);
        const { getAuthFromInstallDir } = require(path.resolve(installDir, 'dist/services/auth.js'));
        const { google, auth } = await getAuthFromInstallDir(installDir);
        const poller = new MinimalPoller(dataDir);
        const maybe = await poller.initIfNeeded(auth);
        if (maybe === null) { await j.views.dialogs.showMessageBox('Initialized Drive pageToken. Run Poll Once again.'); return; }
        const syncRes = await poller.syncOnce(auth, j, installDir, dataDir);
        const lines = (syncRes.decisions || []).map(d => `- noteId=${d.noteId} fileId=${d.fileId} action=${d.action} reason=${d.reason} tabMatched=${d.tabMatched}`);
        await j.views.dialogs.showMessageBox('Poll completed. Matches: ' + syncRes.matched + ' Updated: ' + syncRes.updated + (lines.length ? ('\n' + lines.join('\n')) : ''));
      } catch (e) {
        const raw = (e && e.response && e.response.data) || (e && e.message) || e;
        const msg = (typeof raw === 'string') ? raw : JSON.stringify(raw, null, 2);
        await j.views.dialogs.showMessageBox('Poll error: ' + msg);
      }
    }

    async function createFromNoteCmd() {
      try {
        const path = require('path');
        const installDir = (await j.plugins.installationDir()) || '';
        const dataDir = await j.plugins.dataDir();
        const mod = require(path.resolve(installDir, 'dist/commands/createFromNote.js'));
        const res = await mod.createFromNote({ j, installDir, dataDir });
        await j.views.dialogs.showMessageBox('Created Google Doc and bound note. newFileId=' + res.newFileId);
      } catch (e) {
        const raw = (e && e.response && e.response.data) || (e && e.message) || e;
        const msg = (typeof raw === 'string') ? raw : JSON.stringify(raw, null, 2);
        await j.views.dialogs.showMessageBox('Create-from-note error: ' + msg);
      }
    }

    async function bindCurrentNote() {
      const noteIds = await j.workspace.selectedNoteIds();
      if (!noteIds.length) return;
      const [noteId] = noteIds;
      const path = require('path');
      const installDir = (await j.plugins.installationDir()) || '';
      const dataDir = await j.plugins.dataDir();
      const bindDoerPath = path.resolve(installDir, 'dist/commands/bindNote.js');
      const { bindNoteDoer } = require(bindDoerPath);
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
      bindNoteDoer(dataDir, noteId, fileId, tabId || undefined);
      await j.views.dialogs.showMessageBox('Bound note to fileId: ' + fileId + (tabId ? (' tabId: ' + tabId) : ''));
    }

    async function unbindCurrentNote() {
      const noteIds = await j.workspace.selectedNoteIds();
      if (!noteIds.length) return;
      const [noteId] = noteIds;
      const path = require('path');
      const installDir = (await j.plugins.installationDir()) || '';
      const dataDir = await j.plugins.dataDir();
      const unbindDoerPath = path.resolve(installDir, 'dist/commands/unbindNote.js');
      const { unbindNoteDoer } = require(unbindDoerPath);
      unbindNoteDoer(dataDir, noteId);
      await j.views.dialogs.showMessageBox('Unbound note.');
    }

    async function pullNow() {
      try {
        const path = require('path');
        const installDir = (await j.plugins.installationDir()) || '';
        const dataDir = await j.plugins.dataDir();
        const pullDoerPath = path.resolve(installDir, 'dist/commands/pullNote.js');
        const { pullNote } = require(pullDoerPath);
        const res = await pullNote({ j, installDir, dataDir });
        await j.views.dialogs.showMessageBox('Pulled content into the note.' + (res.tabCount ? (' tabs=' + res.tabCount + (res.usedTabTitle ? (' used="' + res.usedTabTitle + '"') : '')) : ''));
      } catch (e) {
        const raw = (e && e.response && e.response.data) || (e && e.message) || e;
        const msg = (typeof raw === 'string') ? raw : JSON.stringify(raw, null, 2);
        await j.views.dialogs.showMessageBox('Pull error: ' + msg);
      }
    }

    async function autoPairFolder() {
      try {
        const path = require('path');
        const installDir = (await j.plugins.installationDir()) || '';
        const dataDir = await j.plugins.dataDir();
        const runPath = path.resolve(installDir, 'dist/commands/autoPairRun.js');
        const { autoPairRun } = require(runPath);
        const res = await autoPairRun({ j, installDir, dataDir });
        await j.views.dialogs.showMessageBox(`Auto Pair complete. folderId=${res.folderId} scanned=${res.scanned} created=${res.created} linked=${res.linkedExisting} ensured=${res.ensuredMapping}`);
      } catch (e) {
        const raw = (e && e.response && e.response.data) || (e && e.message) || e;
        const msg = (typeof raw === 'string') ? raw : JSON.stringify(raw, null, 2);
        await j.views.dialogs.showMessageBox('Auto Pair error: ' + msg);
      }
    }

    async function migrateToAppDocCmd() {
      try {
        const path = require('path');
        const installDir = (await j.plugins.installationDir()) || '';
        const dataDir = await j.plugins.dataDir();
        const mod = require(path.resolve(installDir, 'dist/commands/migrateToAppDoc.js'));
        const res = await mod.migrateToAppDoc({ j, installDir, dataDir });
        await j.views.dialogs.showMessageBox('Migrated to App Doc. newFileId=' + res.newFileId + ' noteId=' + res.noteId);
      } catch (e) {
        const raw = (e && e.response && e.response.data) || (e && e.message) || e;
        const msg = (typeof raw === 'string') ? raw : JSON.stringify(raw, null, 2);
        await j.views.dialogs.showMessageBox('Migrate error: ' + msg);
      }
    }

    async function pushNow() {
      try {
        const path = require('path');
        const installDir = (await j.plugins.installationDir()) || '';
        const dataDir = await j.plugins.dataDir();
        const mod = require(path.resolve(installDir, 'dist/commands/pushNote.js'));
        const res = await mod.pushNote({ j, installDir, dataDir });
        await j.views.dialogs.showMessageBox('Pushed note to Google Doc. revisionId=' + res.newRevisionId);
      } catch (e) {
        const raw = (e && e.response && e.response.data) || (e && e.message) || e;
        const msg = (typeof raw === 'string') ? raw : JSON.stringify(raw, null, 2);
        await j.views.dialogs.showMessageBox('Push error: ' + msg);
      }
    }

    async function openPickerCmd() {
      try {
        const path = require('path');
        const installDir = (await j.plugins.installationDir()) || '';
        const dataDir = await j.plugins.dataDir();
        const mod = require(path.resolve(installDir, 'dist/commands/drivePickerDialog.js'));
        const res = await mod.openDrivePickerDialog({ j, installDir, dataDir });
        await j.views.dialogs.showMessageBox('Drive picker completed. selected=' + res.selected.length + ' created=' + res.created + ' bound=' + res.bound);
      } catch (e) {
        const raw = (e && e.response && e.response.data) || (e && e.message) || e;
        const msg = (typeof raw === 'string') ? raw : JSON.stringify(raw, null, 2);
        await j.views.dialogs.showMessageBox('Picker error: ' + msg);
      }
    }

    j.plugins.register({
      onStart: async () => {
        await j.commands.register({ name: 'gdocsHello', label: 'Google Docs Sync: Hello', execute: async () => { await j.views.dialogs.showMessageBox('Google Docs plugin is active.'); } });
        await j.commands.register({ name: 'gdocsPollOnce', label: 'Google Docs Sync: Poll Once (log-only)', execute: async () => { await pollOnce(); } });
        await j.commands.register({ name: 'gdocsBind', label: 'Google Docs Sync: Bind note to Drive fileId', execute: async () => { await bindCurrentNote(); } });
        await j.commands.register({ name: 'gdocsUnbind', label: 'Google Docs Sync: Unbind note', execute: async () => { await unbindCurrentNote(); } });
        await j.commands.register({ name: 'gdocsPullNow', label: 'Google Docs Sync: Pull (update note)', execute: async () => { await pullNow(); } });
        await j.commands.register({ name: 'gdocsPushNow', label: 'Google Docs Sync: Push (update Doc)', execute: async () => { await pushNow(); } });
        await j.commands.register({ name: 'gdocsCreateFromNote', label: 'Google Docs Sync: Create Doc from Note', execute: async () => { await createFromNoteCmd(); } });
        await j.commands.register({ name: 'gdocsAutoPair', label: 'Google Docs Sync: Auto Pair Folder', execute: async () => { await autoPairFolder(); } });
        await j.commands.register({ name: 'gdocsMigrateToAppDoc', label: 'Google Docs Sync: Migrate to App Doc', execute: async () => { await migrateToAppDocCmd(); } });
        await j.commands.register({ name: 'gdocsPicker', label: 'Google Docs Sync: Import/Bind (Dialog)', execute: async () => { await openPickerCmd(); } });
        await j.views.menuItems.create('gdocsHelloMenu','gdocsHello', j.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Hello' });
        await j.views.menuItems.create('gdocsPollOnceMenu','gdocsPollOnce', j.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Poll Once (log-only)' });
        await j.views.menuItems.create('gdocsBindMenu','gdocsBind', j.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Bind note' });
        await j.views.menuItems.create('gdocsUnbindMenu','gdocsUnbind', j.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Unbind note' });
        await j.views.menuItems.create('gdocsPullNowMenu','gdocsPullNow', j.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Pull (update note)' });
        await j.views.menuItems.create('gdocsPushNowMenu','gdocsPushNow', j.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Push (update Doc)' });
        await j.views.menuItems.create('gdocsCreateFromNoteMenu','gdocsCreateFromNote', j.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Create Doc from Note' });
        await j.views.menuItems.create('gdocsMigrateMenu','gdocsMigrateToAppDoc', j.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Migrate to App Doc' });
        await j.views.menuItems.create('gdocsAutoPairMenu','gdocsAutoPair', j.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Auto Pair Folder' });
        await j.views.menuItems.create('gdocsPickerMenu','gdocsPicker', j.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Import/Bind (Dialog)' });
      },
    });
  } catch (_) { /* ignore */ }
})();


