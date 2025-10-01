"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = __importDefault(require("api"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const mapping_1 = require("./mapping");
// Defer loading heavy deps (googleapis, poller) until command execution
console.warn('[gdocs] root index executing (dist)');
api_1.default.plugins.register({
    onStart: async () => {
        try {
            console.info('[gdocs] onStart: registering commands');
            await api_1.default.commands.register({
                name: 'gdocsHello',
                label: 'Google Docs Sync: Hello',
                execute: async () => {
                    console.info('[gdocs] Skeleton plugin loaded');
                },
            });
            await api_1.default.commands.register({
                name: 'gdocsPollOnce',
                label: 'Google Docs Sync: Poll Once (log-only)',
                execute: async () => {
                    try {
                        const { google } = require('googleapis');
                        const { MinimalPoller } = require('./poller');
                        // Load tokens/env from the plugin folder
                        const installDir = (await api_1.default.plugins.installationDir()) || '';
                        const dataDir = await api_1.default.plugins.dataDir();
                        const pluginEnv = path_1.default.resolve(installDir, '.env');
                        const pluginToken = path_1.default.resolve(installDir, '.token.json');
                        const chosenEnvPath = fs_1.default.existsSync(pluginEnv) ? pluginEnv : '';
                        if (chosenEnvPath) {
                            const env = fs_1.default.readFileSync(chosenEnvPath, 'utf8');
                            for (const line of env.split('\n')) {
                                const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
                                if (m)
                                    process.env[m[1]] = m[2];
                            }
                        }
                        const tokenPath = process.env.GOOGLE_TOKENS_PATH
                            ? process.env.GOOGLE_TOKENS_PATH
                            : (fs_1.default.existsSync(pluginToken) ? pluginToken : '');
                        const tokens = JSON.parse(fs_1.default.readFileSync(tokenPath, 'utf8'));
                        const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
                        auth.setCredentials(tokens);
                        const poller = new MinimalPoller(dataDir);
                        const maybe = await poller.initIfNeeded(auth);
                        if (maybe === null) {
                            await api_1.default.views.dialogs.showMessageBox('Initialized Drive pageToken. Run Poll Once again.');
                            return; // first-run init only
                        }
                        const res = await poller.processOnce(auth);
                        const lines = res.items.map((it) => `- noteId=${it.noteId} fileId=${it.fileId} tabMatched=${it.tabMatched}`);
                        await api_1.default.views.dialogs.showMessageBox(`Poll completed. Matches: ${res.matched}${lines.length ? ('\n' + lines.join('\n')) : ''}`);
                    }
                    catch (e) {
                        const msg = (e && e.response && e.response.data) || (e && e.message) || e;
                        console.error('[gdocs] poll error', msg);
                    }
                },
            });
            await api_1.default.commands.register({
                name: 'gdocsBind',
                label: 'Google Docs Sync: Bind note to Drive fileId',
                execute: async () => {
                    const noteIds = await api_1.default.workspace.selectedNoteIds();
                    if (!noteIds.length)
                        return;
                    const [noteId] = noteIds;
                    const dataDir = await api_1.default.plugins.dataDir();
                    const dId = 'gdocsBindDialog-' + Date.now();
                    const d = await api_1.default.views.dialogs.create(dId);
                    const html = `
            <form name="f" style="min-width: 420px">
              <p>Enter Google Drive fileId and optional tabId:</p>
              <label>fileId:<br/><input name="fileId" style="width: 98%" /></label><br/>
              <label>tabId (optional):<br/><input name="tabId" style="width: 98%" /></label>
            </form>
          `;
                    await api_1.default.views.dialogs.setHtml(d, html);
                    await api_1.default.views.dialogs.setButtons(d, [{ id: 'ok' }, { id: 'cancel' }]);
                    const r = await api_1.default.views.dialogs.open(d);
                    if (!r || r.id !== 'ok')
                        return;
                    const fd = (r.formData && (r.formData.f || r.formData)) || {};
                    const fileId = fd.fileId ? String(fd.fileId).trim() : '';
                    const tabId = fd.tabId ? String(fd.tabId).trim() : '';
                    if (!fileId) {
                        await api_1.default.views.dialogs.showMessageBox('fileId is required.');
                        return;
                    }
                    (0, mapping_1.bindNote)(dataDir, noteId, { fileId, tabId: tabId || undefined });
                    await api_1.default.views.dialogs.showMessageBox('Bound note to fileId: ' + fileId + (tabId ? (' tabId: ' + tabId) : ''));
                },
            });
            await api_1.default.commands.register({
                name: 'gdocsUnbind',
                label: 'Google Docs Sync: Unbind note',
                execute: async () => {
                    const noteIds = await api_1.default.workspace.selectedNoteIds();
                    if (!noteIds.length)
                        return;
                    const [noteId] = noteIds;
                    const dataDir = await api_1.default.plugins.dataDir();
                    (0, mapping_1.unbindNote)(dataDir, noteId);
                    console.info('[gdocs] unbound note', noteId);
                },
            });
            await api_1.default.views.menuItems.create('gdocsBindMenu', 'gdocsBind', api_1.default.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Bind note' });
            await api_1.default.views.menuItems.create('gdocsUnbindMenu', 'gdocsUnbind', api_1.default.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Unbind note' });
            console.info('[gdocs] onStart: commands registered');
            // Add menu items under Tools for quick visibility
            try {
                await api_1.default.views.menuItems.create('gdocsHelloMenu', 'gdocsHello', api_1.default.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Hello' });
                await api_1.default.views.menuItems.create('gdocsPollOnceMenu', 'gdocsPollOnce', api_1.default.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Poll Once (log-only)' });
                // Pull command
                await api_1.default.commands.register({
                    name: 'gdocsPullNow',
                    label: 'Google Docs Sync: Pull (update note)',
                    execute: async () => {
                        try {
                            const noteIds = await api_1.default.workspace.selectedNoteIds();
                            if (!noteIds.length)
                                return;
                            const [noteId] = noteIds;
                            const dataDir = await api_1.default.plugins.dataDir();
                            const installDir = (await api_1.default.plugins.installationDir()) || '';
                            const mapping = (0, mapping_1.loadMapping)(dataDir);
                            const binding = mapping.notes[noteId];
                            if (!binding?.fileId) {
                                await api_1.default.views.dialogs.showMessageBox('Note is not bound.');
                                return;
                            }
                            const { google } = require('googleapis');
                            const pluginToken = path_1.default.resolve(installDir, '.token.json');
                            const tokens = JSON.parse(fs_1.default.readFileSync(pluginToken, 'utf8'));
                            const auth = new (require('googleapis').google).auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
                            auth.setCredentials(tokens);
                            const docs = require('googleapis').google.docs({ version: 'v1', auth });
                            const doc = await docs.documents.get({ documentId: binding.fileId });
                            const content = (doc.data.body && doc.data.body.content) || [];
                            const lines = [];
                            for (const c of content) {
                                const p = c.paragraph;
                                if (!p || !p.elements)
                                    continue;
                                let line = '';
                                for (const el of p.elements) {
                                    const tr = el.textRun;
                                    if (tr && tr.content)
                                        line += tr.content;
                                }
                                if (line.trim().length)
                                    lines.push(line.replace(/\n+$/, '').trimEnd());
                            }
                            const md = lines.join('\n\n');
                            await api_1.default.data.put(['notes', noteId], null, { body: md });
                            await api_1.default.views.dialogs.showMessageBox('Pulled content into the note.');
                        }
                        catch (e) {
                            const msg = (e && e.response && e.response.data) || (e && e.message) || String(e);
                            await api_1.default.views.dialogs.showMessageBox('Pull error: ' + msg);
                        }
                    },
                });
                await api_1.default.views.menuItems.create('gdocsPullNowMenu', 'gdocsPullNow', api_1.default.views.menus.MenuItemLocation.Tools, { label: 'Google Docs Sync: Pull (update note)' });
                console.info('[gdocs] onStart: menu items created');
            }
            catch (menuErr) {
                const msg = (menuErr && menuErr.message) || menuErr;
                console.error('[gdocs] menu create error', msg);
            }
            // No marker writes to install dir
        }
        catch (err) {
            const msg = (err && err.message) || err;
            console.error('[gdocs] onStart error', msg);
        }
    },
});
