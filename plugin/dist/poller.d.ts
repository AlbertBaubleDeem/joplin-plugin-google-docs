/**
 * MinimalPoller - Handles bidirectional sync between Joplin notes and Google Docs
 *
 * Uses SyncContext for authenticated API access and delegates to pullNote/pushNote commands.
 */
import { SyncContext } from './services/SyncContext';
export declare class MinimalPoller {
    private statePath;
    private ctx;
    /**
     * Create a new MinimalPoller
     * @param ctx - SyncContext with authenticated API clients
     */
    constructor(ctx: SyncContext);
    private get dataDir();
    private get drive();
    private get docs();
    private loadState;
    private saveState;
    /**
     * Load mapping using the plugin's standard mapping module.
     * This ensures consistency with push/pull operations.
     */
    private getMapping;
    /**
     * Initialize the poller state if needed
     * @returns The existing pageToken, or null if we just initialized
     */
    initIfNeeded(): Promise<string | null>;
    /**
     * Process Drive changes once, returning items that need syncing
     * @returns Matched items with their file/note IDs
     */
    processOnce(): Promise<{
        matched: number;
        items: Array<{
            noteId: string;
            fileId: string;
            tabMatched: boolean;
        }>;
    }>;
    /**
     * Decide push vs pull per item by comparing revisionId and timestamps
     * @param j - Joplin API
     * @returns Decisions for each item that needs syncing
     */
    decideOnce(j: any): Promise<{
        matched: number;
        decisions: Array<{
            noteId: string;
            fileId: string;
            tabMatched: boolean;
            action: 'pull' | 'push';
            reason: string;
        }>;
    }>;
    /**
     * Execute sync decisions: push or pull items
     * Uses pullNote() and pushNote() commands to avoid duplicate logic
     *
     * @param j - Joplin API
     * @returns Sync results with decision details
     */
    syncOnce(j: any): Promise<{
        matched: number;
        updated: number;
        decisions: Array<{
            noteId: string;
            fileId: string;
            tabMatched: boolean;
            action: 'pull' | 'push';
            reason: string;
        }>;
    }>;
}
