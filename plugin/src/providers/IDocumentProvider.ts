/**
 * IDocumentProvider - Provider-agnostic document operations interface
 * 
 * This interface abstracts cloud document operations, allowing the plugin
 * to work with different backends (Google Docs, DOCX export, OneDrive, etc.)
 * without changing the core sync logic.
 */

/**
 * Metadata about a document
 */
export interface DocumentMetadata {
  /** Provider-specific document ID (e.g., Google Docs fileId) */
  id: string;
  /** Document title/name */
  title: string;
  /** Revision/version ID for optimistic concurrency */
  revisionId?: string;
  /** Last modification time */
  modifiedTime?: Date;
  /** Parent folder ID (if applicable) */
  parentId?: string;
}

/**
 * Document content with metadata
 */
export interface DocumentWithContent {
  /** Document metadata */
  metadata: DocumentMetadata;
  /** 
   * Raw document content in provider-native format
   * For Google Docs: the body.content array
   * For DOCX: could be parsed XML or structured data
   */
  content: any;
}

/**
 * Result of creating a document
 */
export interface CreateDocumentResult {
  /** The created document's metadata */
  metadata: DocumentMetadata;
  /** Whether the document was newly created (vs already existed) */
  created: boolean;
}

/**
 * Result of updating a document
 */
export interface UpdateDocumentResult {
  /** The new revision ID after update */
  newRevisionId: string;
  /** Whether content was actually changed */
  contentChanged: boolean;
}

/**
 * Folder metadata
 */
export interface FolderMetadata {
  /** Provider-specific folder ID */
  id: string;
  /** Folder name */
  name: string;
  /** Parent folder ID (if nested) */
  parentId?: string;
}

/**
 * Binding information stored on the document (provider-side metadata)
 */
export interface DocumentBinding {
  /** Joplin note ID bound to this document */
  noteId: string;
  /** Joplin notebook ID (if bound as part of notebook export) */
  notebookId?: string;
  /** Plugin identifier */
  pluginId?: string;
  /** Binding version for migration support */
  version?: string;
}

/**
 * Interface for document provider implementations.
 * 
 * Providers abstract the storage and retrieval of documents,
 * allowing the sync logic to work with different backends.
 * 
 * @example Google Docs Provider
 * ```typescript
 * class GoogleDocsProvider implements IDocumentProvider {
 *   providerName = 'google-docs';
 *   // ... implementation using Google Docs API
 * }
 * ```
 * 
 * @example DOCX Provider (future)
 * ```typescript
 * class DocxProvider implements IDocumentProvider {
 *   providerName = 'docx';
 *   // ... implementation for local DOCX files
 * }
 * ```
 */
export interface IDocumentProvider {
  /** Unique provider identifier */
  readonly providerName: string;

  // ═══════════════════════════════════════════════════════════════════════════
  // Document Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Creates a new document.
   * 
   * @param title - Document title
   * @param parentFolderId - Optional parent folder ID
   * @returns Promise resolving to creation result
   */
  createDocument(title: string, parentFolderId?: string): Promise<CreateDocumentResult>;

  /**
   * Gets a document by ID, including its content.
   * 
   * @param docId - Provider-specific document ID
   * @returns Promise resolving to document with content
   */
  getDocument(docId: string): Promise<DocumentWithContent>;

  /**
   * Gets only document metadata (without content).
   * More efficient when content is not needed.
   * 
   * @param docId - Provider-specific document ID
   * @returns Promise resolving to document metadata
   */
  getDocumentMetadata(docId: string): Promise<DocumentMetadata>;

  /**
   * Updates a document's content.
   * 
   * @param docId - Provider-specific document ID
   * @param content - New content in provider-native format
   * @param revisionId - Optional revision ID for optimistic concurrency
   * @returns Promise resolving to update result
   */
  updateDocument(
    docId: string,
    content: any,
    revisionId?: string
  ): Promise<UpdateDocumentResult>;

  /**
   * Deletes a document.
   * 
   * @param docId - Provider-specific document ID
   * @returns Promise resolving when deletion is complete
   */
  deleteDocument(docId: string): Promise<void>;

  // ═══════════════════════════════════════════════════════════════════════════
  // Folder Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Ensures the sync folder exists, creating it if necessary.
   * 
   * @returns Promise resolving to the sync folder ID
   */
  ensureSyncFolder(): Promise<string>;

  /**
   * Creates a folder.
   * 
   * @param name - Folder name
   * @param parentId - Optional parent folder ID
   * @returns Promise resolving to folder metadata
   */
  createFolder(name: string, parentId?: string): Promise<FolderMetadata>;

  /**
   * Lists documents in a folder.
   * 
   * @param folderId - Folder ID to list
   * @param options - Optional listing options
   * @returns Promise resolving to array of document metadata
   */
  listDocumentsInFolder(
    folderId: string,
    options?: { pageSize?: number; pageToken?: string }
  ): Promise<{ documents: DocumentMetadata[]; nextPageToken?: string }>;

  // ═══════════════════════════════════════════════════════════════════════════
  // Binding Operations (Provider-side metadata)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Sets binding information on a document.
   * For Google Docs, this uses appProperties.
   * For DOCX, this could use document custom properties or a sidecar file.
   * 
   * @param docId - Provider-specific document ID
   * @param binding - Binding information to set
   * @returns Promise resolving when binding is set
   */
  setDocumentBinding(docId: string, binding: DocumentBinding): Promise<void>;

  /**
   * Gets binding information from a document.
   * 
   * @param docId - Provider-specific document ID
   * @returns Promise resolving to binding info or null if not bound
   */
  getDocumentBinding(docId: string): Promise<DocumentBinding | null>;

  // ═══════════════════════════════════════════════════════════════════════════
  // Change Detection
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Gets the current revision/version ID of a document.
   * Used for change detection and optimistic concurrency.
   * 
   * @param docId - Provider-specific document ID
   * @returns Promise resolving to revision ID or undefined
   */
  getRevisionId(docId: string): Promise<string | undefined>;

  /**
   * Checks if a document has changed since a known revision.
   * 
   * @param docId - Provider-specific document ID
   * @param knownRevisionId - Last known revision ID
   * @returns Promise resolving to true if document has changed
   */
  hasDocumentChanged(docId: string, knownRevisionId: string): Promise<boolean>;
}

/**
 * Base class providing common functionality for providers.
 * Providers can extend this or implement IDocumentProvider directly.
 */
export abstract class BaseDocumentProvider implements IDocumentProvider {
  abstract readonly providerName: string;

  abstract createDocument(title: string, parentFolderId?: string): Promise<CreateDocumentResult>;
  abstract getDocument(docId: string): Promise<DocumentWithContent>;
  abstract getDocumentMetadata(docId: string): Promise<DocumentMetadata>;
  abstract updateDocument(docId: string, content: any, revisionId?: string): Promise<UpdateDocumentResult>;
  abstract deleteDocument(docId: string): Promise<void>;
  abstract ensureSyncFolder(): Promise<string>;
  abstract createFolder(name: string, parentId?: string): Promise<FolderMetadata>;
  abstract listDocumentsInFolder(folderId: string, options?: { pageSize?: number; pageToken?: string }): Promise<{ documents: DocumentMetadata[]; nextPageToken?: string }>;
  abstract setDocumentBinding(docId: string, binding: DocumentBinding): Promise<void>;
  abstract getDocumentBinding(docId: string): Promise<DocumentBinding | null>;
  abstract getRevisionId(docId: string): Promise<string | undefined>;

  /**
   * Default implementation using getRevisionId.
   * Providers can override for more efficient implementations.
   */
  async hasDocumentChanged(docId: string, knownRevisionId: string): Promise<boolean> {
    const currentRevision = await this.getRevisionId(docId);
    return currentRevision !== knownRevisionId;
  }
}

