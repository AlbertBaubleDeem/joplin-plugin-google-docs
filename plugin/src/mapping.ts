import fs from 'fs';
import path from 'path';

export type NoteBinding = {
  fileId?: string;
  tabId?: string;
  lastKnownRevisionId?: string;
  lastSyncTs?: number;
  /** When true, merge consecutive code blocks across blank lines when pulling (for notes imported from "naughty" Docs) */
  mergeCodeBlocksOnPull?: boolean;
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

const loadJson = <T>(filePath: string, fallback: T): T => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
};

/**
 * Resolve the path to the mapping.json file.
 * Uses a flat path in the data directory.
 */
export function resolveMappingPath(baseDir: string): string {
  return path.resolve(baseDir, 'mapping.json');
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
    mergeCodeBlocksOnPull: binding.mergeCodeBlocksOnPull,
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

export type DriveLike = {
  files: {
    get(params: any): Promise<{ data: any }>;
    update(params: any): Promise<{ data: any }>;
  };
};

export const appPropertyNoteId = 'joplinNoteId';
export const appPropertyTabId = 'tabId';
export const appPropertyVersion = 'pairingVersion';
export const appPropertyPluginId = 'pluginId';
export const pluginId = 'io.github.albertbaubledeem.joplin.google-docs';

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


