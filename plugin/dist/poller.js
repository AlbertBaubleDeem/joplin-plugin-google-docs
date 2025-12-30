"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MinimalPoller = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const googleapis_1 = require("googleapis");
const structure_1 = require("./structure");
const converter_1 = require("./converter");
const mapping_1 = require("./mapping");
const pushNote_1 = require("./commands/pushNote");
function loadJson(p, fallback) {
    try {
        return JSON.parse(fs_1.default.readFileSync(p, 'utf8'));
    }
    catch {
        return fallback;
    }
}
class MinimalPoller {
    constructor(dataDir) {
        this.drive = googleapis_1.google.drive({ version: 'v3' });
        this.docs = googleapis_1.google.docs({ version: 'v1' });
        this.dataDir = dataDir;
        // State file for Drive Changes API pageToken
        this.statePath = path_1.default.resolve(dataDir, 'changes.state.json');
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
    async initIfNeeded(auth) {
        const st = this.loadState();
        if (st.pageToken)
            return st.pageToken;
        const drive = googleapis_1.google.drive({ version: 'v3', auth });
        const startRes = await drive.changes.getStartPageToken({ supportsAllDrives: true });
        const pageToken = startRes.data.startPageToken;
        this.saveState({ pageToken });
        console.info('[plugin-poller] Initialized pageToken:', pageToken);
        return null;
    }
    async processOnce(auth) {
        const st = this.loadState();
        if (!st.pageToken)
            return { matched: 0, items: [] };
        const drive = googleapis_1.google.drive({ version: 'v3', auth });
        const docs = googleapis_1.google.docs({ version: 'v1', auth });
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
    // Decide push vs pull per item by comparing revisionId and timestamps
    async decideOnce(auth, j) {
        const base = await this.processOnce(auth);
        const drive = googleapis_1.google.drive({ version: 'v3', auth });
        const docs = googleapis_1.google.docs({ version: 'v1', auth });
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
    // Execute decisions: push or pull items, update mapping metadata on success
    async syncOnce(auth, j, installDir, dataDir) {
        const { matched, decisions } = await this.decideOnce(auth, j);
        let updated = 0;
        const docs = googleapis_1.google.docs({ version: 'v1', auth });
        let mapping = (0, mapping_1.loadMapping)(dataDir);
        for (const d of decisions) {
            try {
                if (d.action === 'push') {
                    await executePush(j, installDir, dataDir, d.noteId);
                    updated += 1;
                }
                else {
                    const pullResult = await executePull(j, docs, installDir, d.noteId, d.fileId);
                    await updateMappingAfterPull(dataDir, docs, d.noteId, d.fileId, pullResult.noteUpdatedTime);
                    if (pullResult.updated) {
                        updated += 1;
                    }
                }
            }
            catch {
                // continue
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
async function executePull(j, docs, installDir, noteId, fileId) {
    const sel = await (0, structure_1.buildConversionDocFromTabs)(docs, fileId, { tabId: undefined });
    const convertDoc = sel.convertDoc;
    const md = (0, converter_1.convertDocumentToMarkdown)(convertDoc, { installDir });
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
async function updateMappingAfterPull(dataDir, docs, noteId, fileId, noteUpdatedTime) {
    const docMeta = await docs.documents.get({ documentId: fileId });
    const docRevisionId = String(docMeta.data.revisionId || '');
    const mapping = (0, mapping_1.loadMapping)(dataDir);
    const nb = (mapping.notes[noteId] || {});
    nb.fileId = fileId;
    if (docRevisionId)
        nb.lastKnownRevisionId = docRevisionId;
    // Use the actual note updated_time to prevent timing race
    nb.lastSyncTs = noteUpdatedTime;
    mapping.notes[noteId] = nb;
    (0, mapping_1.saveMapping)(dataDir, mapping);
}
async function executePush(j, installDir, dataDir, noteId) {
    await (0, pushNote_1.pushNoteById)({ j, installDir, dataDir, noteId });
}
