import { bindNote as bindMappingNote } from '../mapping';

export function bindNoteDoer(dataDir: string, noteId: string, fileId: string, tabId?: string): void {
  bindMappingNote(dataDir, noteId, { fileId, tabId });
}


