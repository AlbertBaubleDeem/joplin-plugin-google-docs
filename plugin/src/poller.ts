import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { buildConversionDocFromTabs } from './structure';
import { convertDocumentToMarkdown } from './converter';
import { loadMapping, saveMapping, Mapping as PluginMapping } from './mapping';
import { pushNoteById } from './commands/pushNote';

function loadJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export class MinimalPoller {
  private statePath: string;
  private dataDir: string;
  private drive = google.drive({ version: 'v3' });
  private docs = google.docs({ version: 'v1' });

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    // State file for Drive Changes API pageToken
    this.statePath = path.resolve(dataDir, 'changes.state.json');
  }

  private loadState(): any {
    return loadJson<any>(this.statePath, {});
  }

  private saveState(s: any) {
    fs.writeFileSync(this.statePath, JSON.stringify(s, null, 2));
  }

  /**
   * Load mapping using the plugin's standard mapping module.
   * This ensures consistency with push/pull operations.
   */
  private getMapping(): PluginMapping {
    return loadMapping(this.dataDir);
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
    const mapping = this.getMapping();

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
    // Batch these in parallel for performance
    const uncheckedNotes: Array<{ noteId: string; fileId: string; binding: any }> = [];
    for (const [noteId, b] of Object.entries(mapping.notes)) {
      const fileId = b.fileId;
      if (!fileId || seenChanged[fileId]) continue;
      uncheckedNotes.push({ noteId, fileId, binding: b });
    }
    
    if (uncheckedNotes.length > 0) {
      const revisionResults = await Promise.allSettled(
        uncheckedNotes.map(async ({ noteId, fileId, binding }) => {
          const meta = await docs.documents.get({ documentId: fileId });
          const rev = String((meta.data as any).revisionId || '');
          return { noteId, fileId, binding, rev };
        })
      );
      
      for (const result of revisionResults) {
        if (result.status !== 'fulfilled') continue;
        const { noteId, fileId, binding, rev } = result.value;
        if (rev && binding.lastKnownRevisionId && rev !== binding.lastKnownRevisionId) {
          console.info('[plugin-poller] Would update note (rev mismatch)', noteId, 'file', fileId);
          matched += 1;
          items.push({ noteId, fileId, tabMatched: !!binding.tabId });
        }
      }
    }

    return { matched, items };
  }

  // Decide push vs pull per item by comparing revisionId and timestamps
  async decideOnce(auth: any, j: any): Promise<{ matched: number; decisions: Array<{ noteId: string; fileId: string; tabMatched: boolean; action: 'pull' | 'push'; reason: string }> }> {
    const base = await this.processOnce(auth);
    const drive = google.drive({ version: 'v3', auth });
    const docs = google.docs({ version: 'v1', auth });
    const mapping = this.getMapping();
    const allDecisions: Array<{ noteId: string; fileId: string; tabMatched: boolean; action: 'pull' | 'push' | 'skip'; reason: string }> = [];
    
    // Process Drive change items in parallel for performance
    if (base.items.length > 0) {
      const driveChangeResults = await Promise.allSettled(
        base.items.map(async (it) => {
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
          return { ...it, action: d.action, reason: d.reason };
        })
      );
      
      for (let i = 0; i < driveChangeResults.length; i++) {
        const result = driveChangeResults[i];
        if (result.status === 'fulfilled') {
          allDecisions.push(result.value);
        } else {
          // If metadata fetch fails, default to pull to avoid overwriting Docs
          allDecisions.push({ ...base.items[i], action: 'pull', reason: 'metaError' });
        }
      }
    }
    
    // Include locally updated notes since last sync even if Drive reported no change
    // Batch fetch all note metadata in parallel for performance
    const decidedNotes = new Set(allDecisions.map(d => d.noteId));
    const tolerance = 2000; // 2 second tolerance to avoid timing race
    
    // Collect notes that need checking
    const notesToCheck: Array<{ noteId: string; fileId: string; nb: any }> = [];
    for (const [noteId, nbAny] of Object.entries(mapping.notes)) {
      const nb = nbAny as any;
      const fileId = nb && nb.fileId;
      if (!fileId || decidedNotes.has(noteId)) continue;
      notesToCheck.push({ noteId, fileId, nb });
    }
    
    // Batch fetch note metadata in parallel (much faster than sequential)
    if (notesToCheck.length > 0) {
      const checkResults = await Promise.allSettled(
        notesToCheck.map(async ({ noteId, fileId, nb }) => {
          const [noteUpdated, currentRevisionId] = await Promise.all([
            fetchNoteUpdated(j, noteId),
            fetchDocRevisionId(docs, fileId),
          ]);
          return { noteId, fileId, nb, noteUpdated, currentRevisionId };
        })
      );
      
      for (const result of checkResults) {
        if (result.status !== 'fulfilled') continue;
        const { noteId, fileId, nb, noteUpdated, currentRevisionId } = result.value;
        const lastSync = Number(nb.lastSyncTs || 0);
        const docUnchanged = !nb.lastKnownRevisionId || nb.lastKnownRevisionId === currentRevisionId;
        // Only push if note was updated significantly after lastSync (with tolerance)
        if (noteUpdated > (lastSync + tolerance) && docUnchanged) {
          allDecisions.push({ noteId, fileId, tabMatched: !!nb.tabId, action: 'push', reason: 'noteUpdatedNoDocChange' });
        }
      }
    }
    
    // Filter out 'skip' actions - only return items that need syncing
    const decisions = allDecisions.filter(d => d.action !== 'skip') as Array<{ noteId: string; fileId: string; tabMatched: boolean; action: 'pull' | 'push'; reason: string }>;
    
    return { matched: decisions.length, decisions };
  }

  // Execute decisions: push or pull items, update mapping metadata on success
  async syncOnce(auth: any, j: any, installDir: string, dataDir: string): Promise<{ matched: number; updated: number; decisions: Array<{ noteId: string; fileId: string; tabMatched: boolean; action: 'pull' | 'push'; reason: string }> }> {
    const { matched, decisions } = await this.decideOnce(auth, j);
    let updated = 0;
    const docs = google.docs({ version: 'v1', auth });
    let mapping = loadMapping(dataDir);
    for (const d of decisions) {
      try {
        if (d.action === 'push') {
          await executePush(j, installDir, dataDir, d.noteId);
          updated += 1;
        } else {
          const pullResult = await executePull(j, docs, installDir, d.noteId, d.fileId);
          await updateMappingAfterPull(dataDir, docs, d.noteId, d.fileId, pullResult.noteUpdatedTime);
          if (pullResult.updated) {
            updated += 1;
          }
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
}): { action: 'pull' | 'push' | 'skip'; reason: string } {
  const { lastKnownRevisionId, currentRevisionId, noteUpdated, docModified, lastSyncTs } = args;
  const lastSync = Number(lastSyncTs || 0);
  
  // Check if doc revision changed since last sync
  const docNewer = !!(lastKnownRevisionId && currentRevisionId && lastKnownRevisionId !== currentRevisionId);
  if (docNewer) return { action: 'pull', reason: 'docRevisionChanged' };
  
  // Check if note was updated after doc and after last sync
  // Add 2 second tolerance to avoid timing race conditions
  const tolerance = 2000;
  const noteNewer = noteUpdated > Math.max(docModified || 0, (lastSync || 0) + tolerance);
  if (noteNewer) return { action: 'push', reason: 'noteUpdatedAfterDoc' };
  
  // Nothing changed - skip instead of defaulting to pull (which would cause sync loop)
  return { action: 'skip', reason: 'noChanges' };
}

async function executePull(j: any, docs: any, installDir: string, noteId: string, fileId: string): Promise<{ updated: boolean; noteUpdatedTime: number }> {
  const sel = await buildConversionDocFromTabs(docs, fileId, { tabId: undefined });
  const convertDoc = (sel as any).convertDoc;
  const md = convertDocumentToMarkdown(convertDoc, { installDir });
  
  // Compare with existing note content to avoid unnecessary writes
  // (Google Docs revisionId changes even without content changes)
  const existingNote = await j.data.get(['notes', noteId], { fields: ['body', 'updated_time'] });
  const existingBody = (existingNote.body || '').trim();
  const newBody = md.trim();
  
  if (existingBody === newBody) {
    // Content is identical - skip the write, just update mapping
    console.info('[plugin-poller] Skipping pull - content identical for note', noteId);
    return { updated: false, noteUpdatedTime: Number(existingNote.updated_time || Date.now()) };
  }
  
  await j.data.put(['notes', noteId], null, { body: md });
  
  // Return the note's updated_time after the write
  const noteMeta = await j.data.get(['notes', noteId], { fields: ['updated_time'] });
  return { updated: true, noteUpdatedTime: Number(noteMeta.updated_time || Date.now()) };
}

async function updateMappingAfterPull(dataDir: string, docs: any, noteId: string, fileId: string, noteUpdatedTime: number): Promise<void> {
  const docMeta = await docs.documents.get({ documentId: fileId });
  const docRevisionId = String((docMeta.data as any).revisionId || '');
  const mapping = loadMapping(dataDir);
  const nb = (mapping.notes[noteId] || {}) as any;
  nb.fileId = fileId;
  if (docRevisionId) nb.lastKnownRevisionId = docRevisionId;
  // Use the actual note updated_time to prevent timing race
  nb.lastSyncTs = noteUpdatedTime;
  mapping.notes[noteId] = nb;
  saveMapping(dataDir, mapping);
}

async function executePush(j: any, installDir: string, dataDir: string, noteId: string): Promise<void> {
  await pushNoteById({ j, installDir, dataDir, noteId });
}



