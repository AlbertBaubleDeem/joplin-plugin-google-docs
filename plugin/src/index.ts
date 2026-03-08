import joplin from 'api';
import { MenuItemLocation } from 'api/types';

// Note list renderer
import { createSyncStatusRenderer } from './noteListRenderer';

// Static imports - replacing dynamic resolveMod() calls
import { createSyncContext } from './services/syncContext';
import { MinimalPoller } from './poller';
import { showErrorDialog, showInfoDialog, showSuccessDialog, showWarningDialog } from './services/styledDialogs';
import { isAuthError, handleAuthError } from './services/authErrorHandler';
import { batchPush, batchPull, batchUnbind } from './services/batchOperations';
import { createFromNote } from './commands/createFromNote';
import { bindCurrentNote } from './commands/bindNote';
import { isDebugEnabled, toggleConverterDebug } from './commands/toggleDebug';
import { openDrivePickerDialog } from './commands/drivePickerDialog';
import { exportNotebook } from './commands/exportNotebook';
import { runSetupWizard, isSetupNeeded } from './commands/setupWizard';
import { authorize } from './commands/authorize';
import { registerSettings } from './services/settings';
import { startBackgroundPoller, registerPollerSettingsListener } from './services/backgroundPoller';
import { setInstallDir, setDataDir } from './converters/config';

// Get plugin directories
let _installDir: string = '';
let _dataDir: string = '';

async function getDirs(): Promise<{ installDir: string; dataDir: string }> {
  if (!_installDir) {
    _installDir = (await joplin.plugins.installationDir()) || '';
    setInstallDir(_installDir);
  }
  if (!_dataDir) {
    _dataDir = (await joplin.plugins.dataDir()) || '';
    setDataDir(_dataDir);
  }
  return { installDir: _installDir, dataDir: _dataDir };
}

// Auth error handling helper
async function handleError(e: unknown, errorPrefix: string): Promise<void> {
  const { installDir, dataDir } = await getDirs();
  
  if (isAuthError(e)) {
    await handleAuthError(joplin, e, installDir, dataDir);
  } else {
    const err = e as { response?: { data?: unknown }; message?: string };
    const raw = err?.response?.data || err?.message || e;
    let msg = (typeof raw === 'string') ? raw : JSON.stringify(raw, null, 2);
    
    // Check for API compatibility issues (outdated Joplin)
    if (msg.includes('does not exist in "joplin.')) {
      msg += '\n\nThis may be caused by an outdated Joplin version. Please update Joplin to the latest version.';
    }
    
    console.error('[gdocs]', errorPrefix + ':', msg);
    // Show error dialog so user sees the failure
    await showErrorDialog(joplin, errorPrefix, msg);
  }
}

async function pollOnce(): Promise<void> {
  try {
    const { installDir, dataDir } = await getDirs();
    const ctx = await createSyncContext(installDir, dataDir, joplin);
    const poller = new MinimalPoller(ctx);
    
    const maybe = await poller.initIfNeeded();
    if (maybe === null) {
      await showInfoDialog(joplin, { 
        title: 'Sync Initialized', 
        message: 'Drive sync has been initialized. Run Poll Once again to sync.', 
        icon: '🔄' 
      });
      return;
    }
    
    const syncRes = await poller.syncOnce(joplin);
    await showSuccessDialog(joplin, 'Poll Complete', `Matched: ${syncRes.matched} | Updated: ${syncRes.updated}`);
  } catch (e) {
    await handleError(e, 'Poll error');
  }
}

async function createFromNoteCmd(): Promise<void> {
  try {
    const { installDir, dataDir } = await getDirs();
    await createFromNote({ j: joplin, installDir, dataDir });
    await showSuccessDialog(joplin, 'Document Created', 'Google Doc created and linked to this note.');
  } catch (e) {
    await handleError(e, 'Create-from-note error');
  }
}

async function bindCurrentNoteCmd(): Promise<void> {
  try {
    const { dataDir } = await getDirs();
    await bindCurrentNote({ j: joplin, dataDir });
  } catch (e) {
    await handleError(e, 'Bind error');
  }
}

async function unbindNotesCmd(noteIds?: string[]): Promise<void> {
  try {
    const { installDir, dataDir } = await getDirs();
    await batchUnbind({ j: joplin, installDir, dataDir, noteIds });
  } catch (e) {
    await handleError(e, 'Unbind error');
  }
}

async function pullNotesCmd(noteIds?: string[]): Promise<void> {
  try {
    const { installDir, dataDir } = await getDirs();
    await batchPull({ j: joplin, installDir, dataDir, noteIds, debugEnabled: isDebugEnabled() });
  } catch (e) {
    await handleError(e, 'Pull error');
  }
}

async function pushNotesCmd(noteIds?: string[]): Promise<void> {
  try {
    const { installDir, dataDir } = await getDirs();
    await batchPush({ j: joplin, installDir, dataDir, noteIds, debugEnabled: isDebugEnabled() });
  } catch (e) {
    await handleError(e, 'Push error');
  }
}

async function toggleDebugCmd(): Promise<void> {
  try {
    const { dataDir } = await getDirs();
    await toggleConverterDebug({ j: joplin, dataDir });
  } catch (e) {
    await handleError(e, 'Toggle debug error');
  }
}

async function openPickerCmd(): Promise<void> {
  try {
    const { installDir, dataDir } = await getDirs();
    const res = await openDrivePickerDialog({ j: joplin, installDir, dataDir });
    if (res.created > 0) {
      await showSuccessDialog(joplin, 'Import Complete', `Imported ${res.created} document${res.created > 1 ? 's' : ''}.`);
    }
  } catch (e) {
    await handleError(e, 'Picker error');
  }
}

async function exportNotebookCmd(): Promise<void> {
  try {
    const { installDir, dataDir } = await getDirs();
    
    const folder = await joplin.workspace.selectedFolder();
    if (!folder) {
      await showWarningDialog(joplin, 'No Selection', 'Please select a notebook first.');
      return;
    }
    
    const res = await exportNotebook({ j: joplin, installDir, dataDir, folderId: folder.id });
    if (res) {
      await showSuccessDialog(joplin, 'Export Complete', `Exported ${res.noteCount} note${res.noteCount > 1 ? 's' : ''} to Google Drive.`);
    }
  } catch (e) {
    await handleError(e, 'Export notebook error');
  }
}

async function setupWizardCmd(): Promise<void> {
  try {
    const { installDir, dataDir } = await getDirs();
    await runSetupWizard({ j: joplin, installDir, dataDir });
  } catch (e) {
    await handleError(e, 'Setup wizard error');
  }
}

async function authorizeCmd(): Promise<void> {
  try {
    const { installDir, dataDir } = await getDirs();
    const result = await authorize({ j: joplin, installDir, dataDir });
    if (result.success) {
      await showSuccessDialog(joplin, 'Authorization Complete', result.message);
    } else {
      await showErrorDialog(joplin, 'Authorization Failed', result.message);
    }
  } catch (e) {
    await handleError(e, 'Authorization error');
  }
}

joplin.plugins.register({
  onStart: async function() {
    const { installDir, dataDir } = await getDirs();
    
    // Register settings
    try {
      await registerSettings(joplin);
    } catch (e) {
      console.warn('[gdocs] Failed to register settings:', e);
    }
    
    // Register note list renderer for sync status icons (only if enabled in settings)
    const rendererId = 'io.github.albertbaubledeem.joplin.google-docs:gdocs-sync-renderer';
    try {
      const enableSyncIcons = await joplin.settings.value('enableSyncIcons');
      
      if (enableSyncIcons) {
        const renderer = createSyncStatusRenderer(dataDir);
        await joplin.views.noteList.registerRenderer(renderer);
      }
    } catch (e) {
      console.warn('[gdocs] Failed to register note list renderer:', e);
    }
    
    // Commands with numbered labels for alphabetical sorting
    await joplin.commands.register({ name: 'gdocsPushNow', label: 'Google Docs Sync: 01 Push', execute: pushNotesCmd });
    await joplin.commands.register({ name: 'gdocsPullNow', label: 'Google Docs Sync: 02 Pull', execute: pullNotesCmd });
    await joplin.commands.register({ name: 'gdocsPollOnce', label: 'Google Docs Sync: 03 Poll Once', execute: pollOnce });
    await joplin.commands.register({ name: 'gdocsCreateFromNote', label: 'Google Docs Sync: 04 Export Note into Doc', execute: createFromNoteCmd });
    await joplin.commands.register({ name: 'gdocsExportNotebook', label: 'Google Docs Sync: 05 Export Notebook into Docs', execute: exportNotebookCmd });
    await joplin.commands.register({ name: 'gdocsPicker', label: 'Google Docs Sync: 06 Import Doc into Note', execute: openPickerCmd });
    await joplin.commands.register({ name: 'gdocsUnbind', label: 'Google Docs Sync: 07 Unbind Note from Doc', execute: unbindNotesCmd });
    await joplin.commands.register({ name: 'gdocsBind', label: 'Google Docs Sync: 08 Bind Note to Doc', execute: bindCurrentNoteCmd });
    await joplin.commands.register({ name: 'gdocsSetupWizard', label: 'Google Docs Sync: 09 Setup Wizard', execute: setupWizardCmd });
    await joplin.commands.register({ name: 'gdocsAuthorize', label: 'Google Docs Sync: 10 Authorize', execute: authorizeCmd });
    await joplin.commands.register({ name: 'gdocsToggleDebug', label: 'Google Docs Sync: 11 Toggle Debug', execute: toggleDebugCmd });
    
    // Auto-run setup wizard on first install
    try {
      const wizardCompleted = await joplin.settings.value('wizardCompleted');
      if (!wizardCompleted && isSetupNeeded(installDir)) {
        const result = await runSetupWizard({ j: joplin, installDir, dataDir });
        if (result.completed) {
          // Mark wizard as completed so it won't run again
          await joplin.settings.setValue('wizardCompleted', true);
        }
      }
    } catch (e) {
      console.warn('[gdocs] Could not check/run setup wizard:', e);
    }
    
    // Context menus
    await joplin.views.menuItems.create('notebookExportMenu', 'gdocsExportNotebook', MenuItemLocation.FolderContextMenu);
    await joplin.views.menuItems.create('gdocsPushMenuItem', 'gdocsPushNow', MenuItemLocation.NoteListContextMenu);
    await joplin.views.menuItems.create('gdocsPullMenuItem', 'gdocsPullNow', MenuItemLocation.NoteListContextMenu);
    await joplin.views.menuItems.create('gdocsUnbindMenuItem', 'gdocsUnbind', MenuItemLocation.NoteListContextMenu);
    
    // Background poller
    try {
      const pollerConfig = { j: joplin, installDir, dataDir };
      await startBackgroundPoller(pollerConfig);
      await registerPollerSettingsListener(pollerConfig);
    } catch (e) {
      console.warn('[gdocs] Failed to start background poller:', e);
    }
  },
});
