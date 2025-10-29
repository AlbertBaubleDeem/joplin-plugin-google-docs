import type { DriveLike, NoteBinding } from '../mapping';
import {
  loadMapping,
  saveMapping,
  getBinding,
  setDriveAppProperties,
} from '../mapping';
import { convertMarkdownToPlainAndStyles, buildDocsStyleUpdateRequests, loadMdMappingConfig } from '../converter';
import { getAuthFromInstallDir } from '../services/auth';

type Params = {
  j: any;
  installDir: string;
  dataDir: string;
};

export async function pushNote(params: Params): Promise<{
  noteId: string;
  fileId: string;
  newRevisionId: string;
}> {
  const { j, dataDir } = params;
  const { google, auth } = await getAuthFromInstallDir(params.installDir);
  const docs = google.docs({ version: 'v1', auth });
  const drive = google.drive({ version: 'v3', auth });

  const selected = await j.workspace.selectedNoteIds();
  if (!selected || !selected.length) throw new Error('No selected note.');
  const noteId = selected[0];

  const binding = getBinding(dataDir, noteId);
  if (!binding?.fileId) throw new Error('Note is not bound to a Google Doc.');
  const fileId = binding.fileId;

  // Read note body (Markdown)
  const note = await j.data.get(['notes', noteId], { fields: ['id', 'title', 'body'] });
  const mdRaw: string = String(note.body ?? '');
  const { plain, paraRanges, textRanges } = convertMarkdownToPlainAndStyles(mdRaw, { installDir: params.installDir });
  const mappingCfg = loadMdMappingConfig(params.installDir);
  (global as any).__gdocsMappingMonoFont = mappingCfg?.code?.monoFont || 'Roboto Mono';

  // Get current doc state to obtain revisionId and endIndex
  const docRes = await docs.documents.get({ documentId: fileId });
  const revisionId: string = String((docRes.data as any).revisionId || '');
  const body = (docRes.data as any).body || {};
  const content = Array.isArray(body.content) ? body.content : [];
  const endIndex = content.length ? Number(content[content.length - 1].endIndex || 1) : 1;

  const requests: any[] = [];
  // Avoid empty delete range (start==end). For empty docs endIndex is often 2.
  if (endIndex > 2) {
    requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } });
  }
  requests.push({ insertText: { location: { index: 1 }, text: plain } });

  // Push with optimistic concurrency
  await docs.documents.batchUpdate({
    documentId: fileId,
    requestBody: {
      requests,
      writeControl: revisionId ? { requiredRevisionId: revisionId } : undefined,
    },
  });

  // Read new revisionId
  const afterRes = await docs.documents.get({ documentId: fileId });
  const newRevisionId: string = String((afterRes.data as any).revisionId || '');

  // Apply paragraph and inline styles using converter heuristics
  const styleReqs = buildDocsStyleUpdateRequests(paraRanges, textRanges, { monoFont: mappingCfg?.code?.monoFont || 'Roboto Mono' });
  if (styleReqs.length) {
    await docs.documents.batchUpdate({ documentId: fileId, requestBody: { requests: styleReqs } });
  }

  // Update local mapping
  const mapping = loadMapping(dataDir);
  const nb: NoteBinding = mapping.notes[noteId] || {};
  nb.fileId = fileId;
  nb.lastKnownRevisionId = newRevisionId;
  nb.lastSyncTs = Date.now();
  mapping.notes[noteId] = nb;
  saveMapping(dataDir, mapping);

  // Update Drive appProperties (best-effort)
  try {
    await setDriveAppProperties(drive as unknown as DriveLike, fileId, {
      lastKnownRevisionId: newRevisionId,
      lastSyncTs: new Date().toISOString(),
    });
  } catch (_) {
    // ignore if insufficient permissions (e.g., not app-owned under drive.file)
  }

  return { noteId, fileId, newRevisionId };
}

export async function pushNoteById(params: Params & { noteId: string }): Promise<{
  noteId: string;
  fileId: string;
  newRevisionId: string;
}> {
  const { j, dataDir, noteId } = params;
  const { google, auth } = await getAuthFromInstallDir(params.installDir);
  const docs = google.docs({ version: 'v1', auth });
  const drive = google.drive({ version: 'v3', auth });

  const binding = getBinding(dataDir, noteId);
  if (!binding?.fileId) throw new Error('Note is not bound to a Google Doc.');
  const fileId = binding.fileId;

  const note = await j.data.get(['notes', noteId], { fields: ['id', 'title', 'body'] });
  const mdRaw: string = String(note.body ?? '');
  const { plain, paraRanges, textRanges } = convertMarkdownToPlainAndStyles(mdRaw, { installDir: params.installDir });
  const docRes = await docs.documents.get({ documentId: fileId });
  const revisionId: string = String((docRes.data as any).revisionId || '');
  const body = (docRes.data as any).body || {};
  const content = Array.isArray(body.content) ? body.content : [];
  const endIndex = content.length ? Number(content[content.length - 1].endIndex || 1) : 1;

  const requests: any[] = [];
  if (endIndex > 2) {
    requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } });
  }
  requests.push({ insertText: { location: { index: 1 }, text: plain } });

  await docs.documents.batchUpdate({
    documentId: fileId,
    requestBody: { requests, writeControl: revisionId ? { requiredRevisionId: revisionId } : undefined },
  });

  const afterRes = await docs.documents.get({ documentId: fileId });
  const newRevisionId: string = String((afterRes.data as any).revisionId || '');

  const mappingCfg = loadMdMappingConfig(params.installDir);
  const styleReqs = buildDocsStyleUpdateRequests(paraRanges, textRanges, { monoFont: mappingCfg?.code?.monoFont || 'Roboto Mono' });
  if (styleReqs.length) {
    await docs.documents.batchUpdate({ documentId: fileId, requestBody: { requests: styleReqs } });
  }

  const mapping = loadMapping(dataDir);
  const nb: NoteBinding = mapping.notes[noteId] || {};
  nb.fileId = fileId;
  nb.lastKnownRevisionId = newRevisionId;
  nb.lastSyncTs = Date.now();
  mapping.notes[noteId] = nb;
  saveMapping(dataDir, mapping);

  try {
    await setDriveAppProperties(drive as unknown as DriveLike, fileId, {
      lastKnownRevisionId: newRevisionId,
      lastSyncTs: new Date().toISOString(),
    });
  } catch (_) {}

  return { noteId, fileId, newRevisionId };
}


