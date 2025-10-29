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
    constructor(cwd) {
        this.cwd = cwd;
        this.drive = googleapis_1.google.drive({ version: 'v3' });
        this.docs = googleapis_1.google.docs({ version: 'v1' });
        const harnessState = path_1.default.resolve(cwd, 'google-api-tests/changes.state.json');
        const harnessMapping = path_1.default.resolve(cwd, 'google-api-tests/mapping.json');
        const flatState = path_1.default.resolve(cwd, 'changes.state.json');
        const flatMapping = path_1.default.resolve(cwd, 'mapping.json');
        this.statePath = fs_1.default.existsSync(harnessState) ? harnessState : flatState;
        this.mappingPath = fs_1.default.existsSync(harnessMapping) ? harnessMapping : flatMapping;
    }
    loadState() {
        return loadJson(this.statePath, {});
    }
    saveState(s) {
        fs_1.default.writeFileSync(this.statePath, JSON.stringify(s, null, 2));
    }
    loadMapping() {
        return loadJson(this.mappingPath, { notes: {}, notebooks: {} });
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
        const mapping = this.loadMapping();
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
        for (const [noteId, b] of Object.entries(mapping.notes)) {
            const fileId = b.fileId;
            if (!fileId || seenChanged[fileId])
                continue;
            try {
                const meta = await docs.documents.get({ documentId: fileId });
                const rev = String(meta.data.revisionId || '');
                if (rev && b.lastKnownRevisionId && rev !== b.lastKnownRevisionId) {
                    console.info('[plugin-poller] Would update note (rev mismatch)', noteId, 'file', fileId);
                    matched += 1;
                    items.push({ noteId, fileId, tabMatched: !!b.tabId });
                }
            }
            catch (_) {
                // ignore fetch errors
            }
        }
        return { matched, items };
    }
    // Decide push vs pull per item by comparing revisionId and timestamps
    async decideOnce(auth, j) {
        const base = await this.processOnce(auth);
        const drive = googleapis_1.google.drive({ version: 'v3', auth });
        const docs = googleapis_1.google.docs({ version: 'v1', auth });
        const mapping = this.loadMapping();
        const decisions = [];
        for (const it of base.items) {
            try {
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
                decisions.push({ ...it, action: d.action, reason: d.reason });
            }
            catch (_) {
                // If metadata fetch fails, default to pull to avoid overwriting Docs
                decisions.push({ ...it, action: 'pull', reason: 'metaError' });
            }
        }
        // Include locally updated notes since last sync even if Drive reported no change
        const decidedNotes = new Set(decisions.map(d => d.noteId));
        let extra = 0;
        for (const [noteId, nbAny] of Object.entries(mapping.notes)) {
            const nb = nbAny;
            const fileId = nb && nb.fileId;
            if (!fileId || decidedNotes.has(noteId))
                continue;
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
            }
            catch {
                // ignore
            }
        }
        return { matched: base.matched + extra, decisions };
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
                    await executePull(j, docs, installDir, d.noteId, d.fileId);
                    await updateMappingAfterPull(dataDir, docs, d.noteId, d.fileId);
                    updated += 1;
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
    const docNewer = !!(lastKnownRevisionId && currentRevisionId && lastKnownRevisionId !== currentRevisionId);
    if (docNewer)
        return { action: 'pull', reason: 'docRevisionChanged' };
    const noteNewer = noteUpdated > Math.max(docModified || 0, lastSync || 0);
    return noteNewer ? { action: 'push', reason: 'noteUpdatedAfterDoc' } : { action: 'pull', reason: 'defaultPull' };
}
async function executePull(j, docs, installDir, noteId, fileId) {
    const sel = await (0, structure_1.buildConversionDocFromTabs)(docs, fileId, { tabId: undefined });
    const convertDoc = sel.convertDoc;
    const md = (0, converter_1.convertDocumentToMarkdown)(convertDoc, { installDir });
    await j.data.put(['notes', noteId], null, { body: md });
}
async function updateMappingAfterPull(dataDir, docs, noteId, fileId) {
    const docMeta = await docs.documents.get({ documentId: fileId });
    const docRevisionId = String(docMeta.data.revisionId || '');
    const mapping = (0, mapping_1.loadMapping)(dataDir);
    const nb = (mapping.notes[noteId] || {});
    nb.fileId = fileId;
    if (docRevisionId)
        nb.lastKnownRevisionId = docRevisionId;
    nb.lastSyncTs = Date.now();
    mapping.notes[noteId] = nb;
    (0, mapping_1.saveMapping)(dataDir, mapping);
}
async function executePush(j, installDir, dataDir, noteId) {
    await (0, pushNote_1.pushNoteById)({ j, installDir, dataDir, noteId });
}
