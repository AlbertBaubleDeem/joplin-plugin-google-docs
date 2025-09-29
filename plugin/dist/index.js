"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = __importDefault(require("api"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const googleapis_1 = require("googleapis");
const poller_1 = require("./poller");
(async () => {
    await api_1.default.plugins.register({
        onStart: async () => {
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
                        // Load tokens/env from the test harness location for now
                        const cwd = (await api_1.default.plugins.installationDir()) || '';
                        // The repo root is two levels up from dist when packaged; here we assume dev layout
                        const repoRoot = path_1.default.resolve(process.cwd(), '..');
                        const envPath = path_1.default.resolve(repoRoot, 'google-api-tests/.env');
                        const tokenPath = process.env.GOOGLE_TOKENS_PATH || path_1.default.resolve(repoRoot, 'google-api-tests/.token.json');
                        if (fs_1.default.existsSync(envPath)) {
                            const env = fs_1.default.readFileSync(envPath, 'utf8');
                            for (const line of env.split('\n')) {
                                const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
                                if (m)
                                    process.env[m[1]] = m[2];
                            }
                        }
                        const tokens = JSON.parse(fs_1.default.readFileSync(tokenPath, 'utf8'));
                        const auth = new googleapis_1.google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
                        auth.setCredentials(tokens);
                        const poller = new poller_1.MinimalPoller(repoRoot);
                        const maybe = await poller.initIfNeeded(auth);
                        if (maybe === null)
                            return; // first-run init only
                        await poller.processOnce(auth);
                    }
                    catch (e) {
                        console.error('[gdocs] poll error', e?.response?.data || e?.message || e);
                    }
                },
            });
        },
    });
})();
