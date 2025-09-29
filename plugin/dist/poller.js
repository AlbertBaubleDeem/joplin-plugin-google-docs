"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MinimalPoller = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const googleapis_1 = require("googleapis");
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
        this.statePath = path_1.default.resolve(cwd, 'google-api-tests/changes.state.json');
        this.mappingPath = path_1.default.resolve(cwd, 'google-api-tests/mapping.json');
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
            return;
        const drive = googleapis_1.google.drive({ version: 'v3', auth });
        const docs = googleapis_1.google.docs({ version: 'v1', auth });
        const mapping = this.loadMapping();
        const fileIdToNoteId = {};
        for (const [noteId, b] of Object.entries(mapping.notes)) {
            if (b.fileId)
                fileIdToNoteId[b.fileId] = noteId;
        }
        let pageToken = st.pageToken;
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
                if (!binding?.tabId)
                    continue;
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
    }
}
exports.MinimalPoller = MinimalPoller;
