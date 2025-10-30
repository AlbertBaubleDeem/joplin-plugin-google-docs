# Notebook Export to Multi-tab Google Docs - Design Plan

## Overview

This feature allows users to export entire Joplin notebooks as multi-tabbed Google Docs, where each note becomes a tab. It also maintains single-note export capability and tracks sync relationships.

## Key Design Decisions

### 1. Sync Granularity Tracking

We need to track whether a note is synced as:
- **Single note** → Single Google Doc (existing behavior)
- **Part of notebook** → Tab within a multi-tab Google Doc

#### Implementation:
- Extend `NoteBinding` in mapping.ts:
  ```typescript
  type NoteBinding = {
    fileId: string;
    tabId?: string;
    syncMode?: 'single' | 'notebook';  // NEW
    parentNotebookId?: string;          // NEW - if part of notebook sync
    lastKnownRevisionId?: string;
    lastSyncTs?: number;
  };
  ```

- Add notebook tracking to mapping:
  ```typescript
  type Mapping = {
    notes: Record<string, NoteBinding>;
    notebooks: Record<string, {        // NEW structure
      fileId: string;                  // Google Doc ID for this notebook
      noteIds: string[];               // Notes synced as tabs
      lastSyncTs?: number;
    }>;
    syncFolderId?: string;
  };
  ```

### 2. User Interface

#### Commands:
1. **Export Note as Single Doc** (existing)
2. **Export Notebook as Multi-tab Doc** (new)
3. **Convert Single → Notebook sync** (new)
4. **Convert Notebook → Single sync** (new)

#### Visual Indicators:
- Note list: Show sync status icon
  - 📄 = Single note sync
  - 📚 = Part of notebook sync
  - ❌ = Not synced
- Notebook/folder context menu: "Export as Multi-tab Doc"
- Note context menu: Show current sync mode

### 3. Google Docs Structure

For notebook export:
```
Google Doc: "My Notebook Name"
├── Tab 1: "Note 1 Title"
├── Tab 2: "Note 2 Title"
└── Tab 3: "Note 3 Title"
```

AppProperties:
```json
{
  "joplinNotebookId": "notebook-id",
  "pluginId": "io.github.albertbaubledeem.joplin.google-docs",
  "syncMode": "notebook",
  "noteTabMapping": {
    "note-id-1": "tab-id-1",
    "note-id-2": "tab-id-2"
  }
}
```

### 4. Implementation Steps

#### Phase 1: Infrastructure
1. Extend mapping types to support notebook tracking
2. Add Google Docs Tabs API support for creating multi-tab docs
3. Create helper to get all notes in a folder: `j.data.get(['folders', folderId, 'notes'])`

#### Phase 2: Export Notebook Command
1. Create `exportNotebook.ts`:
   - Get selected folder/notebook
   - Fetch all notes in folder
   - Create multi-tab Google Doc
   - Export each note as a tab
   - Update mapping with notebook relationship

#### Phase 3: Sync Logic Updates
1. Update poller to handle notebook syncs:
   - Check if any note in notebook changed
   - Sync entire notebook or individual tabs
   - Handle note additions/removals from notebook

2. Update push/pull to be tab-aware when in notebook mode

#### Phase 4: UI Integration ✓ DECIDED
1. Add notebook export to folder context menu (right-click)
   ```javascript
   // Register notebook context menu
   await j.views.menuItems.create('notebookContextMenu', 'exportNotebook', {
     label: 'Export as Multi-tab Google Doc',
     commandName: 'gdocsExportNotebook',
   }, MenuItemLocation.FolderContextMenu);
   ```
2. Add status indicators to note list
3. Show sync mode in note properties

#### Phase 5: Conversion Commands
1. Single → Notebook:
   - Delete individual Google Docs
   - Create multi-tab doc
   - Update all mappings

2. Notebook → Single:
   - Extract each tab to separate doc
   - Delete multi-tab doc
   - Update mappings

### 5. Edge Cases to Handle

1. **Mixed sync modes in same notebook** ✓ DECIDED
   - When exporting notebook, any individually synced notes must be migrated
   - Process:
     1. Create new multi-tab doc with all notes
     2. Rename original individual docs to "<name> (Legacy)"
     3. Remove bindings from legacy docs
     4. Update all mappings to notebook mode
   - No mixed modes allowed within a notebook

2. **Moving notes between notebooks**
   - Note moves from synced notebook A to synced notebook B
   - Solution: Remove tab from Doc A, add tab to Doc B

3. **Large notebooks** ✓ DECIDED
   - Google Docs limit: 100 tabs per document, 1.02M characters total
   - Solution: 
     - Warn if notebook has > 50 notes (leave headroom)
     - Error if > 100 notes (hard limit)
     - Check total character count before export
     - Suggest splitting large notebooks

4. **Conflicts**
   - Local and remote changes to different notes in same notebook
   - Solution: Smart merge at tab level

### 6. Technical Challenges

1. **Tab ordering** ✓ DECIDED
   - Order by note creation time (`user_created_time`)
   - Maintain order during sync operations
   - Handle reordering when notes are added/removed

2. **Performance** ✓ DECIDED
   - Incremental sync: Only update changed tabs
   - Track per-note revision IDs within notebook
   - Batch read operations, individual tab updates

3. **Permissions**
   - Ensure app has access to create/modify multi-tab docs
   - Handle sharing permissions for notebook docs

### 7. Benefits

- **Organization**: Keep related notes together in one doc
- **Sharing**: Share entire notebook as single Google Doc
- **Navigation**: Use Google Docs tab UI for easy switching
- **Efficiency**: Fewer Google Docs to manage

### 8. Future Enhancements

1. **Nested notebooks**: Support sub-notebooks as tab groups
2. **Templates**: Create notebook templates with predefined tabs
3. **Bulk operations**: Export multiple notebooks at once
4. **Smart sync**: Only sync changed tabs, not entire doc

## Implementation Plan Based on Decisions

### 1. Migration Handling for Mixed Notebooks
When user exports a notebook that contains individually synced notes:

```javascript
async function migrateIndividualNotesToNotebook(notebookId, notes) {
  const individualNotes = notes.filter(n => 
    mapping.notes[n.id]?.syncMode === 'single'
  );
  
  if (individualNotes.length > 0) {
    // Show confirmation
    const msg = `This notebook contains ${individualNotes.length} individually synced notes. ` +
                `They will be migrated to the notebook sync and original docs renamed to (Legacy).`;
    if (!await confirmDialog(msg)) return;
    
    // Rename legacy docs
    for (const note of individualNotes) {
      const fileId = mapping.notes[note.id].fileId;
      await drive.files.update({
        fileId,
        requestBody: { name: `${note.title} (Legacy)` }
      });
    }
  }
}
```

### 2. Tab Sync Implementation
Track individual tab revisions for efficient sync:

```javascript
// Extended mapping for notebook sync
type NotebookBinding = {
  fileId: string;                    // Multi-tab doc ID
  tabRevisions: {                    // Track each tab
    [noteId: string]: {
      tabId: string;
      lastRevisionId: string;
      lastSyncTs: number;
    }
  };
};

// Sync only changed tab
async function syncNotebookTab(notebookBinding, noteId, note) {
  const tabInfo = notebookBinding.tabRevisions[noteId];
  
  // Check if tab needs sync
  if (note.updated_time > tabInfo.lastSyncTs) {
    await updateSingleTab(notebookBinding.fileId, tabInfo.tabId, note);
    tabInfo.lastSyncTs = Date.now();
  }
}
```

### 3. Right-Click Menu Implementation
```javascript
// In runtime/index.js
await j.commands.register({
  name: 'gdocsExportNotebook',
  label: 'Google Docs Sync: Export Notebook',
  execute: async () => {
    const folder = await j.workspace.selectedFolder();
    if (!folder) {
      await j.views.dialogs.showMessageBox('Please select a notebook first');
      return;
    }
    
    const mod = require(path.join(installDir, 'dist/commands/exportNotebook.js'));
    await mod.exportNotebook({ j, installDir, dataDir, folderId: folder.id });
  },
});

// Register in folder context menu
await j.views.menuItems.create('notebookExportMenu', 'exportNotebook', {
  label: 'Export as Multi-tab Google Doc',
  commandName: 'gdocsExportNotebook',
}, MenuItemLocation.FolderContextMenu);
```

## Next Steps

1. ✅ Design decisions made
2. Implement Phase 1 (infrastructure) - extend mapping types
3. Create `exportNotebook.ts` with legacy migration
4. Add tab ordering by `user_created_time`
5. Implement single-tab sync for performance
6. Add right-click menu integration
7. Test with notebooks of various sizes
