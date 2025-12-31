console.warn('[gdocs] root index executing');
(function(){
  try {
    const j = (typeof globalThis !== 'undefined' && globalThis.joplin) ? globalThis.joplin : (typeof joplin !== 'undefined' ? joplin : null);
    if (!j) { return; }

    // Debug mode state for converter IR logging
    let converterDebugEnabled = false;

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
        
        // Enable debug mode if toggled on
        if (converterDebugEnabled) {
          const converter = require(path.resolve(installDir, 'dist/converter/index.js'));
          converter.setDebugMode(true, dataDir);
        }
        
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

    async function toggleConverterDebug() {
      const path = require('path');
      const fs = require('fs');
      const installDir = (await j.plugins.installationDir()) || '';
      const dataDir = await j.plugins.dataDir();
      
      console.log('[gdocs] dataDir:', dataDir);
      console.log('[gdocs] installDir:', installDir);
      
      const converter = require(path.resolve(installDir, 'dist/converter/index.js'));
      
      converterDebugEnabled = !converterDebugEnabled;
      converter.setDebugMode(converterDebugEnabled, dataDir);
      
      const logPath = converter.getDebugLogPath();
      console.log('[gdocs] Debug enabled:', converterDebugEnabled, 'logPath:', logPath);
      
      if (converterDebugEnabled && logPath) {
        // Verify the file was created
        const exists = fs.existsSync(logPath);
        await j.views.dialogs.showMessageBox(
          `Converter debug ENABLED.\n\nLog file: ${logPath}\nFile exists: ${exists}\nDataDir: ${dataDir}`
        );
      } else {
        await j.views.dialogs.showMessageBox('Converter debug DISABLED.');
      }
    }

    async function pushNow() {
      try {
        const path = require('path');
        const fs = require('fs');
        const installDir = (await j.plugins.installationDir()) || '';
        const dataDir = await j.plugins.dataDir();
        
        // Check GCS configuration
        const settingsMod = require(path.resolve(installDir, 'dist/services/settings.js'));
        const gcsBucket = settingsMod.getGCSBucketName(installDir);
        console.log('[gdocs] Push - GCS bucket:', gcsBucket || 'NOT CONFIGURED');
        console.log('[gdocs] Push - installDir:', installDir);
        
        // Enable debug mode if toggled on - MUST be done before requiring commands
        if (converterDebugEnabled) {
          console.log('[gdocs] Enabling converter debug for push');
          const converter = require(path.resolve(installDir, 'dist/converter/index.js'));
          converter.setDebugMode(true, dataDir);
          console.log('[gdocs] Debug mode set, isEnabled:', converter.isDebugEnabled());
        }
        
        const mod = require(path.resolve(installDir, 'dist/commands/pushNote.js'));
        const res = await mod.pushNote({ j, installDir, dataDir });
        
        // Show debug log in message box
        const debugSummary = res.debugLog ? res.debugLog.join('\n') : 'No debug log';
        
        // Show debug log in message box for troubleshooting
        await j.views.dialogs.showMessageBox(
          'Push Result\n\n' +
          'revisionId: ' + res.newRevisionId + '\n\n' +
          '=== Debug Log ===\n' + debugSummary
        );
      } catch (e) {
        const raw = (e && e.response && e.response.data) || (e && e.message) || e;
        const msg = (typeof raw === 'string') ? raw : JSON.stringify(raw, null, 2);
        
        // Get debug log from file
        let debugSummary = 'No debug log';
        try {
          const mod = require(path.resolve(installDir, 'dist/commands/pushNote.js'));
          debugSummary = mod.getDebugLogFromFile ? mod.getDebugLogFromFile(dataDir) : 'No file reader';
        } catch (logErr) {
          debugSummary = 'Error reading log: ' + logErr.message;
        }
        
        await j.views.dialogs.showMessageBox('Push error: ' + msg + '\n\n=== Debug Log ===\n' + debugSummary);
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

    async function exportNotebookCmd() {
      try {
        const path = require('path');
        const installDir = (await j.plugins.installationDir()) || '';
        const dataDir = await j.plugins.dataDir();
        
        // Check if a folder is selected
        const folder = await j.workspace.selectedFolder();
        if (!folder) {
          await j.views.dialogs.showMessageBox('Please select a notebook first');
          return;
        }
        
        const mod = require(path.resolve(installDir, 'dist/commands/exportNotebook.js'));
        const res = await mod.exportNotebook({ j, installDir, dataDir, folderId: folder.id });
        if (res) {
          await j.views.dialogs.showMessageBox(
            `Successfully exported notebook to Google Drive folder.\n` +
            `Folder ID: ${res.fileId}\n` +
            `Notes exported: ${res.noteCount}`
          );
        }
      } catch (e) {
        const raw = (e && e.response && e.response.data) || (e && e.message) || e;
        const msg = (typeof raw === 'string') ? raw : JSON.stringify(raw, null, 2);
        await j.views.dialogs.showMessageBox('Export notebook error: ' + msg);
      }
    }

    j.plugins.register({
      onStart: async () => {
        console.log('[gdocs] Plugin onStart called');
        await j.commands.register({ name: 'gdocsHello', label: 'Google Docs Sync: Hello', execute: async () => { await j.views.dialogs.showMessageBox('Google Docs plugin is active.'); } });
        console.log('[gdocs] Registered gdocsHello command');
        await j.commands.register({ name: 'gdocsPollOnce', label: 'Google Docs Sync: Poll Once', execute: async () => { await pollOnce(); } });
        await j.commands.register({ name: 'gdocsBind', label: 'Google Docs Sync: Bind note to Drive fileId', execute: async () => { await bindCurrentNote(); } });
        await j.commands.register({ name: 'gdocsUnbind', label: 'Google Docs Sync: Unbind note', execute: async () => { await unbindCurrentNote(); } });
        await j.commands.register({ name: 'gdocsPullNow', label: 'Google Docs Sync: Pull (update note)', execute: async () => { await pullNow(); } });
        await j.commands.register({ name: 'gdocsPushNow', label: 'Google Docs Sync: Push (update Doc)', execute: async () => { await pushNow(); } });
        await j.commands.register({ name: 'gdocsCreateFromNote', label: 'Google Docs Sync: Create Doc from Note', execute: async () => { await createFromNoteCmd(); } });
        await j.commands.register({ name: 'gdocsAutoPair', label: 'Google Docs Sync: Auto Pair Folder', execute: async () => { await autoPairFolder(); } });
        await j.commands.register({ name: 'gdocsMigrateToAppDoc', label: 'Google Docs Sync: Migrate to App Doc', execute: async () => { await migrateToAppDocCmd(); } });
        await j.commands.register({ name: 'gdocsPicker', label: 'Google Docs Sync: Import/Bind (Dialog)', execute: async () => { await openPickerCmd(); } });
        await j.commands.register({ name: 'gdocsExportNotebook', label: 'Google Docs Sync: Export Notebook to Drive Folder', execute: async () => { await exportNotebookCmd(); } });
        await j.commands.register({ name: 'gdocsToggleDebug', label: 'Google Docs Sync: Toggle Converter Debug', execute: async () => { await toggleConverterDebug(); } });
        
        // Add notebook export to folder context menu
        await j.views.menuItems.create('notebookExportMenu', 'gdocsExportNotebook', 'folderContextMenu');
        
        // Register custom note list renderer with sync status indicators
        try {
          const path = require('path');
          const installDir = (await j.plugins.installationDir()) || '';
          const dataDir = await j.plugins.dataDir();
          const { createSyncStatusRenderer } = require(path.resolve(installDir, 'dist/noteListRenderer.js'));
          const renderer = createSyncStatusRenderer(dataDir);
          await j.views.noteList.registerRenderer(renderer);
          console.log('[gdocs] Registered note list renderer with sync status');
        } catch (e) {
          console.warn('[gdocs] Failed to register note list renderer:', e);
        }
      },
    });
  } catch (_) { /* ignore */ }
})();


