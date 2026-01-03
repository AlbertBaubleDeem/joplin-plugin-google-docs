/**
 * NoteOperations - Common Joplin note operations
 * 
 * This module provides helper functions for common note-related operations,
 * consolidating patterns that appear across multiple commands.
 */

/**
 * Joplin API interface (minimal typing for common operations)
 */
export interface JoplinApi {
  workspace: {
    selectedNoteIds(): Promise<string[]>;
    selectedFolder(): Promise<{ id: string; title?: string } | null>;
  };
  data: {
    get(path: string[], query?: any): Promise<any>;
    post(path: string[], query: any, body: any): Promise<any>;
    put(path: string[], query: any, body: any): Promise<any>;
  };
}

/**
 * Note data structure (common fields)
 */
export interface NoteData {
  id: string;
  title?: string;
  body?: string;
  parent_id?: string;
  user_created_time?: number;
  user_updated_time?: number;
  updated_time?: number;
}

/**
 * Folder data structure
 */
export interface FolderData {
  id: string;
  title?: string;
  parent_id?: string;
}

/**
 * Gets the currently selected note ID.
 * 
 * @param j - Joplin API instance
 * @returns Promise resolving to the selected note ID
 * @throws Error if no note is selected
 */
export async function getSelectedNoteId(j: JoplinApi): Promise<string> {
  const selected = await j.workspace.selectedNoteIds();
  if (!selected || !selected.length) {
    throw new Error('No note is selected.');
  }
  return selected[0];
}

/**
 * Gets the currently selected note ID, or undefined if none selected.
 * 
 * @param j - Joplin API instance
 * @returns Promise resolving to the selected note ID or undefined
 */
export async function getSelectedNoteIdOrUndefined(j: JoplinApi): Promise<string | undefined> {
  const selected = await j.workspace.selectedNoteIds();
  return selected && selected.length ? selected[0] : undefined;
}

/**
 * Gets all currently selected note IDs.
 * Supports multi-selection (shift+click, ctrl+click).
 * 
 * @param j - Joplin API instance
 * @returns Promise resolving to array of selected note IDs
 * @throws Error if no notes are selected
 */
export async function getAllSelectedNoteIds(j: JoplinApi): Promise<string[]> {
  const selected = await j.workspace.selectedNoteIds();
  if (!selected || !selected.length) {
    throw new Error('No notes are selected.');
  }
  return selected;
}

/**
 * Gets effective note IDs from either provided array or workspace selection.
 * This is the preferred way to get note IDs for multi-note operations.
 * 
 * Use case: Commands that can be triggered from both:
 * - Command palette (no noteIds parameter, uses workspace selection)
 * - Context menu (noteIds provided as parameter)
 * 
 * @param j - Joplin API instance
 * @param noteIds - Optional array of note IDs (from context menu)
 * @returns Promise resolving to array of note IDs (may be empty)
 */
export async function getEffectiveNoteIds(j: JoplinApi, noteIds?: string[]): Promise<string[]> {
  // If noteIds provided and valid, use them
  if (noteIds && Array.isArray(noteIds) && noteIds.length) {
    return noteIds;
  }
  // Otherwise, get from workspace selection
  const selected = await j.workspace.selectedNoteIds();
  return selected || [];
}

/**
 * Gets note data by ID.
 * 
 * @param j - Joplin API instance
 * @param noteId - The note ID
 * @param fields - Fields to retrieve (defaults to common fields)
 * @returns Promise resolving to the note data
 */
export async function getNoteById(
  j: JoplinApi,
  noteId: string,
  fields: string[] = ['id', 'title', 'body', 'parent_id']
): Promise<NoteData> {
  return j.data.get(['notes', noteId], { fields });
}

/**
 * Updates a note's body content.
 * 
 * @param j - Joplin API instance
 * @param noteId - The note ID
 * @param body - New body content (Markdown)
 * @returns Promise resolving when update is complete
 */
export async function updateNoteBody(
  j: JoplinApi,
  noteId: string,
  body: string
): Promise<void> {
  await j.data.put(['notes', noteId], null, { body });
}

/**
 * Creates a new note.
 * 
 * @param j - Joplin API instance
 * @param title - Note title
 * @param body - Note body content
 * @param parentId - Parent folder ID
 * @returns Promise resolving to the created note data
 */
export async function createNote(
  j: JoplinApi,
  title: string,
  body: string,
  parentId: string
): Promise<NoteData> {
  return j.data.post(['notes'], null, {
    title,
    body,
    parent_id: parentId,
  });
}

/**
 * Gets the currently selected folder.
 * 
 * @param j - Joplin API instance
 * @returns Promise resolving to the selected folder or null
 */
export async function getSelectedFolder(j: JoplinApi): Promise<FolderData | null> {
  return j.workspace.selectedFolder();
}

/**
 * Gets folder data by ID.
 * 
 * @param j - Joplin API instance
 * @param folderId - The folder ID
 * @returns Promise resolving to the folder data
 */
export async function getFolderById(j: JoplinApi, folderId: string): Promise<FolderData> {
  return j.data.get(['folders', folderId]);
}

/**
 * Gets all notes in a folder.
 * 
 * @param j - Joplin API instance
 * @param folderId - The folder ID
 * @param options - Query options
 * @returns Promise resolving to array of notes
 */
export async function getNotesInFolder(
  j: JoplinApi,
  folderId: string,
  options: {
    fields?: string[];
    orderBy?: string;
    orderDir?: 'ASC' | 'DESC';
    limit?: number;
  } = {}
): Promise<NoteData[]> {
  const query = {
    fields: options.fields || ['id', 'title', 'body', 'user_created_time', 'user_updated_time'],
    order_by: options.orderBy || 'user_created_time',
    order_dir: options.orderDir || 'ASC',
    limit: options.limit || 100,
  };

  const result = await j.data.get(['folders', folderId, 'notes'], query);
  return result.items || [];
}

/**
 * Determines the target folder for new notes.
 * First tries the parent folder of the currently selected note,
 * then falls back to the first available folder.
 * 
 * @param j - Joplin API instance
 * @returns Promise resolving to the target folder ID
 * @throws Error if no suitable folder can be found
 */
export async function determineTargetFolder(j: JoplinApi): Promise<string> {
  // Try to get the parent folder of the currently selected note
  const selectedNoteId = await getSelectedNoteIdOrUndefined(j);
  if (selectedNoteId) {
    const note = await getNoteById(j, selectedNoteId, ['id', 'parent_id']);
    if (note.parent_id) {
      return note.parent_id;
    }
  }

  // Fall back to the first available folder
  const folders = await j.data.get(['folders'], { limit: 1, fields: ['id'] });
  if (folders && folders.items && folders.items.length) {
    return folders.items[0].id;
  }

  throw new Error('Could not determine a target Joplin notebook to create notes');
}

