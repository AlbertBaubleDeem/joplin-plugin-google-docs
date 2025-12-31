/**
 * Image Handler for Google Docs Sync
 * 
 * Handles uploading Joplin resource images to Google Cloud Storage (GCS)
 * and inserting them into Google Docs.
 * 
 * Uses GCS instead of Google Drive because:
 * - Google Workspace domain policies often block public Drive sharing
 * - GCS allows temporary public access that works reliably with Docs API
 * - Bucket lifecycle policies handle automatic cleanup
 * 
 * Security:
 * - Images are public only for the brief moment needed for Docs API to fetch
 * - Public access is revoked immediately after insertion
 * - Objects use random UUIDs to prevent URL guessing
 * - Bucket lifecycle deletes objects after 1 day as backup
 */

import * as crypto from 'crypto';
import { ImageRange } from './converter/types';

export interface JoplinResource {
  id: string;
  mime?: string;
  filename?: string;
  size?: number;
}

export interface GCSUploadResult {
  /** GCS object name (for cleanup) */
  objectName: string;
  /** Public URL for Docs API */
  publicUrl: string;
  /** Joplin resource ID */
  resourceId: string;
}

export interface ProcessImagesResult {
  /** Map of resourceId -> public URL */
  resourceIdToUrl: Map<string, string>;
  /** List of uploaded objects for cleanup */
  uploadedObjects: GCSUploadResult[];
}

/**
 * Get resource metadata from Joplin
 */
export async function getResourceInfo(j: any, resourceId: string): Promise<JoplinResource | null> {
  try {
    const resource = await j.data.get(['resources', resourceId]);
    return resource;
  } catch (error) {
    console.error(`[imageHandler] Failed to get resource ${resourceId}:`, error);
    return null;
  }
}

/**
 * Get resource binary data from Joplin as base64
 */
export async function getResourceData(j: any, resourceId: string): Promise<string | null> {
  try {
    // Try workspace.resourcePath API first (more reliable)
    try {
      const resourcePath = await j.workspace.resourcePath(resourceId);
      if (resourcePath) {
        const fs = require('fs');
        const data = fs.readFileSync(resourcePath);
        return data.toString('base64');
      }
    } catch (e: any) {
      console.warn(`[imageHandler] Workspace API failed for ${resourceId}:`, e?.message);
    }
    
    // Fallback to data API
    try {
      const resourceData = await j.data.get(['resources', resourceId, 'file']);
      
      if (typeof resourceData === 'string') {
        if (resourceData.match(/^[A-Za-z0-9+/]+=*$/)) {
          return resourceData;
        }
        if (resourceData.startsWith('data:')) {
          return resourceData.split(',')[1];
        }
        return resourceData;
      } else if (Buffer.isBuffer(resourceData)) {
        return resourceData.toString('base64');
      } else if (resourceData?.type === 'Buffer' && Array.isArray(resourceData.data)) {
        return Buffer.from(resourceData.data).toString('base64');
      }
    } catch (error: any) {
      console.error(`[imageHandler] Data API failed for ${resourceId}:`, error?.message);
    }
    
    return null;
  } catch (error: any) {
    console.error(`[imageHandler] Failed to get resource data ${resourceId}:`, error?.message);
    return null;
  }
}

/**
 * Generate a unique object name for GCS
 */
function generateUniqueObjectName(resourceId: string, originalFilename?: string): string {
  const ext = originalFilename ? originalFilename.split('.').pop() || 'png' : 'png';
  const timestamp = Date.now();
  const randomBytes = crypto.randomBytes(8).toString('hex');
  return `joplin_${timestamp}_${randomBytes}_${resourceId.substring(0, 8)}.${ext}`;
}

/**
 * Upload an image to Google Cloud Storage
 * 
 * @param storage - Google Storage API client
 * @param bucketName - GCS bucket name
 * @param imageData - Base64 encoded image data
 * @param objectName - Object name in the bucket
 * @param mimeType - MIME type of the image
 * @returns Public URL of the uploaded image
 */
export async function uploadImageToGCS(
  storage: any,
  bucketName: string,
  imageData: string,
  objectName: string,
  mimeType: string
): Promise<string> {
  // Validate input
  if (!imageData) {
    throw new Error('No image data provided');
  }
  if (!bucketName) {
    throw new Error('No GCS bucket name provided');
  }
  
  // Convert base64 to buffer
  const buffer = Buffer.from(imageData, 'base64');
  if (buffer.length === 0) {
    throw new Error('Image buffer is empty');
  }
  
  console.log(`[imageHandler] Uploading ${objectName} to GCS bucket ${bucketName} (${buffer.length} bytes)`);
  
  // Create readable stream from buffer
  const { Readable } = require('stream');
  const stream = Readable.from(buffer);
  
  // Upload to GCS
  await storage.objects.insert({
    bucket: bucketName,
    name: objectName,
    media: {
      mimeType: mimeType || 'image/png',
      body: stream,
    },
    requestBody: {
      name: objectName,
      contentType: mimeType || 'image/png',
      metadata: {
        source: 'joplin-google-docs-plugin',
      },
    },
  });
  
  console.log(`[imageHandler] Uploaded: ${objectName}`);
  
  // Make object temporarily public
  await storage.objectAccessControls.insert({
    bucket: bucketName,
    object: objectName,
    requestBody: {
      entity: 'allUsers',
      role: 'READER',
    },
  });
  
  console.log(`[imageHandler] Made public: ${objectName}`);
  
  // Build public URL
  const publicUrl = `https://storage.googleapis.com/${bucketName}/${encodeURIComponent(objectName)}`;
  return publicUrl;
}

/**
 * Revoke public access from a GCS object
 */
export async function revokePublicAccess(
  storage: any,
  bucketName: string,
  objectName: string
): Promise<void> {
  try {
    await storage.objectAccessControls.delete({
      bucket: bucketName,
      object: objectName,
      entity: 'allUsers',
    });
    console.log(`[imageHandler] Revoked public access: ${objectName}`);
  } catch (error: any) {
    // Don't fail if cleanup fails - bucket lifecycle will handle it
    console.warn(`[imageHandler] Failed to revoke access for ${objectName}:`, error?.message);
  }
}

/**
 * Clean up public access for all uploaded images
 * Call this after images have been inserted into the doc
 */
export async function cleanupImageAccess(
  storage: any,
  bucketName: string,
  uploadedObjects: GCSUploadResult[]
): Promise<void> {
  console.log(`[imageHandler] Cleaning up ${uploadedObjects.length} uploaded objects`);
  
  for (const obj of uploadedObjects) {
    await revokePublicAccess(storage, bucketName, obj.objectName);
  }
  
  console.log(`[imageHandler] Cleanup complete`);
}

/**
 * Process all images in a note - upload to GCS and return URLs
 */
export async function processImages(
  j: any,
  storage: any,
  bucketName: string,
  imageRanges: ImageRange[]
): Promise<ProcessImagesResult> {
  const resourceIdToUrl = new Map<string, string>();
  const uploadedObjects: GCSUploadResult[] = [];
  
  for (const imageRange of imageRanges) {
    try {
      // Get resource info
      const resource = await getResourceInfo(j, imageRange.resourceId);
      if (!resource) {
        console.warn(`[imageHandler] Resource ${imageRange.resourceId} not found`);
        continue;
      }
      
      // Get resource data
      const imageData = await getResourceData(j, imageRange.resourceId);
      if (!imageData) {
        console.warn(`[imageHandler] Could not get data for resource ${imageRange.resourceId}`);
        continue;
      }
      
      // Validate base64 data
      if (typeof imageData !== 'string' || imageData.length === 0) {
        console.warn(`[imageHandler] Invalid image data for ${imageRange.resourceId}`);
        continue;
      }
      
      // Generate unique object name
      const objectName = generateUniqueObjectName(imageRange.resourceId, resource.filename);
      const mimeType = resource.mime || 'image/png';
      
      // Upload to GCS
      const publicUrl = await uploadImageToGCS(
        storage,
        bucketName,
        imageData,
        objectName,
        mimeType
      );
      
      resourceIdToUrl.set(imageRange.resourceId, publicUrl);
      uploadedObjects.push({
        objectName,
        publicUrl,
        resourceId: imageRange.resourceId,
      });
      
      console.log(`[imageHandler] Processed ${resource.filename || imageRange.resourceId} -> ${publicUrl}`);
      
    } catch (error: any) {
      console.error(`[imageHandler] Error processing image ${imageRange.resourceId}:`, error?.message);
    }
  }
  
  return { resourceIdToUrl, uploadedObjects };
}

/**
 * Build Docs API requests to insert images
 */
export function buildImageInsertRequests(
  imageRanges: ImageRange[],
  resourceIdToUrl: Map<string, string>,
  textOffset: number = 0
): any[] {
  const requests: any[] = [];
  
  console.log(`[imageHandler] Building insert requests for ${imageRanges.length} images`);
  
  // Sort images by position in reverse order (insert from end to start)
  // This preserves positions as we insert
  const sortedImages = [...imageRanges].sort((a, b) => b.position - a.position);
  
  for (const imageRange of sortedImages) {
    const publicUrl = resourceIdToUrl.get(imageRange.resourceId);
    if (!publicUrl) {
      console.warn(`[imageHandler] No URL for resource ${imageRange.resourceId}`);
      continue;
    }
    
    // Calculate insertion position (+1 for Docs API 1-based indexing)
    const insertPosition = imageRange.position + textOffset + 1;
    
    requests.push({
      insertInlineImage: {
        location: { 
          index: insertPosition 
        },
        uri: publicUrl,
        // Let Docs API determine size from image, or could add objectSize here
      }
    });
    
    console.log(`[imageHandler] Insert at ${insertPosition}: ${publicUrl}`);
  }
  
  console.log(`[imageHandler] Built ${requests.length} insert requests`);
  return requests;
}
