console.warn('[gdocs] root index executing');
(function(){
  try {
    const j = (typeof globalThis !== 'undefined' && globalThis.joplin) ? globalThis.joplin : (typeof joplin !== 'undefined' ? joplin : null);
    if (!j) { return; }

    // Debug mode state for converter IR logging
    let converterDebugEnabled = false;
    
    // Helper to get styled dialogs module
    async function getStyledDialogs() {
      const path = require('path');
      const installDir = (await j.plugins.installationDir()) || '';
      return require(path.resolve(installDir, 'dist/services/styledDialogs.js'));
    }
    
    // Auth error handling helper - delegates to authErrorHandler module
    async function handleError(e, errorPrefix) {
      const path = require('path');
      const installDir = (await j.plugins.installationDir()) || '';
      const dataDir = await j.plugins.dataDir();
      
      const { isAuthError, handleAuthError } = require(path.resolve(installDir, 'dist/services/authErrorHandler.js'));
      
      if (isAuthError(e)) {
        console.log('[gdocs] handleError - detected auth error');
        await handleAuthError(j, e, installDir, dataDir);
      } else {
        // Non-auth error, log to console only (no popup)
        const raw = (e && e.response && e.response.data) || (e && e.message) || e;
        const msg = (typeof raw === 'string') ? raw : JSON.stringify(raw, null, 2);
        console.error('[gdocs]', errorPrefix + ':', msg);
      }
    }

    async function pollOnce() {
      try {
        const path = require('path');
        const dataDir = await j.plugins.dataDir();
        const installDir = (await j.plugins.installationDir()) || '';
        
        // Use SyncContext for authenticated API access (consistent with commands)
        const { createSyncContext } = require(path.resolve(installDir, 'dist/services/SyncContext.js'));
        const ctx = await createSyncContext(installDir, dataDir);
        
        // Create poller with SyncContext
        const pollerPath = path.resolve(installDir, 'dist/poller.js');
        const { MinimalPoller } = require(pollerPath);
        const poller = new MinimalPoller(ctx);
        
        const maybe = await poller.initIfNeeded();
        const dialogs = await getStyledDialogs();
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
        const path = require('path');
        const installDir = (await j.plugins.installationDir()) || '';
        const dataDir = await j.plugins.dataDir();
        const mod = require(path.resolve(installDir, 'dist/commands/createFromNote.js'));
        const res = await mod.createFromNote({ j, installDir, dataDir });
        const dialogs = await getStyledDialogs();
        await dialogs.showSuccessDialog(j, 'Document Created', 'Google Doc created and linked to this note.');
      } catch (e) {
        await handleError(e, 'Create-from-note error');
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
      const { showSuccessDialog, showErrorDialog } = require(path.resolve(installDir, 'dist/services/styledDialogs.js'));
      
      const dId = 'gdocsBindDialog-' + Date.now();
      const d = await j.views.dialogs.create(dId);
      const html = `
        <style>#joplin-plugin-content { width: max-content; }</style>
        <div style="padding: 20px; min-width: 420px; box-sizing: border-box;">
          <div style="text-align: center; margin-bottom: 16px;">
            <span style="font-size: 36px;">🔗</span>
          </div>
          <h2 style="margin: 0 0 16px 0; color: var(--joplin-color); text-align: center;">
            Bind Note to Google Doc
          </h2>
          <form name="f">
            <div style="margin-bottom: 12px;">
              <label style="display: block; margin-bottom: 4px; font-weight: 500; color: var(--joplin-color);">
                File ID (required)
              </label>
              <input 
                type="text" 
                name="fileId" 
                placeholder="Google Drive file ID"
                style="width: 100%; padding: 8px; border: 1px solid var(--joplin-divider-color); border-radius: 4px; background: var(--joplin-background-color); color: var(--joplin-color); box-sizing: border-box;"
              />
            </div>
            <div style="margin-bottom: 12px;">
              <label style="display: block; margin-bottom: 4px; font-weight: 500; color: var(--joplin-color);">
                Tab ID (optional)
              </label>
              <input 
                type="text" 
                name="tabId" 
                placeholder="For multi-tab documents"
                style="width: 100%; padding: 8px; border: 1px solid var(--joplin-divider-color); border-radius: 4px; background: var(--joplin-background-color); color: var(--joplin-color); box-sizing: border-box;"
              />
            </div>
          </form>
          <p style="font-size: 12px; color: var(--joplin-color); margin-top: 12px; opacity: 0.7;">
            Get the File ID from the Google Docs URL: docs.google.com/document/d/<strong>FILE_ID</strong>/edit
          </p>
        </div>
      `;
      await j.views.dialogs.setHtml(d, html);
      await j.views.dialogs.setButtons(d, [
        { id: 'cancel', title: 'Cancel' },
        { id: 'ok', title: 'Bind' },
      ]);
      const r = await j.views.dialogs.open(d);
      if (!r || r.id !== 'ok') return;
      const fd = (r.formData && (r.formData.f || r.formData)) || {};
      const fileId = fd.fileId ? String(fd.fileId).trim() : '';
      const tabId = fd.tabId ? String(fd.tabId).trim() : '';
      if (!fileId) {
        await showErrorDialog(j, 'Missing File ID', 'Please enter a Google Drive file ID.');
        return;
      }
      bindNoteDoer(dataDir, noteId, fileId, tabId || undefined);
      await showSuccessDialog(j, 'Note Bound', 'Note bound to file ID: ' + fileId + (tabId ? (' (tab: ' + tabId + ')') : ''));
    }

    // Unbind - supports single or multiple notes (noteIds from context menu or workspace selection)
    async function unbindNotes(noteIds) {
      const path = require('path');
      const installDir = (await j.plugins.installationDir()) || '';
      const dataDir = await j.plugins.dataDir();
      const dialogs = await getStyledDialogs();
      
      // Get note IDs from parameter or workspace selection
      if (!noteIds || !Array.isArray(noteIds) || !noteIds.length) {
        noteIds = await j.workspace.selectedNoteIds();
      }
      if (!noteIds || !noteIds.length) {
        await dialogs.showWarningDialog(j, 'No Selection', 'Please select a note first.');
        return;
      }

      const { getBinding } = require(path.resolve(installDir, 'dist/mapping.js'));
      const { unbindNoteDoer } = require(path.resolve(installDir, 'dist/commands/unbindNote.js'));

      let unbound = 0, skipped = 0;
      for (const noteId of noteIds) {
        const binding = getBinding(dataDir, noteId);
        if (!binding) {
          skipped++;
          continue;
        }
        unbindNoteDoer(dataDir, noteId);
        unbound++;
      }

      // Show appropriate message based on count
      if (noteIds.length === 1) {
        if (unbound) {
          await dialogs.showSuccessDialog(j, 'Unbound', 'Note unlinked from Google Doc.');
        } else {
          await dialogs.showInfoDialog(j, { title: 'Not Bound', message: 'This note was not linked to any Google Doc.', icon: 'ℹ️' });
        }
      } else {
        const msg = `Unbound: ${unbound} | Skipped: ${skipped}`;
        await dialogs.showSuccessDialog(j, 'Unbind Complete', msg);
      }
    }

    // Pull - supports single or multiple notes (noteIds from context menu or workspace selection)
    async function pullNotes(noteIds) {
      try {
        const path = require('path');
        const installDir = (await j.plugins.installationDir()) || '';
        const dataDir = await j.plugins.dataDir();
        const dialogs = await getStyledDialogs();
        
        // Get note IDs from parameter or workspace selection
        if (!noteIds || !Array.isArray(noteIds) || !noteIds.length) {
          noteIds = await j.workspace.selectedNoteIds();
        }
        if (!noteIds || !noteIds.length) {
          await dialogs.showWarningDialog(j, 'No Selection', 'Please select a note first.');
          return;
        }

        // Enable debug mode if toggled on
        if (converterDebugEnabled) {
          const converter = require(path.resolve(installDir, 'dist/converter/index.js'));
          converter.setDebugMode(true, dataDir);
        }

        const { getBinding } = require(path.resolve(installDir, 'dist/mapping.js'));
        const { pullNote } = require(path.resolve(installDir, 'dist/commands/pullNote.js'));

        // Single note - use original simple flow
        if (noteIds.length === 1) {
          await pullNote({ j, installDir, dataDir, noteId: noteIds[0] });
          await dialogs.showSuccessDialog(j, 'Pull Complete', 'Note updated from Google Doc.');
          return;
        }

        // Multiple notes - batch process with summary
        let pulled = 0, skipped = 0, failed = 0;

        for (const noteId of noteIds) {
          const binding = getBinding(dataDir, noteId);
          if (!binding) {
            skipped++;
            continue;
          }
          try {
            await pullNote({ j, installDir, dataDir, noteId });
            pulled++;
          } catch (e) {
            failed++;
          }
        }

        const msg = `Pulled: ${pulled} | Skipped: ${skipped}` + (failed ? ` | Failed: ${failed}` : '');
        if (failed > 0) {
          await dialogs.showWarningDialog(j, 'Pull Complete', msg);
        } else {
          await dialogs.showSuccessDialog(j, 'Pull Complete', msg);
        }
      } catch (e) {
        await handleError(e, 'Pull error');
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

    // Push - supports single or multiple notes (noteIds from context menu or workspace selection)
    async function pushNotes(noteIds) {
      try {
        const path = require('path');
        const installDir = (await j.plugins.installationDir()) || '';
        const dataDir = await j.plugins.dataDir();
        const dialogs = await getStyledDialogs();
        
        // Get note IDs from parameter or workspace selection
        if (!noteIds || !Array.isArray(noteIds) || !noteIds.length) {
          noteIds = await j.workspace.selectedNoteIds();
        }
        if (!noteIds || !noteIds.length) {
          await dialogs.showWarningDialog(j, 'No Selection', 'Please select a note first.');
          return;
        }
        
        // Enable debug mode if toggled on
        if (converterDebugEnabled) {
          const converter = require(path.resolve(installDir, 'dist/converter/index.js'));
          converter.setDebugMode(true, dataDir);
        }

        const { getBinding } = require(path.resolve(installDir, 'dist/mapping.js'));
        const { pushNote } = require(path.resolve(installDir, 'dist/commands/pushNote.js'));

        // Single note - use original simple flow
        if (noteIds.length === 1) {
          await pushNote({ j, installDir, dataDir, noteId: noteIds[0] });
          await dialogs.showSuccessDialog(j, 'Push Complete', 'Note pushed to Google Doc.');
          return;
        }

        // Multiple notes - batch process with summary
        let pushed = 0, skipped = 0, failed = 0;

        for (const noteId of noteIds) {
          const binding = getBinding(dataDir, noteId);
          if (!binding) {
            skipped++;
            continue;
          }
          try {
            await pushNote({ j, installDir, dataDir, noteId });
            pushed++;
          } catch (e) {
            failed++;
          }
        }

        const msg = `Pushed: ${pushed} | Skipped: ${skipped}` + (failed ? ` | Failed: ${failed}` : '');
        if (failed > 0) {
          await dialogs.showWarningDialog(j, 'Push Complete', msg);
        } else {
          await dialogs.showSuccessDialog(j, 'Push Complete', msg);
        }
      } catch (e) {
        await handleError(e, 'Push error');
      }
    }

    async function openPickerCmd() {
      try {
        const path = require('path');
        const installDir = (await j.plugins.installationDir()) || '';
        const dataDir = await j.plugins.dataDir();
        const mod = require(path.resolve(installDir, 'dist/commands/drivePickerDialog.js'));
        const res = await mod.openDrivePickerDialog({ j, installDir, dataDir });
        if (res.created > 0) {
          const dialogs = await getStyledDialogs();
          await dialogs.showSuccessDialog(j, 'Import Complete', `Imported ${res.created} document${res.created > 1 ? 's' : ''}.`);
        }
      } catch (e) {
        await handleError(e, 'Picker error');
      }
    }

    async function exportNotebookCmd() {
      try {
        const path = require('path');
        const installDir = (await j.plugins.installationDir()) || '';
        const dataDir = await j.plugins.dataDir();
        const dialogs = await getStyledDialogs();
        
        // Check if a folder is selected
        const folder = await j.workspace.selectedFolder();
        if (!folder) {
          await dialogs.showWarningDialog(j, 'No Selection', 'Please select a notebook first.');
          return;
        }
        
        const mod = require(path.resolve(installDir, 'dist/commands/exportNotebook.js'));
        const res = await mod.exportNotebook({ j, installDir, dataDir, folderId: folder.id });
        if (res) {
          await dialogs.showSuccessDialog(j, 'Export Complete', `Exported ${res.noteCount} note${res.noteCount > 1 ? 's' : ''} to Google Drive.`);
        }
      } catch (e) {
        await handleError(e, 'Export notebook error');
      }
    }

    j.plugins.register({
      onStart: async () => {
        console.log('[gdocs] Plugin onStart called');
        
        // Register settings first
        try {
          const path = require('path');
          const installDir = (await j.plugins.installationDir()) || '';
          const { registerSettings } = require(path.resolve(installDir, 'dist/services/settings.js'));
          await registerSettings(j);
          console.log('[gdocs] Registered plugin settings');
        } catch (e) {
          console.warn('[gdocs] Failed to register settings:', e);
        }
        
        // Commands with numbered labels for alphabetical sorting in command palette
        // 01-02: Most common sync operations (support single and multiple notes)
        await j.commands.register({ name: 'gdocsPushNow', label: 'Google Docs Sync: 01 Push', execute: async (noteIds) => { await pushNotes(noteIds); } });
        await j.commands.register({ name: 'gdocsPullNow', label: 'Google Docs Sync: 02 Pull', execute: async (noteIds) => { await pullNotes(noteIds); } });
        await j.commands.register({ name: 'gdocsPollOnce', label: 'Google Docs Sync: 03 Poll Once', execute: async () => { await pollOnce(); } });
        
        // 04-06: Document creation and management
        await j.commands.register({ name: 'gdocsCreateFromNote', label: 'Google Docs Sync: 04 Export Note into Doc', execute: async () => { await createFromNoteCmd(); } });
        await j.commands.register({ name: 'gdocsExportNotebook', label: 'Google Docs Sync: 05 Export Notebook into Docs', execute: async () => { await exportNotebookCmd(); } });
        await j.commands.register({ name: 'gdocsPicker', label: 'Google Docs Sync: 06 Import Doc into Note', execute: async () => { await openPickerCmd(); } });
        
        // 07-08: Manual binding (less common, 07 supports multiple notes)
        await j.commands.register({ name: 'gdocsUnbind', label: 'Google Docs Sync: 07 Unbind Note from Doc', execute: async (noteIds) => { await unbindNotes(noteIds); } });
        await j.commands.register({ name: 'gdocsBind', label: 'Google Docs Sync: 08 Bind Note to Doc', execute: async () => { await bindCurrentNote(); } });
        
        // 09: Setup Wizard
        await j.commands.register({
          name: 'gdocsSetupWizard',
          label: 'Google Docs Sync: 09 Setup Wizard',
          execute: async () => {
            try {
              const path = require('path');
              const installDir = (await j.plugins.installationDir()) || '';
              const dataDir = await j.plugins.dataDir();
              const { runSetupWizard } = require(path.resolve(installDir, 'dist/commands/setupWizard.js'));
              const result = await runSetupWizard({ j, installDir, dataDir });
              // Setup wizard shows its own completion dialog, no need to show another
            } catch (e) {
              await handleError(e, 'Setup wizard error');
            }
          }
        });
        
        // 10: Authorization (fallback)
        await j.commands.register({
          name: 'gdocsAuthorize',
          label: 'Google Docs Sync: 10 Authorize',
          execute: async () => {
            try {
              const path = require('path');
              const installDir = (await j.plugins.installationDir()) || '';
              const dataDir = await j.plugins.dataDir();
              const { authorize } = require(path.resolve(installDir, 'dist/commands/authorize.js'));
              const { showSuccessDialog, showErrorDialog } = require(path.resolve(installDir, 'dist/services/styledDialogs.js'));
              const result = await authorize({ j, installDir, dataDir });
              if (result.success) {
                await showSuccessDialog(j, 'Authorization Complete', result.message);
              } else {
                await showErrorDialog(j, 'Authorization Failed', result.message);
              }
            } catch (e) {
              await handleError(e, 'Authorization error');
            }
          }
        });
        
        // 11: Debugging
        await j.commands.register({ name: 'gdocsToggleDebug', label: 'Google Docs Sync: 11 Toggle Debug', execute: async () => { await toggleConverterDebug(); } });
        
        // Check if setup is needed on startup and show prompt
        try {
          const path = require('path');
          const installDir = (await j.plugins.installationDir()) || '';
          const { isSetupNeeded } = require(path.resolve(installDir, 'dist/commands/setupWizard.js'));
          if (isSetupNeeded(installDir)) {
            // Don't auto-launch, just log - user can run wizard manually
            console.log('[gdocs] Setup needed - run "Setup Wizard" command to configure');
          }
        } catch (e) {
          console.warn('[gdocs] Could not check setup status:', e);
        }
        
        // Add notebook export to folder context menu
        await j.views.menuItems.create('notebookExportMenu', 'gdocsExportNotebook', 'folderContextMenu');
        
        // Add push/pull/unbind to note list context menu (also appears in multi-selection panel)
        // Uses the same commands as command palette - they support single and multiple notes
        await j.views.menuItems.create('gdocsPushMenuItem', 'gdocsPushNow', 'noteListContextMenu');
        await j.views.menuItems.create('gdocsPullMenuItem', 'gdocsPullNow', 'noteListContextMenu');
        await j.views.menuItems.create('gdocsUnbindMenuItem', 'gdocsUnbind', 'noteListContextMenu');
        
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
        
        // Background poller with configurable interval
        let pollIntervalId = null;
        
        async function startBackgroundPoller() {
          try {
            const path = require('path');
            const installDir = (await j.plugins.installationDir()) || '';
            const dataDir = await j.plugins.dataDir();
            const { getSettings } = require(path.resolve(installDir, 'dist/services/settings.js'));
            const { hasValidTokens } = require(path.resolve(installDir, 'dist/services/oauthServer.js'));
            
            const settings = await getSettings(j);
            
            // Clear existing interval if any
            if (pollIntervalId) {
              clearInterval(pollIntervalId);
              pollIntervalId = null;
            }
            
            // Check if auto sync is enabled and tokens exist
            if (!settings.autoSyncEnabled) {
              console.log('[gdocs] Auto sync is disabled');
              return;
            }
            
            if (!hasValidTokens(installDir)) {
              console.log('[gdocs] No valid tokens, skipping auto sync');
              return;
            }
            
            const intervalMs = (settings.pollIntervalMinutes || 5) * 60 * 1000;
            if (intervalMs <= 0) {
              console.log('[gdocs] Poll interval is 0, auto sync disabled');
              return;
            }
            
            console.log('[gdocs] Starting background poller with interval:', settings.pollIntervalMinutes, 'minutes');
            
            // Run poller function
            async function runPoller() {
              try {
                console.log('[gdocs] Background sync running...');
                const { createSyncContext } = require(path.resolve(installDir, 'dist/services/SyncContext.js'));
                const { MinimalPoller } = require(path.resolve(installDir, 'dist/poller.js'));
                
                const ctx = await createSyncContext(installDir, dataDir);
                const poller = new MinimalPoller(ctx);
                await poller.initIfNeeded();
                const syncRes = await poller.syncOnce(j);
                console.log('[gdocs] Background sync complete. Matched:', syncRes.matched, 'Updated:', syncRes.updated);
                
                // Show notification if there were updates
                if (syncRes.updated > 0) {
                  // Using console for now - could use Joplin notifications API if available
                  console.log('[gdocs] Synced', syncRes.updated, 'items');
                }
              } catch (e) {
                console.error('[gdocs] Background sync error:', e);
              }
            }
            
            // Start interval
            pollIntervalId = setInterval(runPoller, intervalMs);
            
            // Run immediately on start
            setTimeout(runPoller, 5000); // Wait 5 seconds after startup
            
          } catch (e) {
            console.error('[gdocs] Failed to start background poller:', e);
          }
        }
        
        // Start the poller
        await startBackgroundPoller();
        
        // Listen for settings changes to restart poller
        try {
          await j.settings.onChange(async (event) => {
            // Check if any of our sync settings changed
            const relevantKeys = ['pollIntervalMinutes', 'autoSyncEnabled'];
            const changed = Object.keys(event.keys || {}).some(k => 
              relevantKeys.some(rk => k.endsWith(rk))
            );
            if (changed) {
              console.log('[gdocs] Sync settings changed, restarting poller');
              await startBackgroundPoller();
            }
          });
        } catch (e) {
          console.warn('[gdocs] Could not register settings change listener:', e);
        }
      },
    });
  } catch (_) { /* ignore */ }
})();


