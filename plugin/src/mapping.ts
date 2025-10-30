import fs from 'fs';
import path from 'path';

export type NoteBinding = {
  fileId?: string;
  tabId?: string;
  lastKnownRevisionId?: string;
  lastSyncTs?: number;
};

export type NotebookBinding = {
  fileId: string;                     // Google Doc ID for this notebook
  noteIds: string[];                  // Notes synced as tabs
  lastSyncTs?: number;
};

export type Mapping = {
  notes: Record<string, NoteBinding>;
  notebooks: Record<string, NotebookBinding>;  // UPDATED: track full notebook info
  syncFolderId?: string;
};

function loadJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function resolveMappingPath(baseDir: string): string {
  const harness = path.resolve(baseDir, 'google-api-tests/mapping.json');
  const flat = path.resolve(baseDir, 'mapping.json');
  return fs.existsSync(harness) ? harness : flat;
}

export function loadMapping(baseDir: string): Mapping {
  const p = resolveMappingPath(baseDir);
  return loadJson<Mapping>(p, { notes: {}, notebooks: {} });
}

export function saveMapping(baseDir: string, mapping: Mapping) {
  const p = resolveMappingPath(baseDir);
  fs.writeFileSync(p, JSON.stringify(mapping, null, 2));
}

export function bindNote(baseDir: string, noteId: string, binding: NoteBinding): Mapping {
  const m = loadMapping(baseDir);
  m.notes[noteId] = {
    fileId: binding.fileId,
    tabId: binding.tabId,
    lastKnownRevisionId: binding.lastKnownRevisionId,
    lastSyncTs: binding.lastSyncTs,
  };
  saveMapping(baseDir, m);
  return m;
}

export function unbindNote(baseDir: string, noteId: string): Mapping {
  const m = loadMapping(baseDir);
  delete m.notes[noteId];
  saveMapping(baseDir, m);
  return m;
}

export function getBinding(baseDir: string, noteId: string): NoteBinding | undefined {
  const m = loadMapping(baseDir);
  return m.notes[noteId];
}

// --- Drive appProperties helpers (appProperties-only pairing strategy) ---

export type DriveLike = {
  files: {
    get(params: any): Promise<{ data: any }>;
    update(params: any): Promise<{ data: any }>;
  };
};

export const APP_PROPERTY_NOTE_ID = 'joplinNoteId';
export const APP_PROPERTY_TAB_ID = 'tabId';
export const APP_PROPERTY_VERSION = 'pairingVersion';
export const APP_PROPERTY_PLUGIN_ID = 'pluginId';
export const PLUGIN_ID = 'io.github.albertbaubledeem.joplin.google-docs';

export async function getDriveAppProperties(drive: DriveLike, fileId: string): Promise<Record<string, string>> {
  const { data } = await drive.files.get({
    fileId,
    fields: 'id,appProperties',
    supportsAllDrives: true,
  });
  return (data && data.appProperties) || {};
}

export async function setDriveAppProperties(
  drive: DriveLike,
  fileId: string,
  props: Record<string, string | undefined>,
): Promise<Record<string, string>> {
  // Filter out undefined values to avoid clearing keys unintentionally
  const filtered: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    if (typeof v === 'string') filtered[k] = v;
  }
  const { data } = await drive.files.update({
    fileId,
    requestBody: { appProperties: filtered },
    fields: 'id,appProperties',
    supportsAllDrives: true,
  });
  return (data && data.appProperties) || {};
}

export function setSyncFolderId(baseDir: string, folderId: string): Mapping {
  const m = loadMapping(baseDir);
  m.syncFolderId = folderId;
  saveMapping(baseDir, m);
  return m;
}


