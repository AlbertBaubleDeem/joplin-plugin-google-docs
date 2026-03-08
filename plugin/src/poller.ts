/**
 * MinimalPoller - Handles bidirectional sync between Joplin notes and Google Docs
 * 
 * Uses SyncContext for authenticated API access and delegates to pullNote/pushNote commands.
 */

import fs from 'fs';
import path from 'path';
import { loadMapping, Mapping as PluginMapping, NoteBinding } from './mapping';
import { pushNote } from './commands/pushNote';
import { pullNote } from './commands/pullNote';
import { SyncContext } from './services/syncContext';

type SyncDecision = {
  noteId: string;
  fileId: string;
  tabMatched: boolean;
  action: 'pull' | 'push';
  reason: string;
};

type PollerState = {
  pageToken?: string;
};

const loadJson = <T>(p: string, fallback: T): T => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return fallback;
  }
};

export class MinimalPoller {
  private statePath: string;
  private ctx: SyncContext;

  /**
   * Create a new MinimalPoller
   * @param ctx - SyncContext with authenticated API clients
   */
  constructor(ctx: SyncContext) {
    this.ctx = ctx;
    // State file for Drive Changes API pageToken
    this.statePath = path.resolve(ctx.dataDir, 'changes.state.json');
  }
  
  private get dataDir(): string {
    return this.ctx.dataDir;
  }
  
  private get drive() {
    return this.ctx.drive;
  }
  
  private get docs() {
    return this.ctx.docs;
  }

  private loadState(): PollerState {
    return loadJson<PollerState>(this.statePath, {});
  }

  private saveState(s: PollerState) {
    fs.writeFileSync(this.statePath, JSON.stringify(s, null, 2));
  }

  /**
   * Load mapping using the plugin's standard mapping module.
   * This ensures consistency with push/pull operations.
   */
  private getMapping(): PluginMapping {
    return loadMapping(this.dataDir);
  }

  /**
   * Initialize the poller state if needed
   * @returns The existing pageToken, or null if we just initialized
   */
  async initIfNeeded(): Promise<string | null> {
    const st = this.loadState();
    if (st.pageToken) return st.pageToken;
    const startRes = await this.drive.changes.getStartPageToken({ supportsAllDrives: true });
    const pageToken = startRes.data.startPageToken as string;
    this.saveState({ pageToken });
    console.info('[plugin-poller] Initialized pageToken:', pageToken);
    return null;
  }

  /**
   * Process Drive changes once, returning items that need syncing
   * @returns Matched items with their file/note IDs
   */
  async processOnce(): Promise<{ matched: number; items: Array<{ noteId: string; fileId: string; tabMatched: boolean }> }> {
    const st = this.loadState();
    if (!st.pageToken) return { matched: 0, items: [] };
    const { drive, docs } = this;
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
        type TabLike = { tabProperties?: { tabId?: string }; childTabs?: TabLike[] };
        const stack: TabLike[] = [...tabs as TabLike[]];
        let found = false;
        while (stack.length) {
          const t = stack.shift()!;
          if (t.tabProperties?.tabId === binding.tabId) { found = true; break; }
          for (const c of t.childTabs || []) stack.push(c);
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
    const uncheckedNotes: Array<{ noteId: string; fileId: string; binding: NoteBinding }> = [];
    for (const [noteId, b] of Object.entries(mapping.notes)) {
      const fileId = b.fileId;
      if (!fileId || seenChanged[fileId]) continue;
      uncheckedNotes.push({ noteId, fileId, binding: b });
    }
    
    if (uncheckedNotes.length > 0) {
      const revisionResults = await Promise.allSettled(
        uncheckedNotes.map(async ({ noteId, fileId, binding }) => {
          const meta = await docs.documents.get({ documentId: fileId });
          const rev = String((meta.data as { revisionId?: string }).revisionId || '');
          return { noteId, fileId, binding, rev };
        })
      );
      
      for (const result of revisionResults) {
        if (result.status !== 'fulfilled') continue;
        const { noteId, fileId, binding, rev } = result.value;
        if (!rev) continue;
        // Revision mismatch: doc changed since last sync
        const revisionChanged = binding.lastKnownRevisionId && rev !== binding.lastKnownRevisionId;
        // No baseline: note is bound but was never synced -- pull to establish baseline
        const noBaseline = !binding.lastKnownRevisionId;
        if (revisionChanged || noBaseline) {
          matched += 1;
          items.push({ noteId, fileId, tabMatched: !!binding.tabId });
        }
      }
    }

    return { matched, items };
  }

  /**
   * Decide push vs pull per item by comparing revisionId and timestamps
   * @param j - Joplin API
   * @returns Decisions for each item that needs syncing
   */
  async decideOnce(j: any): Promise<{ matched: number; decisions: SyncDecision[] }> {
    const base = await this.processOnce();
    const { drive, docs } = this;
    const mapping = this.getMapping();
    const allDecisions: Array<Omit<SyncDecision, 'action'> & { action: 'pull' | 'push' | 'skip' }> = [];
    
    // Process Drive change items in parallel for performance
    if (base.items.length > 0) {
      const driveChangeResults = await Promise.allSettled(
        base.items.map(async (it) => {
          const nb: NoteBinding = (mapping.notes && mapping.notes[it.noteId]) || {};
          const [noteUpdated, docModified, currentRevisionId] = await Promise.all([
            fetchNoteUpdated(j, it.noteId),
            fetchDriveModified(drive, it.fileId),
            fetchDocRevisionId(docs, it.fileId),
          ]);
          const d = decideAction({
            lastKnownRevisionId: nb.lastKnownRevisionId,
            currentRevisionId,
            noteUpdated,
            docModified,
            lastSyncTs: nb.lastSyncTs,
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
    const notesToCheck: Array<{ noteId: string; fileId: string; nb: NoteBinding }> = [];
    for (const [noteId, nb] of Object.entries(mapping.notes)) {
      const fileId = nb?.fileId;
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
    const decisions = allDecisions.filter(d => d.action !== 'skip') as SyncDecision[];
    
    return { matched: decisions.length, decisions };
  }

  /**
   * Execute sync decisions: push or pull items
   * Uses pullNote() and pushNote() commands to avoid duplicate logic
   * 
   * @param j - Joplin API
   * @returns Sync results with decision details
   */
  async syncOnce(j: any): Promise<{ matched: number; updated: number; decisions: SyncDecision[] }> {
    const { matched, decisions } = await this.decideOnce(j);
    let updated = 0;
    const { installDir, dataDir } = this.ctx;
    
    for (const d of decisions) {
      try {
        if (d.action === 'push') {
          // Use pushNote command - reuses existing SyncContext
          await pushNote({ j, installDir, dataDir, noteId: d.noteId, ctx: this.ctx });
          updated += 1;
        } else {
          // Use pullNote command - reuses existing SyncContext
          const result = await pullNote({ j, installDir, dataDir, noteId: d.noteId, ctx: this.ctx });
          if (result.updated) {
            updated += 1;
          }
        }
      } catch (err) {
        console.error(`[plugin-poller] Error syncing note ${d.noteId}:`, err);
        // continue with other notes
      }
    }
    return { matched, updated, decisions };
  }
}

async function fetchNoteUpdated(j: any, noteId: string): Promise<number> {
  const meta = await j.data.get(['notes', noteId], { fields: ['id', 'updated_time'] });
  return Number(meta.updated_time || 0);
}

async function fetchDriveModified(drive: SyncContext['drive'], fileId: string): Promise<number> {
  const fileMeta = await drive.files.get({ fileId, fields: 'id, modifiedTime' });
  return Date.parse((fileMeta.data as { modifiedTime?: string }).modifiedTime || '0');
}

async function fetchDocRevisionId(docs: SyncContext['docs'], fileId: string): Promise<string> {
  const docRes = await docs.documents.get({ documentId: fileId });
  return String((docRes.data as { revisionId?: string }).revisionId || '');
}

const decideAction = (args: {
  lastKnownRevisionId?: string;
  currentRevisionId?: string;
  noteUpdated: number;
  docModified: number;
  lastSyncTs?: number;
}): { action: 'pull' | 'push' | 'skip'; reason: string } => {
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
};
