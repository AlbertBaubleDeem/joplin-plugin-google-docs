console.warn('[gdocs] root index executing');
(function(){
  try {
    const j = (typeof globalThis !== 'undefined' && globalThis.joplin) ? globalThis.joplin : (typeof joplin !== 'undefined' ? joplin : null);
    if (!j) { return; }

    // Helper to resolve module paths
    let _installDir = null;
    let _dataDir = null;
    async function getDirs() {
      if (!_installDir) _installDir = (await j.plugins.installationDir()) || '';
      if (!_dataDir) _dataDir = await j.plugins.dataDir();
      return { installDir: _installDir, dataDir: _dataDir };
    }
    
    function resolveMod(installDir, modPath) {
      const path = require('path');
      return require(path.resolve(installDir, 'dist', modPath));
    }
    
    // Auth error handling helper
    async function handleError(e, errorPrefix) {
      const { installDir, dataDir } = await getDirs();
      const { isAuthError, handleAuthError } = resolveMod(installDir, 'services/authErrorHandler.js');
      
      if (isAuthError(e)) {
        console.log('[gdocs] handleError - detected auth error');
        await handleAuthError(j, e, installDir, dataDir);
      } else {
        const raw = (e && e.response && e.response.data) || (e && e.message) || e;
        const msg = (typeof raw === 'string') ? raw : JSON.stringify(raw, null, 2);
        console.error('[gdocs]', errorPrefix + ':', msg);
      }
    }

    // === COMMAND WRAPPERS ===
    // Each wraps a TypeScript module with error handling

    async function pollOnce() {
      try {
        const { installDir, dataDir } = await getDirs();
        const { createSyncContext } = resolveMod(installDir, 'services/SyncContext.js');
        const { MinimalPoller } = resolveMod(installDir, 'poller.js');
        const dialogs = resolveMod(installDir, 'services/styledDialogs.js');
        
        const ctx = await createSyncContext(installDir, dataDir);
        const poller = new MinimalPoller(ctx);
        
        const maybe = await poller.initIfNeeded();
        if (maybe === null) { 
          await dialogs.showInfoDialog(j, { title: 'Sync Initialized', message: 'Drive sync has been initialized. Run Poll Once again to sync.', icon: '🔄' }); 
          return; 
        }
        
        const syncRes = await poller.syncOnce(j);
        await dialogs.showSuccessDialog(j, 'Poll Complete', `Matched: ${syncRes.matched} | Updated: ${syncRes.updated}`);
      } catch (e) {
        await handleError(e, 'Poll error');
      }
    }

    async function createFromNoteCmd() {
      try {
        const { installDir, dataDir } = await getDirs();
        const { createFromNote } = resolveMod(installDir, 'commands/createFromNote.js');
        const dialogs = resolveMod(installDir, 'services/styledDialogs.js');
        await createFromNote({ j, installDir, dataDir });
        await dialogs.showSuccessDialog(j, 'Document Created', 'Google Doc created and linked to this note.');
      } catch (e) {
        await handleError(e, 'Create-from-note error');
      }
    }

    async function bindCurrentNoteCmd() {
      try {
        const { installDir, dataDir } = await getDirs();
        const { bindCurrentNote } = resolveMod(installDir, 'commands/bindNote.js');
        await bindCurrentNote({ j, dataDir });
      } catch (e) {
        await handleError(e, 'Bind error');
      }
    }

    async function unbindNotesCmd(noteIds) {
      try {
        const { installDir, dataDir } = await getDirs();
        const { batchUnbind } = resolveMod(installDir, 'services/batchOperations.js');
        await batchUnbind({ j, installDir, dataDir, noteIds });
      } catch (e) {
        await handleError(e, 'Unbind error');
      }
    }

    async function pullNotesCmd(noteIds) {
      try {
        const { installDir, dataDir } = await getDirs();
        const { isDebugEnabled } = resolveMod(installDir, 'commands/toggleDebug.js');
        const { batchPull } = resolveMod(installDir, 'services/batchOperations.js');
        await batchPull({ j, installDir, dataDir, noteIds, debugEnabled: isDebugEnabled() });
      } catch (e) {
        await handleError(e, 'Pull error');
      }
    }

    async function pushNotesCmd(noteIds) {
      try {
        const { installDir, dataDir } = await getDirs();
        const { isDebugEnabled } = resolveMod(installDir, 'commands/toggleDebug.js');
        const { batchPush } = resolveMod(installDir, 'services/batchOperations.js');
        await batchPush({ j, installDir, dataDir, noteIds, debugEnabled: isDebugEnabled() });
      } catch (e) {
        await handleError(e, 'Push error');
      }
    }

    async function toggleDebugCmd() {
      try {
        const { installDir, dataDir } = await getDirs();
        const { toggleConverterDebug } = resolveMod(installDir, 'commands/toggleDebug.js');
        await toggleConverterDebug({ j, dataDir });
      } catch (e) {
        await handleError(e, 'Toggle debug error');
      }
    }

    async function openPickerCmd() {
      try {
        const { installDir, dataDir } = await getDirs();
        const { openDrivePickerDialog } = resolveMod(installDir, 'commands/drivePickerDialog.js');
        const dialogs = resolveMod(installDir, 'services/styledDialogs.js');
        const res = await openDrivePickerDialog({ j, installDir, dataDir });
        if (res.created > 0) {
          await dialogs.showSuccessDialog(j, 'Import Complete', `Imported ${res.created} document${res.created > 1 ? 's' : ''}.`);
        }
      } catch (e) {
        await handleError(e, 'Picker error');
      }
    }

    async function exportNotebookCmd() {
      try {
        const { installDir, dataDir } = await getDirs();
        const dialogs = resolveMod(installDir, 'services/styledDialogs.js');
        
        const folder = await j.workspace.selectedFolder();
        if (!folder) {
          await dialogs.showWarningDialog(j, 'No Selection', 'Please select a notebook first.');
          return;
        }
        
        const { exportNotebook } = resolveMod(installDir, 'commands/exportNotebook.js');
        const res = await exportNotebook({ j, installDir, dataDir, folderId: folder.id });
        if (res) {
          await dialogs.showSuccessDialog(j, 'Export Complete', `Exported ${res.noteCount} note${res.noteCount > 1 ? 's' : ''} to Google Drive.`);
        }
      } catch (e) {
        await handleError(e, 'Export notebook error');
      }
    }

    async function setupWizardCmd() {
      try {
        const { installDir, dataDir } = await getDirs();
        const { runSetupWizard } = resolveMod(installDir, 'commands/setupWizard.js');
        await runSetupWizard({ j, installDir, dataDir });
      } catch (e) {
        await handleError(e, 'Setup wizard error');
      }
    }

    async function authorizeCmd() {
      try {
        const { installDir, dataDir } = await getDirs();
        const { authorize } = resolveMod(installDir, 'commands/authorize.js');
        const dialogs = resolveMod(installDir, 'services/styledDialogs.js');
        const result = await authorize({ j, installDir, dataDir });
        if (result.success) {
          await dialogs.showSuccessDialog(j, 'Authorization Complete', result.message);
        } else {
          await dialogs.showErrorDialog(j, 'Authorization Failed', result.message);
        }
      } catch (e) {
        await handleError(e, 'Authorization error');
      }
    }

    // === PLUGIN REGISTRATION ===

    j.plugins.register({
      onStart: async () => {
        console.log('[gdocs] Plugin onStart called');
        const { installDir, dataDir } = await getDirs();
        
        // Register settings
        try {
          const { registerSettings } = resolveMod(installDir, 'services/settings.js');
          await registerSettings(j);
          console.log('[gdocs] Registered plugin settings');
        } catch (e) {
          console.warn('[gdocs] Failed to register settings:', e);
        }
        
        // Commands with numbered labels for alphabetical sorting
        await j.commands.register({ name: 'gdocsPushNow', label: 'Google Docs Sync: 01 Push', execute: pushNotesCmd });
        await j.commands.register({ name: 'gdocsPullNow', label: 'Google Docs Sync: 02 Pull', execute: pullNotesCmd });
        await j.commands.register({ name: 'gdocsPollOnce', label: 'Google Docs Sync: 03 Poll Once', execute: pollOnce });
        await j.commands.register({ name: 'gdocsCreateFromNote', label: 'Google Docs Sync: 04 Export Note into Doc', execute: createFromNoteCmd });
        await j.commands.register({ name: 'gdocsExportNotebook', label: 'Google Docs Sync: 05 Export Notebook into Docs', execute: exportNotebookCmd });
        await j.commands.register({ name: 'gdocsPicker', label: 'Google Docs Sync: 06 Import Doc into Note', execute: openPickerCmd });
        await j.commands.register({ name: 'gdocsUnbind', label: 'Google Docs Sync: 07 Unbind Note from Doc', execute: unbindNotesCmd });
        await j.commands.register({ name: 'gdocsBind', label: 'Google Docs Sync: 08 Bind Note to Doc', execute: bindCurrentNoteCmd });
        await j.commands.register({ name: 'gdocsSetupWizard', label: 'Google Docs Sync: 09 Setup Wizard', execute: setupWizardCmd });
        await j.commands.register({ name: 'gdocsAuthorize', label: 'Google Docs Sync: 10 Authorize', execute: authorizeCmd });
        await j.commands.register({ name: 'gdocsToggleDebug', label: 'Google Docs Sync: 11 Toggle Debug', execute: toggleDebugCmd });
        
        // Check if setup is needed
        try {
          const { isSetupNeeded } = resolveMod(installDir, 'commands/setupWizard.js');
          if (isSetupNeeded(installDir)) {
            console.log('[gdocs] Setup needed - run "Setup Wizard" command to configure');
          }
        } catch (e) {
          console.warn('[gdocs] Could not check setup status:', e);
        }
        
        // Context menus
        await j.views.menuItems.create('notebookExportMenu', 'gdocsExportNotebook', 'folderContextMenu');
        await j.views.menuItems.create('gdocsPushMenuItem', 'gdocsPushNow', 'noteListContextMenu');
        await j.views.menuItems.create('gdocsPullMenuItem', 'gdocsPullNow', 'noteListContextMenu');
        await j.views.menuItems.create('gdocsUnbindMenuItem', 'gdocsUnbind', 'noteListContextMenu');
        
        // Note list renderer
        try {
          const { createSyncStatusRenderer } = resolveMod(installDir, 'noteListRenderer.js');
          const renderer = createSyncStatusRenderer(dataDir);
          await j.views.noteList.registerRenderer(renderer);
          console.log('[gdocs] Registered note list renderer with sync status');
        } catch (e) {
          console.warn('[gdocs] Failed to register note list renderer:', e);
        }
        
        // Background poller
        try {
          const { startBackgroundPoller, registerPollerSettingsListener } = resolveMod(installDir, 'services/backgroundPoller.js');
          const pollerConfig = { j, installDir, dataDir };
          await startBackgroundPoller(pollerConfig);
          await registerPollerSettingsListener(pollerConfig);
        } catch (e) {
          console.warn('[gdocs] Failed to start background poller:', e);
        }
      },
    });
  } catch (_) { /* ignore */ }
})();
