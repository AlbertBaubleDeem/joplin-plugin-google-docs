import { bindNote as bindMappingNote } from '../mapping';
import { showSuccessDialog, showErrorDialog } from '../services/styledDialogs';
import { getSelectedNoteId } from '../services/NoteOperations';

type JoplinApi = any;

/**
 * Low-level bind function - just updates the mapping.
 */
export function bindNoteDoer(dataDir: string, noteId: string, fileId: string, tabId?: string): void {
  bindMappingNote(dataDir, noteId, { fileId, tabId });
}

interface BindParams {
  j: JoplinApi;
  dataDir: string;
}

/**
 * Shows a dialog to bind the current note to a Google Doc by file ID.
 */
export async function bindCurrentNote(params: BindParams): Promise<boolean> {
  const { j, dataDir } = params;

  const noteId = await getSelectedNoteId(j);
  if (!noteId) return false;

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
  if (!r || r.id !== 'ok') return false;

  const fd = (r.formData && (r.formData.f || r.formData)) || {};
  const fileId = fd.fileId ? String(fd.fileId).trim() : '';
  const tabId = fd.tabId ? String(fd.tabId).trim() : '';

  if (!fileId) {
    await showErrorDialog(j, 'Missing File ID', 'Please enter a Google Drive file ID.');
    return false;
  }

  bindNoteDoer(dataDir, noteId, fileId, tabId || undefined);
  await showSuccessDialog(j, 'Note Bound', 'Note bound to file ID: ' + fileId + (tabId ? (' (tab: ' + tabId + ')') : ''));
  return true;
}
