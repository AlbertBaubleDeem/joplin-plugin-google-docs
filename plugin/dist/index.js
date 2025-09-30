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
console.info('[gdocs] module loaded');
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
                        // Load tokens/env from the plugin folder if present; fallback to test harness
                        const installDir = (await api_1.default.plugins.installationDir()) || '';
                        const repoRoot = path_1.default.resolve(process.cwd(), '..');
                        const pluginEnv = path_1.default.resolve(installDir, '.env');
                        const pluginToken = path_1.default.resolve(installDir, '.token.json');
                        const harnessEnv = path_1.default.resolve(repoRoot, 'google-api-tests/.env');
                        const harnessToken = path_1.default.resolve(repoRoot, 'google-api-tests/.token.json');
                        const chosenEnvPath = fs_1.default.existsSync(pluginEnv) ? pluginEnv : (fs_1.default.existsSync(harnessEnv) ? harnessEnv : '');
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
                            : (fs_1.default.existsSync(pluginToken) ? pluginToken : harnessToken);
                        const tokens = JSON.parse(fs_1.default.readFileSync(tokenPath, 'utf8'));
                        const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
                        auth.setCredentials(tokens);
                        // Prefer plugin dir for state/mapping if present; otherwise fallback to harness layout
                        const baseDir = fs_1.default.existsSync(path_1.default.resolve(installDir, 'mapping.json')) || fs_1.default.existsSync(path_1.default.resolve(installDir, 'changes.state.json'))
                            ? installDir
                            : repoRoot;
                        const poller = new MinimalPoller(baseDir);
                        const maybe = await poller.initIfNeeded(auth);
                        if (maybe === null)
                            return; // first-run init only
                        await poller.processOnce(auth);
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
                    const installDir = (await api_1.default.plugins.installationDir()) || '';
                    const r = await api_1.default.views.dialogs.showMessageBox('Enter Google Drive fileId in the note title field and press OK');
                    if (r !== 0)
                        return;
                    const note = await api_1.default.workspace.selectedNote();
                    const fileId = note?.title?.trim();
                    if (!fileId)
                        return;
                    (0, mapping_1.bindNote)(installDir, noteId, { fileId });
                    console.info('[gdocs] bound note', noteId, 'to file', fileId);
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
                    const installDir = (await api_1.default.plugins.installationDir()) || '';
                    (0, mapping_1.unbindNote)(installDir, noteId);
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
                console.info('[gdocs] onStart: menu items created');
            }
            catch (menuErr) {
                const msg = (menuErr && menuErr.message) || menuErr;
                console.error('[gdocs] menu create error', msg);
            }
            // Write a marker file to the plugin directory to prove onStart executed
            try {
                const dir = (await api_1.default.plugins.installationDir()) || '';
                if (dir) {
                    fs_1.default.writeFileSync(require('path').resolve(dir, 'started.txt'), new Date().toISOString());
                    console.info('[gdocs] wrote started.txt to', dir);
                }
            }
            catch (ioErr) {
                const msg = (ioErr && ioErr.message) || ioErr;
                console.error('[gdocs] start marker error', msg);
            }
        }
        catch (err) {
            const msg = (err && err.message) || err;
            console.error('[gdocs] onStart error', msg);
        }
    },
});
