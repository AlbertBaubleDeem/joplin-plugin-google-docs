import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { buildConversionDocFromTabs } from './structure';
import { convertDocumentToMarkdown } from './converter';
import { loadMapping as loadPluginMapping, saveMapping as savePluginMapping } from './mapping';
import { pushNoteById } from './commands/pushNote';

type Mapping = {
  notes: Record<string, { fileId?: string; tabId?: string; lastKnownRevisionId?: string }>;
  notebooks: Record<string, { fileId?: string }>;
};

function loadJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export class MinimalPoller {
  private statePath: string;
  private mappingPath: string;
  private drive = google.drive({ version: 'v3' });
  private docs = google.docs({ version: 'v1' });

  constructor(private cwd: string) {
    const harnessState = path.resolve(cwd, 'google-api-tests/changes.state.json');
    const harnessMapping = path.resolve(cwd, 'google-api-tests/mapping.json');
    const flatState = path.resolve(cwd, 'changes.state.json');
    const flatMapping = path.resolve(cwd, 'mapping.json');

    this.statePath = fs.existsSync(harnessState) ? harnessState : flatState;
    this.mappingPath = fs.existsSync(harnessMapping) ? harnessMapping : flatMapping;
  }

  private loadState(): any {
    return loadJson<any>(this.statePath, {});
  }

  private saveState(s: any) {
    fs.writeFileSync(this.statePath, JSON.stringify(s, null, 2));
  }

  private loadMapping(): Mapping {
    return loadJson<Mapping>(this.mappingPath, { notes: {}, notebooks: {} });
  }

  async initIfNeeded(auth: any): Promise<string | null> {
    const st = this.loadState();
    if (st.pageToken) return st.pageToken;
    const drive = google.drive({ version: 'v3', auth });
    const startRes = await drive.changes.getStartPageToken({ supportsAllDrives: true });
    const pageToken = startRes.data.startPageToken as string;
    this.saveState({ pageToken });
    console.info('[plugin-poller] Initialized pageToken:', pageToken);
    return null;
  }

  async processOnce(auth: any): Promise<{ matched: number; items: Array<{ noteId: string; fileId: string; tabMatched: boolean }> }> {
    const st = this.loadState();
    if (!st.pageToken) return { matched: 0, items: [] };
    const drive = google.drive({ version: 'v3', auth });
    const docs = google.docs({ version: 'v1', auth });
    const mapping = this.loadMapping();

    const fileIdToNoteId: Record<string, string> = {};
    for (const [noteId, b] of Object.entries(mapping.notes)) {
      if (b.fileId) fileIdToNoteId[b.fileId] = noteId;
    }

    let pageToken: string | undefined = st.pageToken;
    let matched = 0;
    const items: Array<{ noteId: string; fileId: string; tabMatched: boolean }> = [];
    const seenChanged: Record<string, true> = {};
    while (pageToken) {
      const { data } = await drive.changes.list({
        pageToken,
        fields: 'newStartPageToken,nextPageToken,changes(fileId,removed,time,file(id,name))',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      for (const ch of data.changes || []) {
        const fileId = ch.fileId as string;
        const noteId = fileIdToNoteId[fileId];
        if (!noteId) continue;
        if (ch.removed) {
          console.warn('[plugin-poller] Access lost (removed) for note', noteId, 'file', fileId);
          continue;
        }
        const binding = mapping.notes[noteId];
        if (!binding?.tabId) {
          console.info('[plugin-poller] Would update note (no tabId)', noteId, 'from file', fileId);
          matched += 1;
          items.push({ noteId, fileId, tabMatched: false });
          seenChanged[fileId] = true;
          continue;
        }

        const meta = await docs.documents.get({ documentId: fileId, includeTabsContent: true });
        const tabs = meta.data.tabs || [];
        const stack = [...tabs];
        let found = false;
        while (stack.length) {
          const t: any = stack.shift();
          if (t?.tabProperties?.tabId === binding.tabId) { found = true; break; }
          for (const c of t?.childTabs || []) stack.push(c);
        }
        if (found) {
          console.info('[plugin-poller] Would update note', noteId, 'from file', fileId, 'tab', binding.tabId);
          matched += 1;
          items.push({ noteId, fileId, tabMatched: true });
          seenChanged[fileId] = true;
        }
      }

      if (data.nextPageToken) {
        pageToken = data.nextPageToken as string;
      } else {
        const newToken = (data.newStartPageToken as string) || pageToken;
        this.saveState({ pageToken: newToken });
        break;
      }
    }
    // Fallback: direct revision comparison for mapped files not reported by Drive changes
    for (const [noteId, b] of Object.entries(mapping.notes)) {
      const fileId = b.fileId;
      if (!fileId || seenChanged[fileId]) continue;
      try {
        const meta = await docs.documents.get({ documentId: fileId });
        const rev = String((meta.data as any).revisionId || '');
        if (rev && b.lastKnownRevisionId && rev !== b.lastKnownRevisionId) {
          console.info('[plugin-poller] Would update note (rev mismatch)', noteId, 'file', fileId);
          matched += 1;
          items.push({ noteId, fileId, tabMatched: !!b.tabId });
        }
      } catch (_) {
        // ignore fetch errors
      }
    }

    return { matched, items };
  }

  // Decide push vs pull per item by comparing revisionId and timestamps
  async decideOnce(auth: any, j: any): Promise<{ matched: number; decisions: Array<{ noteId: string; fileId: string; tabMatched: boolean; action: 'pull' | 'push'; reason: string }> }> {
    const base = await this.processOnce(auth);
    const drive = google.drive({ version: 'v3', auth });
    const docs = google.docs({ version: 'v1', auth });
    const mapping = this.loadMapping();
    const decisions: Array<{ noteId: string; fileId: string; tabMatched: boolean; action: 'pull' | 'push'; reason: string }> = [];
    for (const it of base.items) {
      try {
        const nb = (mapping.notes && mapping.notes[it.noteId]) || {};
        const [noteUpdated, docModified, currentRevisionId] = await Promise.all([
          fetchNoteUpdated(j, it.noteId),
          fetchDriveModified(drive, it.fileId),
          fetchDocRevisionId(docs, it.fileId),
        ]);
        const d = decideAction({
          lastKnownRevisionId: (nb as any).lastKnownRevisionId,
          currentRevisionId,
          noteUpdated,
          docModified,
          lastSyncTs: (nb as any).lastSyncTs,
        });
        decisions.push({ ...it, action: d.action, reason: d.reason });
      } catch (_) {
        // If metadata fetch fails, default to pull to avoid overwriting Docs
        decisions.push({ ...it, action: 'pull', reason: 'metaError' });
      }
    }
    // Include locally updated notes since last sync even if Drive reported no change
    const decidedNotes = new Set(decisions.map(d => d.noteId));
    let extra = 0;
    for (const [noteId, nbAny] of Object.entries(mapping.notes)) {
      const nb = nbAny as any;
      const fileId = nb && nb.fileId;
      if (!fileId || decidedNotes.has(noteId)) continue;
      try {
        const [noteUpdated, currentRevisionId] = await Promise.all([
          fetchNoteUpdated(j, noteId),
          fetchDocRevisionId(docs, fileId),
        ]);
        const lastSync = Number(nb.lastSyncTs || 0);
        const docUnchanged = !nb.lastKnownRevisionId || nb.lastKnownRevisionId === currentRevisionId;
        if (noteUpdated > lastSync && docUnchanged) {
          decisions.push({ noteId, fileId, tabMatched: !!nb.tabId, action: 'push', reason: 'noteUpdatedNoDocChange' });
          extra += 1;
        }
      } catch {
        // ignore
      }
    }
    return { matched: base.matched + extra, decisions };
  }

  // Execute decisions: push or pull items, update mapping metadata on success
  async syncOnce(auth: any, j: any, installDir: string, dataDir: string): Promise<{ matched: number; updated: number; decisions: Array<{ noteId: string; fileId: string; tabMatched: boolean; action: 'pull' | 'push'; reason: string }> }> {
    const { matched, decisions } = await this.decideOnce(auth, j);
    let updated = 0;
    const docs = google.docs({ version: 'v1', auth });
    let mapping = loadPluginMapping(dataDir);
    for (const d of decisions) {
      try {
        if (d.action === 'push') {
          await executePush(j, installDir, dataDir, d.noteId);
          updated += 1;
        } else {
          await executePull(j, docs, installDir, d.noteId, d.fileId);
          await updateMappingAfterPull(dataDir, docs, d.noteId, d.fileId);
          updated += 1;
        }
      } catch {
        // continue
      }
    }
    return { matched, updated, decisions };
  }
}

// ---- Helpers kept small and composable (no spaghetti) ----

async function fetchNoteUpdated(j: any, noteId: string): Promise<number> {
  const meta = await j.data.get(['notes', noteId], { fields: ['id', 'updated_time'] });
  return Number(meta.updated_time || 0);
}

async function fetchDriveModified(drive: any, fileId: string): Promise<number> {
  const fileMeta = await drive.files.get({ fileId, fields: 'id, modifiedTime' });
  return Date.parse((fileMeta.data && (fileMeta.data as any).modifiedTime) || 0);
}

async function fetchDocRevisionId(docs: any, fileId: string): Promise<string> {
  const docRes = await docs.documents.get({ documentId: fileId });
  return String((docRes.data as any).revisionId || '');
}

function decideAction(args: {
  lastKnownRevisionId?: string;
  currentRevisionId?: string;
  noteUpdated: number;
  docModified: number;
  lastSyncTs?: number;
}): { action: 'pull' | 'push'; reason: string } {
  const { lastKnownRevisionId, currentRevisionId, noteUpdated, docModified, lastSyncTs } = args;
  const lastSync = Number(lastSyncTs || 0);
  const docNewer = !!(lastKnownRevisionId && currentRevisionId && lastKnownRevisionId !== currentRevisionId);
  if (docNewer) return { action: 'pull', reason: 'docRevisionChanged' };
  const noteNewer = noteUpdated > Math.max(docModified || 0, lastSync || 0);
  return noteNewer ? { action: 'push', reason: 'noteUpdatedAfterDoc' } : { action: 'pull', reason: 'defaultPull' };
}

async function executePull(j: any, docs: any, installDir: string, noteId: string, fileId: string): Promise<void> {
  const sel = await buildConversionDocFromTabs(docs, fileId, { tabId: undefined });
  const convertDoc = (sel as any).convertDoc;
  const md = convertDocumentToMarkdown(convertDoc, { installDir });
  await j.data.put(['notes', noteId], null, { body: md });
}

async function updateMappingAfterPull(dataDir: string, docs: any, noteId: string, fileId: string): Promise<void> {
  const docMeta = await docs.documents.get({ documentId: fileId });
  const docRevisionId = String((docMeta.data as any).revisionId || '');
  const mapping = loadPluginMapping(dataDir);
  const nb = (mapping.notes[noteId] || {}) as any;
  nb.fileId = fileId;
  if (docRevisionId) nb.lastKnownRevisionId = docRevisionId;
  nb.lastSyncTs = Date.now();
  mapping.notes[noteId] = nb;
  savePluginMapping(dataDir, mapping);
}

async function executePush(j: any, installDir: string, dataDir: string, noteId: string): Promise<void> {
  await pushNoteById({ j, installDir, dataDir, noteId });
}



