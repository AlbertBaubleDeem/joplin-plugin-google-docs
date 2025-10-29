import { unbindNote as unbindMappingNote } from '../mapping';

export function unbindNoteDoer(dataDir: string, noteId: string): void {
  unbindMappingNote(dataDir, noteId);
}


