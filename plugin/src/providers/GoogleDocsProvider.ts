/**
 * GoogleDocsProvider - Google Docs implementation of IDocumentProvider
 * 
 * This provider implements document operations using the Google Drive and
 * Google Docs APIs.
 */

import {
  IDocumentProvider,
  DocumentMetadata,
  DocumentWithContent,
  CreateDocumentResult,
  UpdateDocumentResult,
  FolderMetadata,
  DocumentBinding,
} from './IDocumentProvider';
import { SyncContext } from '../services/syncContext';
import { ensureSyncFolder } from '../services/syncFolderManager';
import {
  appPropertyNoteId,
  appPropertyPluginId,
  appPropertyVersion,
  pluginId,
} from '../mapping';

/** App property key for notebook ID */
const appPropertyNotebookId = 'joplinNotebookId';

/**
 * Google Docs implementation of the document provider interface.
 * 
 * Uses Google Drive API for file operations and Google Docs API for
 * document content operations.
 */
export class GoogleDocsProvider implements IDocumentProvider {
  readonly providerName = 'google-docs';

  private drive: any;
  private docs: any;
  private dataDir: string;
  private joplin: any;

  /**
   * Creates a new GoogleDocsProvider.
   * 
   * @param ctx - SyncContext with authenticated API clients
   * @param joplin - Optional Joplin API object for settings access
   */
  constructor(ctx: SyncContext, joplin?: any) {
    this.drive = ctx.drive;
    this.docs = ctx.docs;
    this.dataDir = ctx.dataDir;
    this.joplin = joplin;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Document Operations
  // ═══════════════════════════════════════════════════════════════════════════

  async createDocument(title: string, parentFolderId?: string): Promise<CreateDocumentResult> {
    const requestBody: any = {
      name: title,
      mimeType: 'application/vnd.google-apps.document',
    };

    if (parentFolderId) {
      requestBody.parents = [parentFolderId];
    }

    const response = await this.drive.files.create({
      requestBody,
      fields: 'id,name,modifiedTime',
      supportsAllDrives: true,
    });

    const metadata: DocumentMetadata = {
      id: response.data.id,
      title: response.data.name,
      modifiedTime: response.data.modifiedTime ? new Date(response.data.modifiedTime) : undefined,
      parentId: parentFolderId,
    };

    return { metadata, created: true };
  }

  async getDocument(docId: string): Promise<DocumentWithContent> {
    // Get document content with tabs support
    const docResponse = await this.docs.documents.get({
      documentId: docId,
      includeTabsContent: true,
    });

    // Get file metadata from Drive for modifiedTime
    const fileResponse = await this.drive.files.get({
      fileId: docId,
      fields: 'id,name,modifiedTime',
      supportsAllDrives: true,
    });

    // Extract content from tabs (first tab) or body
    let content: any[] = [];
    const tabs = docResponse.data.tabs;
    if (Array.isArray(tabs) && tabs.length > 0) {
      const firstTab = tabs[0];
      content = firstTab?.documentTab?.body?.content || [];
    } else {
      content = docResponse.data.body?.content || [];
    }

    const metadata: DocumentMetadata = {
      id: docId,
      title: docResponse.data.title || fileResponse.data.name,
      revisionId: docResponse.data.revisionId,
      modifiedTime: fileResponse.data.modifiedTime
        ? new Date(fileResponse.data.modifiedTime)
        : undefined,
    };

    return { metadata, content };
  }

  async getDocumentMetadata(docId: string): Promise<DocumentMetadata> {
    const [docResponse, fileResponse] = await Promise.all([
      this.docs.documents.get({ documentId: docId }),
      this.drive.files.get({
        fileId: docId,
        fields: 'id,name,modifiedTime,parents',
        supportsAllDrives: true,
      }),
    ]);

    return {
      id: docId,
      title: docResponse.data.title || fileResponse.data.name,
      revisionId: docResponse.data.revisionId,
      modifiedTime: fileResponse.data.modifiedTime
        ? new Date(fileResponse.data.modifiedTime)
        : undefined,
      parentId: fileResponse.data.parents?.[0],
    };
  }

  async updateDocument(
    docId: string,
    content: { plainText: string; requests?: any[] },
    revisionId?: string
  ): Promise<UpdateDocumentResult> {
    // Get current document state
    const docResponse = await this.docs.documents.get({ documentId: docId });
    const body = docResponse.data.body || {};
    const bodyContent = Array.isArray(body.content) ? body.content : [];
    const endIndex = bodyContent.length
      ? Number(bodyContent[bodyContent.length - 1].endIndex || 1)
      : 1;

    // Build content replacement requests
    const requests: any[] = [];

    // Delete existing content (avoid empty range)
    if (endIndex > 2) {
      requests.push({
        deleteContentRange: {
          range: { startIndex: 1, endIndex: endIndex - 1 },
        },
      });
    }

    // Insert new content
    requests.push({
      insertText: {
        location: { index: 1 },
        text: content.plainText,
      },
    });

    // Execute with optimistic concurrency
    await this.docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests,
        writeControl: revisionId ? { requiredRevisionId: revisionId } : undefined,
      },
    });

    // Apply formatting requests if provided
    if (content.requests && content.requests.length > 0) {
      await this.docs.documents.batchUpdate({
        documentId: docId,
        requestBody: { requests: content.requests },
      });
    }

    // Get new revision ID
    const afterResponse = await this.docs.documents.get({ documentId: docId });
    const newRevisionId = String(afterResponse.data.revisionId || '');

    return { newRevisionId, contentChanged: true };
  }

  async deleteDocument(docId: string): Promise<void> {
    await this.drive.files.delete({
      fileId: docId,
      supportsAllDrives: true,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Folder Operations
  // ═══════════════════════════════════════════════════════════════════════════

  async ensureSyncFolder(): Promise<string> {
    return ensureSyncFolder(this.drive, this.dataDir, { joplin: this.joplin });
  }

  async createFolder(name: string, parentId?: string): Promise<FolderMetadata> {
    const requestBody: any = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };

    if (parentId) {
      requestBody.parents = [parentId];
    }

    const response = await this.drive.files.create({
      requestBody,
      fields: 'id,name',
      supportsAllDrives: true,
    });

    return {
      id: response.data.id,
      name: response.data.name,
      parentId,
    };
  }

  async listDocumentsInFolder(
    folderId: string,
    options: { pageSize?: number; pageToken?: string } = {}
  ): Promise<{ documents: DocumentMetadata[]; nextPageToken?: string }> {
    const response = await this.drive.files.list({
      q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.document' and trashed=false`,
      fields: 'nextPageToken,files(id,name,modifiedTime)',
      pageSize: options.pageSize || 100,
      pageToken: options.pageToken,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });

    const documents: DocumentMetadata[] = (response.data.files || []).map((f: any) => ({
      id: f.id,
      title: f.name,
      modifiedTime: f.modifiedTime ? new Date(f.modifiedTime) : undefined,
      parentId: folderId,
    }));

    return {
      documents,
      nextPageToken: response.data.nextPageToken,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Binding Operations
  // ═══════════════════════════════════════════════════════════════════════════

  async setDocumentBinding(docId: string, binding: DocumentBinding): Promise<void> {
    const appProperties: Record<string, string> = {
      [appPropertyNoteId]: binding.noteId,
      [appPropertyPluginId]: binding.pluginId || pluginId,
    };

    if (binding.notebookId) {
      appProperties[appPropertyNotebookId] = binding.notebookId;
    }

    if (binding.version) {
      appProperties[appPropertyVersion] = binding.version;
    }

    await this.drive.files.update({
      fileId: docId,
      requestBody: { appProperties },
      fields: 'id,appProperties',
      supportsAllDrives: true,
    });
  }

  async getDocumentBinding(docId: string): Promise<DocumentBinding | null> {
    try {
      const response = await this.drive.files.get({
        fileId: docId,
        fields: 'id,appProperties',
        supportsAllDrives: true,
      });

      const appProps = response.data.appProperties || {};
      const noteId = appProps[appPropertyNoteId];

      if (!noteId) {
        return null;
      }

      return {
        noteId,
        notebookId: appProps[appPropertyNotebookId],
        pluginId: appProps[appPropertyPluginId],
        version: appProps[appPropertyVersion],
      };
    } catch (error) {
      // Return null if we can't access the file's properties
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Change Detection
  // ═══════════════════════════════════════════════════════════════════════════

  async getRevisionId(docId: string): Promise<string | undefined> {
    try {
      const response = await this.docs.documents.get({ documentId: docId });
      return response.data.revisionId || undefined;
    } catch (error) {
      return undefined;
    }
  }

  async hasDocumentChanged(docId: string, knownRevisionId: string): Promise<boolean> {
    const currentRevision = await this.getRevisionId(docId);
    return currentRevision !== knownRevisionId;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Google Docs-Specific Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Applies additional formatting requests to a document.
   * This is Google Docs-specific and not part of the interface.
   * 
   * @param docId - Document ID
   * @param requests - Array of batchUpdate requests
   */
  async applyFormattingRequests(docId: string, requests: any[]): Promise<void> {
    if (requests.length > 0) {
      await this.docs.documents.batchUpdate({
        documentId: docId,
        requestBody: { requests },
      });
    }
  }

  /**
   * Updates app properties on a document (used for sync metadata).
   * 
   * @param docId - Document ID
   * @param properties - Properties to set
   */
  async updateAppProperties(
    docId: string,
    properties: Record<string, string>
  ): Promise<void> {
    await this.drive.files.update({
      fileId: docId,
      requestBody: { appProperties: properties },
      fields: 'id,appProperties',
      supportsAllDrives: true,
    });
  }

  /**
   * Moves a document to a folder.
   * 
   * @param docId - Document ID
   * @param folderId - Target folder ID
   */
  async moveToFolder(docId: string, folderId: string): Promise<void> {
    await this.drive.files.update({
      fileId: docId,
      addParents: folderId,
      fields: 'id,parents',
      supportsAllDrives: true,
    });
  }
}

