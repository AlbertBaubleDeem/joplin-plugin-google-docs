export declare class MinimalPoller {
    private statePath;
    private dataDir;
    private drive;
    private docs;
    constructor(dataDir: string);
    private loadState;
    private saveState;
    /**
     * Load mapping using the plugin's standard mapping module.
     * This ensures consistency with push/pull operations.
     */
    private getMapping;
    initIfNeeded(auth: any): Promise<string | null>;
    processOnce(auth: any): Promise<{
        matched: number;
        items: Array<{
            noteId: string;
            fileId: string;
            tabMatched: boolean;
        }>;
    }>;
    decideOnce(auth: any, j: any): Promise<{
        matched: number;
        decisions: Array<{
            noteId: string;
            fileId: string;
            tabMatched: boolean;
            action: 'pull' | 'push';
            reason: string;
        }>;
    }>;
    syncOnce(auth: any, j: any, installDir: string, dataDir: string): Promise<{
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
