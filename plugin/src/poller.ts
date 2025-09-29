import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';

type Mapping = {
  notes: Record<string, { fileId?: string; tabId?: string }>;
  notebooks: Record<string, { fileId?: string }>;
};

function loadJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export class MinimalPoller {
  private statePath: string;
  private mappingPath: string;
  private drive = google.drive({ version: 'v3' });
  private docs = google.docs({ version: 'v1' });

  constructor(private cwd: string) {
    this.statePath = path.resolve(cwd, 'google-api-tests/changes.state.json');
    this.mappingPath = path.resolve(cwd, 'google-api-tests/mapping.json');
  }

  private loadState(): any {
    return loadJson<any>(this.statePath, {});
  }

  private saveState(s: any) {
    fs.writeFileSync(this.statePath, JSON.stringify(s, null, 2));
  }

  private loadMapping(): Mapping {
    return loadJson<Mapping>(this.mappingPath, { notes: {}, notebooks: {} });
  }

  async initIfNeeded(auth: any): Promise<string | null> {
    const st = this.loadState();
    if (st.pageToken) return st.pageToken;
    const drive = google.drive({ version: 'v3', auth });
    const startRes = await drive.changes.getStartPageToken({ supportsAllDrives: true });
    const pageToken = startRes.data.startPageToken as string;
    this.saveState({ pageToken });
    console.info('[plugin-poller] Initialized pageToken:', pageToken);
    return null;
  }

  async processOnce(auth: any) {
    const st = this.loadState();
    if (!st.pageToken) return;
    const drive = google.drive({ version: 'v3', auth });
    const docs = google.docs({ version: 'v1', auth });
    const mapping = this.loadMapping();

    const fileIdToNoteId: Record<string, string> = {};
    for (const [noteId, b] of Object.entries(mapping.notes)) {
      if (b.fileId) fileIdToNoteId[b.fileId] = noteId;
    }

    let pageToken: string | undefined = st.pageToken;
    while (pageToken) {
      const { data } = await drive.changes.list({
        pageToken,
        fields: 'newStartPageToken,nextPageToken,changes(fileId,removed,time,file(id,name))',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      for (const ch of data.changes || []) {
        const fileId = ch.fileId as string;
        const noteId = fileIdToNoteId[fileId];
        if (!noteId) continue;
        if (ch.removed) {
          console.warn('[plugin-poller] Access lost (removed) for note', noteId, 'file', fileId);
          continue;
        }
        const binding = mapping.notes[noteId];
        if (!binding?.tabId) continue;

        const meta = await docs.documents.get({ documentId: fileId, includeTabsContent: true });
        const tabs = meta.data.tabs || [];
        const stack = [...tabs];
        let found = false;
        while (stack.length) {
          const t: any = stack.shift();
          if (t?.tabProperties?.tabId === binding.tabId) { found = true; break; }
          for (const c of t?.childTabs || []) stack.push(c);
        }
        if (found) {
          console.info('[plugin-poller] Would update note', noteId, 'from file', fileId, 'tab', binding.tabId);
        }
      }

      if (data.nextPageToken) {
        pageToken = data.nextPageToken as string;
      } else {
        const newToken = (data.newStartPageToken as string) || pageToken;
        this.saveState({ pageToken: newToken });
        break;
      }
    }
  }
}


