export declare class MinimalPoller {
    private cwd;
    private statePath;
    private mappingPath;
    private drive;
    private docs;
    constructor(cwd: string);
    private loadState;
    private saveState;
    private loadMapping;
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
