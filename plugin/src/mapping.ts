import fs from 'fs';
import path from 'path';

export type NoteBinding = {
  fileId?: string;
  tabId?: string;
  lastKnownRevisionId?: string;
  lastSyncTs?: number;
};

export type Mapping = {
  notes: Record<string, NoteBinding>;
  notebooks: Record<string, { fileId?: string }>;
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


