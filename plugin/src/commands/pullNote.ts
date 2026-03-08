/**
 * pullNote - Pull content from a bound Google Doc into a Joplin note
 * 
 * Uses GoogleDocsProvider for document operations.
 */

import { loadMapping, saveMapping } from '../mapping';
import { buildConversionDocFromTabs } from '../structure';
import { convertDocumentToMarkdown } from '../converters';
import { createSyncContext, SyncContext } from '../services/syncContext';
import { getSelectedNoteId, updateNoteBody } from '../services/noteOperations';

/**
 * Parameters for pullNote command
 */
type Params = {
  j: any;
  installDir: string;
  dataDir: string;
  /** Optional noteId - if not provided, uses the currently selected note */
  noteId?: string;
  /** Optional pre-created SyncContext - avoids re-authentication if provided */
  ctx?: SyncContext;
};

/**
 * Result of a successful pull operation
 */
export type PullResult = {
  noteId: string;
  tabCount: number;
  usedTabTitle: string;
  /** Whether the note content was actually updated (false if identical) */
  updated?: boolean;
};

/**
 * Pulls content from a bound Google Doc into a Joplin note.
 * 
 * This function:
 * 1. Gets the note's binding (fileId and optional tabId)
 * 2. Fetches the document content via provider
 * 3. Converts the content to Markdown
 * 4. Updates the Joplin note body (if changed)
 * 5. Updates the local mapping with new revision info
 * 
 * @param params - Pull parameters including Joplin API, paths, and optional noteId
 * @returns Promise resolving to pull result with noteId and tab info
 * @throws Error if no note is selected/specified or if note is not bound
 */
export async function pullNote(params: Params): Promise<PullResult> {
  const { j, installDir, dataDir } = params;

  const ctx = params.ctx || await createSyncContext(installDir, dataDir, j);

  const noteId = params.noteId || await getSelectedNoteId(j);

  const mapping = loadMapping(dataDir);
  const binding = mapping.notes[noteId];
  if (!binding?.fileId) {
    throw new Error('Note is not bound to a Google Doc.');
  }

  // Using buildConversionDocFromTabs for tab selection support;
  // provider's getDocument() could be extended to support tabs in future
  const { convertDoc, tabCount, usedTabTitle = '' } = await buildConversionDocFromTabs(
    ctx.docs, binding.fileId, { tabId: binding.tabId }
  );

  const md = convertDocumentToMarkdown(convertDoc, { installDir });

  const existingNote = await j.data.get(['notes', noteId], { fields: ['body'] });
  const existingBody = (existingNote?.body || '').trim();
  const newBody = md.trim();
  
  let updated = false;
  if (existingBody !== newBody) {
    await updateNoteBody(j, noteId, md);
    updated = true;
  }

  const newRevisionId = await ctx.provider.getRevisionId(binding.fileId);

  if (newRevisionId) {
    mapping.notes[noteId] = {
      ...binding,
      lastKnownRevisionId: newRevisionId,
      lastSyncTs: Date.now(),
    };
    saveMapping(dataDir, mapping);
  }

  return { noteId, tabCount, usedTabTitle, updated };
}
