/**
 * Batch operations for multi-note push/pull/unbind.
 * Consolidates the batch processing logic from index.js.
 */

import { getEffectiveNoteIds } from './NoteOperations';
import { getBinding } from '../mapping';
import { unbindNoteDoer } from '../commands/unbindNote';
import { pushNote } from '../commands/pushNote';
import { pullNote } from '../commands/pullNote';
import { setDebugMode } from '../converter';
import {
  showSuccessDialog,
  showWarningDialog,
  showInfoDialog,
} from './styledDialogs';

type JoplinApi = any;

interface BatchResult {
  success: number;
  skipped: number;
  failed: number;
}

interface BatchParams {
  j: JoplinApi;
  installDir: string;
  dataDir: string;
  noteIds?: string[];
  debugEnabled?: boolean;
}

/**
 * Unbind one or more notes from their linked Google Docs.
 */
export async function batchUnbind(params: BatchParams): Promise<BatchResult | null> {
  const { j, dataDir, noteIds } = params;

  const effectiveNoteIds = await getEffectiveNoteIds(j, noteIds);
  if (!effectiveNoteIds.length) {
    await showWarningDialog(j, 'No Selection', 'Please select a note first.');
    return null;
  }

  let unbound = 0, skipped = 0;
  for (const noteId of effectiveNoteIds) {
    const binding = getBinding(dataDir, noteId);
    if (!binding) {
      skipped++;
      continue;
    }
    unbindNoteDoer(dataDir, noteId);
    unbound++;
  }

  // Show appropriate message based on count
  if (effectiveNoteIds.length === 1) {
    if (unbound) {
      await showSuccessDialog(j, 'Unbound', 'Note unlinked from Google Doc.');
    } else {
      await showInfoDialog(j, { title: 'Not Bound', message: 'This note was not linked to any Google Doc.', icon: 'ℹ️' });
    }
  } else {
    const msg = `Unbound: ${unbound} | Skipped: ${skipped}`;
    await showSuccessDialog(j, 'Unbind Complete', msg);
  }

  return { success: unbound, skipped, failed: 0 };
}

/**
 * Pull one or more notes from their linked Google Docs.
 */
export async function batchPull(params: BatchParams): Promise<BatchResult | null> {
  const { j, installDir, dataDir, noteIds, debugEnabled } = params;

  const effectiveNoteIds = await getEffectiveNoteIds(j, noteIds);
  if (!effectiveNoteIds.length) {
    await showWarningDialog(j, 'No Selection', 'Please select a note first.');
    return null;
  }

  // Enable debug mode if toggled on
  if (debugEnabled) {
    setDebugMode(true, dataDir);
  }

  // Single note - check binding and show appropriate message
  if (effectiveNoteIds.length === 1) {
    const noteId = effectiveNoteIds[0];
    const binding = getBinding(dataDir, noteId);
    if (!binding?.fileId) {
      await showInfoDialog(j, { title: 'Not Bound', message: 'This note is not linked to a Google Doc.\n\nUse "Export Note into Doc" or "Bind Note to Doc" first.', icon: 'ℹ️' });
      return { success: 0, skipped: 1, failed: 0 };
    }
    await pullNote({ j, installDir, dataDir, noteId });
    await showSuccessDialog(j, 'Pull Complete', 'Note updated from Google Doc.');
    return { success: 1, skipped: 0, failed: 0 };
  }

  // Multiple notes - batch process with summary
  let pulled = 0, skipped = 0, failed = 0;

  for (const noteId of effectiveNoteIds) {
    const binding = getBinding(dataDir, noteId);
    if (!binding) {
      skipped++;
      continue;
    }
    try {
      await pullNote({ j, installDir, dataDir, noteId });
      pulled++;
    } catch (e) {
      failed++;
    }
  }

  const msg = `Pulled: ${pulled} | Skipped: ${skipped}` + (failed ? ` | Failed: ${failed}` : '');
  if (failed > 0) {
    await showWarningDialog(j, 'Pull Complete', msg);
  } else {
    await showSuccessDialog(j, 'Pull Complete', msg);
  }

  return { success: pulled, skipped, failed };
}

/**
 * Push one or more notes to their linked Google Docs.
 */
export async function batchPush(params: BatchParams): Promise<BatchResult | null> {
  const { j, installDir, dataDir, noteIds, debugEnabled } = params;

  const effectiveNoteIds = await getEffectiveNoteIds(j, noteIds);
  if (!effectiveNoteIds.length) {
    await showWarningDialog(j, 'No Selection', 'Please select a note first.');
    return null;
  }

  // Enable debug mode if toggled on
  if (debugEnabled) {
    setDebugMode(true, dataDir);
  }

  // Single note - check binding and show appropriate message
  if (effectiveNoteIds.length === 1) {
    const noteId = effectiveNoteIds[0];
    const binding = getBinding(dataDir, noteId);
    if (!binding?.fileId) {
      await showInfoDialog(j, { title: 'Not Bound', message: 'This note is not linked to a Google Doc.\n\nUse "Export Note into Doc" or "Bind Note to Doc" first.', icon: 'ℹ️' });
      return { success: 0, skipped: 1, failed: 0 };
    }
    await pushNote({ j, installDir, dataDir, noteId });
    await showSuccessDialog(j, 'Push Complete', 'Note pushed to Google Doc.');
    return { success: 1, skipped: 0, failed: 0 };
  }

  // Multiple notes - batch process with summary
  let pushed = 0, skipped = 0, failed = 0;

  for (const noteId of effectiveNoteIds) {
    const binding = getBinding(dataDir, noteId);
    if (!binding) {
      skipped++;
      continue;
    }
    try {
      await pushNote({ j, installDir, dataDir, noteId });
      pushed++;
    } catch (e) {
      failed++;
    }
  }

  const msg = `Pushed: ${pushed} | Skipped: ${skipped}` + (failed ? ` | Failed: ${failed}` : '');
  if (failed > 0) {
    await showWarningDialog(j, 'Push Complete', msg);
  } else {
    await showSuccessDialog(j, 'Push Complete', msg);
  }

  return { success: pushed, skipped, failed };
}

