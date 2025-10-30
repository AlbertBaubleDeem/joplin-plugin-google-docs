import { getAuthFromInstallDir } from '../services/auth';
import { loadMapping, saveMapping, bindNote, NotebookBinding, APP_PROPERTY_NOTE_ID } from '../mapping';
import { google as googleApis } from 'googleapis';

const APP_PROPERTY_NOTEBOOK_ID = 'joplinNotebookId';

type JoplinLike = {
  workspace: {
    selectedFolder(): Promise<any>;
  };
  data: {
    get(path: string[], query?: any): Promise<any>;
  };
  views: {
    dialogs: {
      showMessageBox(message: string): Promise<void>;
    };
  };
};

/**
 * Export a Joplin notebook as a multi-tab Google Doc
 */
export async function exportNotebook(args: { 
  j: JoplinLike; 
  installDir: string; 
  dataDir: string;
  folderId?: string;  // Optional: if not provided, use selected folder
}): Promise<{ fileId: string; noteCount: number } | undefined> {
  const { j, installDir, dataDir } = args;
  
  // Get the folder to export
  let folderId = args.folderId;
  if (!folderId) {
    const folder = await j.workspace.selectedFolder();
    if (!folder) {
      throw new Error('Please select a notebook first');
    }
    folderId = folder.id;
  }
  
  // Get folder details
  const folderData = await j.data.get(['folders', folderId!]);
  if (!folderData) {
    throw new Error('Could not find notebook');
  }
  
  // Get all notes in the folder
  const notesData = await j.data.get(['folders', folderId!, 'notes'], {
    fields: ['id', 'title', 'body', 'user_created_time', 'user_updated_time'],
    order_by: 'user_created_time',
    order_dir: 'ASC',
    limit: 100,  // Google Docs max tab limit
  });
  
  const notes = notesData.items || [];
  
  // Check limits
  if (notes.length === 0) {
    throw new Error('Notebook has no notes');
  }
  
  if (notes.length > 100) {
    throw new Error(`Notebook has ${notes.length} notes, which exceeds Google Docs limit of 100 tabs`);
  }
  
  if (notes.length > 50) {
    // Warn but continue
    await j.views.dialogs.showMessageBox(
      `Warning: This notebook has ${notes.length} notes. Google Docs supports up to 100 tabs, ` +
      `but performance may degrade with many tabs. Continuing...`
    );
  }
  
  
  // Filter out already synced notes
  const mapping = loadMapping(dataDir);
  const unboundNotes = notes.filter((note: any) => 
    !mapping.notes[note.id]?.fileId
  );
  
  if (unboundNotes.length === 0) {
    await j.views.dialogs.showMessageBox(
      'All notes in this notebook are already synced to Google Docs. Nothing to export.'
    );
    return;
  }
  
  const boundCount = notes.length - unboundNotes.length;
  if (boundCount > 0) {
    await j.views.dialogs.showMessageBox(
      `${boundCount} notes in this notebook are already synced and will be skipped. ` +
      `${unboundNotes.length} unsynced notes will be exported to a new folder.`
    );
  }
  
  // Authenticate
  const { google, auth } = await getAuthFromInstallDir(installDir);
  const drive = google.drive({ version: 'v3', auth });
  const docs = google.docs({ version: 'v1', auth });
  
  // Ensure sync folder exists
  let syncFolderId = mapping.syncFolderId;
  if (!syncFolderId) {
    // Create or find sync folder
    const res = await drive.files.list({
      q: `name='Joplin Google Docs Sync' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id,name)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    
    if (res.data.files && res.data.files.length > 0) {
      syncFolderId = res.data.files[0].id!;
    } else {
      // Create sync folder
      const createRes = await drive.files.create({
        requestBody: {
          name: 'Joplin Google Docs Sync',
          mimeType: 'application/vnd.google-apps.folder',
        },
        fields: 'id',
      });
      syncFolderId = createRes.data.id!;
    }
    
    // Save sync folder ID
    mapping.syncFolderId = syncFolderId;
    saveMapping(dataDir, mapping);
  }
  
  // Create a folder for the notebook
  console.log('[exportNotebook] Creating folder for notebook:', folderData.title);
  
  // Create notebook folder inside sync folder
  const notebookFolderRes = await drive.files.create({
    requestBody: {
      name: folderData.title,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [syncFolderId],
    },
    fields: 'id,name',
  });
  
  const notebookFolderId = notebookFolderRes.data.id!;
  
  // Create individual Google Docs for each note
  console.log('[exportNotebook] Creating individual documents for each note in the notebook');
  
  const path = require('path');
  const { convertMarkdownToPlainAndStyles, buildDocsStyleUpdateRequests } = require(path.resolve(installDir, 'dist/converter.js'));
  const converterOpts = { installDir };
  
  // Track created documents
  const createdDocs: Array<{ noteId: string; docId: string }> = [];
  
  // Create a document for each unbound note
  for (let i = 0; i < unboundNotes.length; i++) {
    const note = unboundNotes[i];
    console.log(`[exportNotebook] Creating document ${i + 1}/${unboundNotes.length} for note: ${note.title}`);
    
    // Create the document
    const docRes = await docs.documents.create({
      requestBody: {
        title: note.title || `Note ${i + 1}`,
      },
    });
    
    const docId = docRes.data.documentId!;
    
    // Move to notebook folder
    await drive.files.update({
      fileId: docId,
      addParents: notebookFolderId,
      fields: 'id,parents',
    });
    
    // Convert note content to Google Docs format
    const { plain, paraRanges, textRanges } = convertMarkdownToPlainAndStyles(note.body || '', converterOpts);
    
    // Build batch requests for content and formatting
    const batchRequests: any[] = [];
    
    // Insert the plain text
    batchRequests.push({
      insertText: {
        location: { index: 1 },
        text: plain,
      },
    });
    
    // Apply formatting
    const formatRequests = buildDocsStyleUpdateRequests(paraRanges, textRanges, 'Roboto Mono');
    batchRequests.push(...formatRequests);
    
    // Apply the content and formatting
    if (batchRequests.length > 0) {
      await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: {
          requests: batchRequests,
        },
      });
    }
    
    // Set app properties for each document
    await drive.files.update({
      fileId: docId,
      requestBody: {
        appProperties: {
          [APP_PROPERTY_NOTE_ID]: note.id,
          pluginId: 'io.github.albertbaubledeem.joplin.google-docs',
          [APP_PROPERTY_NOTEBOOK_ID]: folderId,
        },
      },
    });
    
    createdDocs.push({ noteId: note.id, docId });
    
    // Update local binding for this note
    bindNote(dataDir, note.id, {
      fileId: docId,
      lastSyncTs: Date.now(),
    });
    console.log(`[exportNotebook] Bound note ${note.id} to doc ${docId}`);
  }
  
  // Set notebook folder app properties
  await drive.files.update({
    fileId: notebookFolderId,
    requestBody: {
      appProperties: {
        [APP_PROPERTY_NOTEBOOK_ID]: folderId,
        pluginId: 'io.github.albertbaubledeem.joplin.google-docs',
        noteCount: String(unboundNotes.length),
      },
    },
  });
  
  // Update local mappings - reload to get the note bindings we just created
  const updatedMapping = loadMapping(dataDir);
  updatedMapping.notebooks[folderId!] = {
    fileId: notebookFolderId,  // Store the folder ID, not a doc ID
    noteIds: unboundNotes.map((n: any) => n.id),
    lastSyncTs: Date.now(),
  };
  saveMapping(dataDir, updatedMapping);
  
  console.log(`[exportNotebook] Successfully created notebook folder ${notebookFolderId} with ${unboundNotes.length} documents`);
  
  return {
    fileId: notebookFolderId,
    noteCount: unboundNotes.length,
  };
}
