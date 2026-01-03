"use strict";
/**
 * MinimalPoller - Handles bidirectional sync between Joplin notes and Google Docs
 *
 * Uses SyncContext for authenticated API access and delegates to pullNote/pushNote commands.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MinimalPoller = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const mapping_1 = require("./mapping");
const pushNote_1 = require("./commands/pushNote");
const pullNote_1 = require("./commands/pullNote");
function loadJson(p, fallback) {
    try {
        return JSON.parse(fs_1.default.readFileSync(p, 'utf8'));
    }
    catch {
        return fallback;
    }
}
class MinimalPoller {
    /**
     * Create a new MinimalPoller
     * @param ctx - SyncContext with authenticated API clients
     */
    constructor(ctx) {
        this.ctx = ctx;
        // State file for Drive Changes API pageToken
        this.statePath = path_1.default.resolve(ctx.dataDir, 'changes.state.json');
    }
    get dataDir() {
        return this.ctx.dataDir;
    }
    get drive() {
        return this.ctx.drive;
    }
    get docs() {
        return this.ctx.docs;
    }
    loadState() {
        return loadJson(this.statePath, {});
    }
    saveState(s) {
        fs_1.default.writeFileSync(this.statePath, JSON.stringify(s, null, 2));
    }
    /**
     * Load mapping using the plugin's standard mapping module.
     * This ensures consistency with push/pull operations.
     */
    getMapping() {
        return (0, mapping_1.loadMapping)(this.dataDir);
    }
    /**
     * Initialize the poller state if needed
     * @returns The existing pageToken, or null if we just initialized
     */
    async initIfNeeded() {
        const st = this.loadState();
        if (st.pageToken)
            return st.pageToken;
        const startRes = await this.drive.changes.getStartPageToken({ supportsAllDrives: true });
        const pageToken = startRes.data.startPageToken;
        this.saveState({ pageToken });
        console.info('[plugin-poller] Initialized pageToken:', pageToken);
        return null;
    }
    /**
     * Process Drive changes once, returning items that need syncing
     * @returns Matched items with their file/note IDs
     */
    async processOnce() {
        const st = this.loadState();
        if (!st.pageToken)
            return { matched: 0, items: [] };
        const { drive, docs } = this;
        const mapping = this.getMapping();
        const fileIdToNoteId = {};
        for (const [noteId, b] of Object.entries(mapping.notes)) {
            if (b.fileId)
                fileIdToNoteId[b.fileId] = noteId;
        }
        let pageToken = st.pageToken;
        let matched = 0;
        const items = [];
        const seenChanged = {};
        while (pageToken) {
            const { data } = await drive.changes.list({
                pageToken,
                fields: 'newStartPageToken,nextPageToken,changes(fileId,removed,time,file(id,name))',
                supportsAllDrives: true,
                includeItemsFromAllDrives: true,
            });
            for (const ch of data.changes || []) {
                const fileId = ch.fileId;
                const noteId = fileIdToNoteId[fileId];
                if (!noteId)
                    continue;
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
                    const t = stack.shift();
                    if (t?.tabProperties?.tabId === binding.tabId) {
                        found = true;
                        break;
                    }
                    for (const c of t?.childTabs || [])
                        stack.push(c);
                }
                if (found) {
                    console.info('[plugin-poller] Would update note', noteId, 'from file', fileId, 'tab', binding.tabId);
                    matched += 1;
                    items.push({ noteId, fileId, tabMatched: true });
                    seenChanged[fileId] = true;
                }
            }
            if (data.nextPageToken) {
                pageToken = data.nextPageToken;
            }
            else {
                const newToken = data.newStartPageToken || pageToken;
                this.saveState({ pageToken: newToken });
                break;
            }
        }
        // Fallback: direct revision comparison for mapped files not reported by Drive changes
        // Batch these in parallel for performance
        const uncheckedNotes = [];
        for (const [noteId, b] of Object.entries(mapping.notes)) {
            const fileId = b.fileId;
            if (!fileId || seenChanged[fileId])
                continue;
            uncheckedNotes.push({ noteId, fileId, binding: b });
        }
        if (uncheckedNotes.length > 0) {
            const revisionResults = await Promise.allSettled(uncheckedNotes.map(async ({ noteId, fileId, binding }) => {
                const meta = await docs.documents.get({ documentId: fileId });
                const rev = String(meta.data.revisionId || '');
                return { noteId, fileId, binding, rev };
            }));
            for (const result of revisionResults) {
                if (result.status !== 'fulfilled')
                    continue;
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
    /**
     * Decide push vs pull per item by comparing revisionId and timestamps
     * @param j - Joplin API
     * @returns Decisions for each item that needs syncing
     */
    async decideOnce(j) {
        const base = await this.processOnce();
        const { drive, docs } = this;
        const mapping = this.getMapping();
        const allDecisions = [];
        // Process Drive change items in parallel for performance
        if (base.items.length > 0) {
            const driveChangeResults = await Promise.allSettled(base.items.map(async (it) => {
                const nb = (mapping.notes && mapping.notes[it.noteId]) || {};
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
            }));
            for (let i = 0; i < driveChangeResults.length; i++) {
                const result = driveChangeResults[i];
                if (result.status === 'fulfilled') {
                    allDecisions.push(result.value);
                }
                else {
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
        const notesToCheck = [];
        for (const [noteId, nbAny] of Object.entries(mapping.notes)) {
            const nb = nbAny;
            const fileId = nb && nb.fileId;
            if (!fileId || decidedNotes.has(noteId))
                continue;
            notesToCheck.push({ noteId, fileId, nb });
        }
        // Batch fetch note metadata in parallel (much faster than sequential)
        if (notesToCheck.length > 0) {
            const checkResults = await Promise.allSettled(notesToCheck.map(async ({ noteId, fileId, nb }) => {
                const [noteUpdated, currentRevisionId] = await Promise.all([
                    fetchNoteUpdated(j, noteId),
                    fetchDocRevisionId(docs, fileId),
                ]);
                return { noteId, fileId, nb, noteUpdated, currentRevisionId };
            }));
            for (const result of checkResults) {
                if (result.status !== 'fulfilled')
                    continue;
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
        const decisions = allDecisions.filter(d => d.action !== 'skip');
        return { matched: decisions.length, decisions };
    }
    /**
     * Execute sync decisions: push or pull items
     * Uses pullNote() and pushNote() commands to avoid duplicate logic
     *
     * @param j - Joplin API
     * @returns Sync results with decision details
     */
    async syncOnce(j) {
        const { matched, decisions } = await this.decideOnce(j);
        let updated = 0;
        const { installDir, dataDir } = this.ctx;
        for (const d of decisions) {
            try {
                if (d.action === 'push') {
                    // Use pushNote command - reuses existing SyncContext
                    await (0, pushNote_1.pushNote)({ j, installDir, dataDir, noteId: d.noteId, ctx: this.ctx });
                    updated += 1;
                }
                else {
                    // Use pullNote command - reuses existing SyncContext
                    const result = await (0, pullNote_1.pullNote)({ j, installDir, dataDir, noteId: d.noteId, ctx: this.ctx });
                    if (result.updated) {
                        updated += 1;
                    }
                }
            }
            catch (err) {
                console.error(`[plugin-poller] Error syncing note ${d.noteId}:`, err);
                // continue with other notes
            }
        }
        return { matched, updated, decisions };
    }
}
exports.MinimalPoller = MinimalPoller;
// ---- Helpers kept small and composable (no spaghetti) ----
async function fetchNoteUpdated(j, noteId) {
    const meta = await j.data.get(['notes', noteId], { fields: ['id', 'updated_time'] });
    return Number(meta.updated_time || 0);
}
async function fetchDriveModified(drive, fileId) {
    const fileMeta = await drive.files.get({ fileId, fields: 'id, modifiedTime' });
    return Date.parse((fileMeta.data && fileMeta.data.modifiedTime) || 0);
}
async function fetchDocRevisionId(docs, fileId) {
    const docRes = await docs.documents.get({ documentId: fileId });
    return String(docRes.data.revisionId || '');
}
function decideAction(args) {
    const { lastKnownRevisionId, currentRevisionId, noteUpdated, docModified, lastSyncTs } = args;
    const lastSync = Number(lastSyncTs || 0);
    // Check if doc revision changed since last sync
    const docNewer = !!(lastKnownRevisionId && currentRevisionId && lastKnownRevisionId !== currentRevisionId);
    if (docNewer)
        return { action: 'pull', reason: 'docRevisionChanged' };
    // Check if note was updated after doc and after last sync
    // Add 2 second tolerance to avoid timing race conditions
    const tolerance = 2000;
    const noteNewer = noteUpdated > Math.max(docModified || 0, (lastSync || 0) + tolerance);
    if (noteNewer)
        return { action: 'push', reason: 'noteUpdatedAfterDoc' };
    // Nothing changed - skip instead of defaulting to pull (which would cause sync loop)
    return { action: 'skip', reason: 'noChanges' };
}
