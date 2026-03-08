/**
 * drivePickerDialog - Open a dialog to pick and import Google Docs
 * 
 * Uses SyncContext for authenticated API access.
 */

import { createSyncContext } from '../services/syncContext';
import { bindNote } from '../mapping';
import { buildConversionDocFromTabs } from '../structure';
import { convertDocumentToMarkdown } from '../converters';
import { createNote, determineTargetFolder } from '../services/noteOperations';
import { showWarningDialog, showSuccessDialog } from '../services/styledDialogs';

type Params = { j: any; installDir: string; dataDir: string };

export async function openDrivePickerDialog(params: Params): Promise<{ selected: string[]; created: number; bound: number }>{
  const { j, installDir, dataDir } = params;
  
  // Use SyncContext for authenticated API access
  const ctx = await createSyncContext(installDir, dataDir, j);
  const { drive } = ctx;

  async function listDocs(query: string): Promise<Array<{ id?: string; name?: string; modifiedTime?: string }>> {
    const esc = (query || '').replace(/'/g, "\\'");
    const qParts = ["mimeType='application/vnd.google-apps.document'", 'trashed=false'];
    if (esc) qParts.push(`name contains '${esc}'`);
    const { data } = await drive.files.list({
      q: qParts.join(' and '),
      fields: 'files(id,name,modifiedTime)',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      pageSize: 20, // Show more results
      spaces: 'drive',
      orderBy: 'modifiedTime desc',
    });
    return (data.files || []) as Array<{ id?: string; name?: string; modifiedTime?: string }>;
  }

  let search = '';
  let selectedIds: string[] = [];
  let files = await listDocs(search);
  const dId = 'gdocsDrivePicker-' + Date.now();
  const d = await j.views.dialogs.create(dId);
  
  // setFitToContent is not in the stable API types but available at runtime
  const dialogs = j.views.dialogs as { setFitToContent?: (id: string, fit: boolean) => Promise<void> };
  await dialogs.setFitToContent?.(d, false);

  while (true) {
    // Format the modified time nicely
    const formatDate = (dateStr?: string) => {
      if (!dateStr) return '';
      const date = new Date(dateStr);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    // Generate rows for display (show more results)
    const displayFiles = files.slice(0, 10); // Show up to 10 results
    const rows = displayFiles.map(f => {
      const id = (f.id || '').replace(/\"/g, '');
      const checked = selectedIds.includes(id) ? ' checked' : '';
      const name = (f.name || '').replace(/</g, '&lt;');
      return `<tr>
        <td style="padding:8px 12px; text-align:center; vertical-align:middle;">
          <input type="checkbox" name="fid" value="${id}"${checked} style="width:16px; height:16px;" />
        </td>
        <td style="padding:8px 12px; word-break:break-word; max-width:400px;">${name}</td>
        <td style="padding:8px 12px; white-space:nowrap; color:var(--joplin-color-faded);">${formatDate(f.modifiedTime)}</td>
      </tr>`;
    }).join('');

    // Note: Joplin dialogs limitations:
    // - No dynamic content updates without closing/reopening
    // - Enter key submits the first button in the list
    // - Limited CSS support, but CSS variables from theme are available
    const dialogHtml = `
      <div style="padding:0; width:100%; height:100%; display:flex; align-items:center; justify-content:center;">
        <div style="padding:20px; width:90%; max-width:900px;">
          <form name="f" style="margin:0;" onsubmit="return false;">
            <h2 style="margin:0 0 20px 0; font-size:20px; color:var(--joplin-color);">Import Google Docs</h2>
          
          <div style="margin-bottom:16px;">
            <label style="display:block; margin-bottom:6px; font-weight:500; color:var(--joplin-color);">Search Documents</label>
            <input 
              type="text" 
              name="q" 
              value="${search.replace(/"/g,'&quot;')}" 
              placeholder="Type to search Google Docs..."
              style="width:100%; padding:8px 12px; font-size:14px; border:1px solid var(--joplin-divider-color); border-radius:4px; background:var(--joplin-background-color); color:var(--joplin-color); box-sizing:border-box;" 
            />
            <div style="margin-top:6px; color:var(--joplin-color-faded); font-size:13px;">
              Press Enter to search
            </div>
          </div>

          <div style="margin-bottom:16px; border:1px solid var(--joplin-divider-color); border-radius:4px; background:var(--joplin-background-color);">
            <div style="max-height:50vh; overflow-y:auto; overflow-x:hidden;">
              <table style="width:100%; border-collapse:collapse;">
                <thead>
                  <tr style="background:var(--joplin-background-color3); border-bottom:1px solid var(--joplin-divider-color);">
                    <th style="padding:8px 12px; text-align:center; width:50px; font-weight:500; color:var(--joplin-color);">Select</th>
                    <th style="padding:8px 12px; text-align:left; font-weight:500; color:var(--joplin-color);">Document Name</th>
                    <th style="padding:8px 12px; text-align:left; width:180px; font-weight:500; color:var(--joplin-color);">Last Modified</th>
                  </tr>
                </thead>
                <tbody style="color:var(--joplin-color);">
                  ${rows || '<tr><td colspan="3" style="padding:20px; text-align:center; color:var(--joplin-color-faded);">No documents found</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>

          ${selectedIds.length > 0 ? `
            <div style="margin-bottom:12px; padding:10px; background:var(--joplin-background-color-hover3); border-radius:4px; color:var(--joplin-color);">
              <strong>${selectedIds.length}</strong> document${selectedIds.length > 1 ? 's' : ''} selected
            </div>
          ` : ''}

          <div style="padding:10px; background:var(--joplin-background-color3); border-radius:4px; margin-bottom:0;">
            <p style="margin:0; line-height:1.3; font-size:12px; color:var(--joplin-color);">
              <strong>How it works:</strong> Select documents and click <strong>Import</strong> to create new Joplin notes. 
              Documents already linked will be skipped.
            </p>
          </div>
          </form>
        </div>
      </div>
    `;
    
    await j.views.dialogs.setHtml(d, dialogHtml);
    
    // Joplin limitation: buttons are static, can't be dynamically updated
    // Use 'ok' as the search button ID to make it a submit button that Enter will trigger
    await j.views.dialogs.setButtons(d, [
      { id: 'ok', title: 'Search' },
      { id: 'import', title: 'Import Selected' },
      { id: 'cancel' }
    ]);
    
    const r = await j.views.dialogs.open(d);
    
    if (!r || r.id === 'cancel') {
      return { selected: [], created: 0, bound: 0 };
    }
    
    const fd = (r.formData && (r.formData.f || r.formData)) || {};
    const nextQ = (fd.q ? String(fd.q) : '').trim();
    
    // Get currently selected items
    const getSel = (): string[] => {
      if (Array.isArray(fd.fid)) return fd.fid.map((x: any) => String(x));
      if (fd.fid) return [String(fd.fid)];
      return [];
    };
    
    selectedIds = getSel();
    
    // Handle search button (or Enter key) - 'ok' is a submit button that Enter triggers
    if (r.id === 'ok') {
      search = nextQ;
      files = await listDocs(search);
      continue;
    }
    
    // Handle import button
    if (r.id === 'import') {
      if (selectedIds.length === 0) {
        await showWarningDialog(j, 'No Selection', 'Please select at least one document to import.');
        continue;
      }
      break; // Exit loop to proceed with import
    }
  }

  // Import selected files
  const fids = selectedIds;
  let created = 0;
  let bound = 0;
  
  if (fids.length) {
    // Determine target folder (current notebook or fallback)
    const targetFolderId = await determineTargetFolder(j);
    
    // Build inverse map fileId -> noteId from existing mapping
    const mapping = (await import('../mapping')).loadMapping(dataDir);
    const fileIdToNoteId: Record<string, string> = {};
    for (const [nid, b] of Object.entries(mapping.notes || {})) {
      if (b?.fileId) fileIdToNoteId[b.fileId] = nid;
    }
    
    const skipped: string[] = [];
    const imported: string[] = [];
    
    for (const fid of fids) {
      if (fileIdToNoteId[fid]) {
        try {
          const ex = await j.data.get(['notes', fileIdToNoteId[fid]], { fields: ['id', 'title'] });
          skipped.push(`"${ex.title || 'Untitled'}" (already linked)`);
        } catch (_) {
          skipped.push(`Document ${fid} (already linked)`);
        }
        continue;
      }
      
      const meta = files.find(f => f.id === fid);
      const title = (meta?.name && String(meta.name)) || 'Imported Document';
      
      try {
        const { convertDoc } = await buildConversionDocFromTabs(ctx.docs, fid, { tabId: undefined });
        const md = convertDocumentToMarkdown(convertDoc, { installDir });
        const newNote = await createNote(j, title, md, targetFolderId);
        bindNote(dataDir, newNote.id, { fileId: fid });
        
        try { 
          await ctx.provider.updateAppProperties(fid, { joplinNoteId: newNote.id }); 
        } catch (_) {
          // Ignore appProperties errors (likely due to permissions)
        }
        
        created += 1;
        bound += 1;
        imported.push(title);
      } catch (err) {
        skipped.push(`"${title}" (import error)`);
        console.error(`Failed to import ${fid}:`, err);
      }
    }
    
    // Show summary
    const msg = `Imported: ${imported.length} | Skipped: ${skipped.length}`;
    if (skipped.length > 0) {
      await showWarningDialog(j, 'Import Complete', msg);
    } else if (imported.length > 0) {
      await showSuccessDialog(j, 'Import Complete', msg);
    }
  }
  
  return { selected: fids, created, bound };
}
