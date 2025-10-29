import { loadMapping } from '../mapping';
import { buildConversionDocFromTabs } from '../structure';
import { convertDocumentToMarkdown } from '../converter';
import { getAuthFromInstallDir } from '../services/auth';

type Params = {
  j: any;
  installDir: string;
  dataDir: string;
  noteId?: string;
};

export async function pullNote(params: Params): Promise<{ noteId: string; tabCount: number; usedTabTitle: string }>{
  const { j, installDir, dataDir } = params;

  const { google, auth } = await getAuthFromInstallDir(installDir);
  const docs = google.docs({ version: 'v1', auth });

  let nid: string;
  if (params.noteId && typeof params.noteId === 'string') {
    nid = params.noteId;
  } else {
    const selected = await j.workspace.selectedNoteIds();
    if (!selected || !selected.length) throw new Error('No selected note.');
    nid = String(selected[0]);
  }

  const mapping = loadMapping(dataDir);
  const binding = mapping.notes[nid];
  if (!binding?.fileId) throw new Error('Note is not bound.');

  const sel = await buildConversionDocFromTabs(docs, binding.fileId, { tabId: binding.tabId });
  const convertDoc = (sel as any).convertDoc;
  const tabCount = (sel as any).tabCount || 0;
  const usedTabTitle = (sel as any).usedTabTitle || '';
  const md = convertDocumentToMarkdown(convertDoc, { installDir });
  await j.data.put(['notes', nid], null, { body: md });
  return { noteId: nid, tabCount, usedTabTitle };
}


