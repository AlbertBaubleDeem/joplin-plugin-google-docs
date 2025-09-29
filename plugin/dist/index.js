"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = __importDefault(require("api"));
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
        },
    });
})();
