/**
 * pullNote - Pull content from a bound Google Doc into a Joplin note
 */

import { loadMapping, saveMapping } from '../mapping';
import { buildConversionDocFromTabs } from '../structure';
import { convertDocumentToMarkdown } from '../converter';
import { createSyncContext } from '../services/SyncContext';
import { getSelectedNoteId } from '../services/NoteOperations';

/**
 * Parameters for pullNote command
 */
type Params = {
  j: any;
  installDir: string;
  dataDir: string;
  /** Optional noteId - if not provided, uses the currently selected note */
  noteId?: string;
};

/**
 * Result of a successful pull operation
 */
type PullResult = {
  noteId: string;
  tabCount: number;
  usedTabTitle: string;
};

/**
 * Pulls content from a bound Google Doc into a Joplin note.
 * 
 * This function:
 * 1. Gets the note's binding (fileId and optional tabId)
 * 2. Fetches the document content from Google Docs
 * 3. Converts the content to Markdown
 * 4. Updates the Joplin note body
 * 5. Updates the local mapping with new revision info
 * 
 * @param params - Pull parameters including Joplin API, paths, and optional noteId
 * @returns Promise resolving to pull result with noteId and tab info
 * @throws Error if no note is selected/specified or if note is not bound
 */
export async function pullNote(params: Params): Promise<PullResult> {
  const { j, installDir, dataDir } = params;

  // Create sync context with authenticated API clients
  const ctx = await createSyncContext(installDir, dataDir);

  // Determine the note ID
  let noteId: string;
  if (params.noteId && typeof params.noteId === 'string') {
    noteId = params.noteId;
  } else {
    noteId = await getSelectedNoteId(j);
  }

  // Get binding and validate
  const mapping = loadMapping(dataDir);
  const binding = mapping.notes[noteId];
  if (!binding?.fileId) {
    throw new Error('Note is not bound to a Google Doc.');
  }

  // Fetch and convert document content
  const sel = await buildConversionDocFromTabs(ctx.docs, binding.fileId, { tabId: binding.tabId });
  const convertDoc = (sel as any).convertDoc;
  const tabCount = (sel as any).tabCount || 0;
  const usedTabTitle = (sel as any).usedTabTitle || '';

  // Convert to Markdown
  const md = convertDocumentToMarkdown(convertDoc, { installDir });

  // Update note body
  await j.data.put(['notes', noteId], null, { body: md });

  // Update mapping with new revision info
  const docMeta = await ctx.docs.documents.get({ documentId: binding.fileId });
  const newRevisionId = String((docMeta.data as any).revisionId || '');

  if (newRevisionId) {
    mapping.notes[noteId] = {
      ...binding,
      lastKnownRevisionId: newRevisionId,
      lastSyncTs: Date.now(),
    };
    saveMapping(dataDir, mapping);
  }

  return { noteId, tabCount, usedTabTitle };
}
