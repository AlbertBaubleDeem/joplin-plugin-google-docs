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
import * as fs from 'fs';
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
    // Must specify fields explicitly - Joplin API doesn't return all fields by default
    const resource = await j.data.get(['resources', resourceId], { fields: ['id', 'mime', 'filename', 'size'] });
    return resource;
  } catch (error) {
    console.error(`[imageHandler] Failed to get resource ${resourceId}:`, error);
    return null;
  }
}

/**
 * Get resource binary data from Joplin as base64
 */
export async function getResourceData(j: any, resourceId: string, debugLog?: (msg: string) => void): Promise<string | null> {
  const log = debugLog || (() => {});
  
  try {
    // Try workspace.resourcePath API first (more reliable)
    try {
      log(`    Trying workspace.resourcePath...`);
      const resourcePath = await j.workspace.resourcePath(resourceId);
      log(`    Path: ${resourcePath}`);
      if (resourcePath) {
        const fs = require('fs');
        if (fs.existsSync(resourcePath)) {
          const data = fs.readFileSync(resourcePath);
          log(`    Read ${data.length} bytes from file`);
          return data.toString('base64');
        } else {
          log(`    File does not exist at path`);
        }
      }
    } catch (e: any) {
      log(`    Workspace API error: ${e?.message}`);
    }
    
    // Fallback to data API
    try {
      log(`    Trying data.get file API...`);
      const resourceData = await j.data.get(['resources', resourceId, 'file']);
      log(`    Got response type: ${typeof resourceData}, isBuffer: ${Buffer.isBuffer(resourceData)}`);
      
      if (typeof resourceData === 'string') {
        log(`    String length: ${resourceData.length}`);
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
        log(`    Buffer-like object with ${resourceData.data.length} bytes`);
        return Buffer.from(resourceData.data).toString('base64');
      } else if (resourceData?.type === 'attachment' && resourceData?.body) {
        // Joplin returns {type: 'attachment', body: {0: byte, 1: byte, ...}}
        const body = resourceData.body;
        const keys = Object.keys(body).map(k => parseInt(k, 10)).sort((a, b) => a - b);
        log(`    Attachment format, ${keys.length} keys, max key: ${keys[keys.length - 1]}`);
        const bytes = keys.map(k => body[k]);
        log(`    Extracted ${bytes.length} bytes, first 4: [${bytes.slice(0, 4).join(', ')}]`);
        const buffer = Buffer.from(bytes);
        log(`    Buffer size: ${buffer.length} bytes`);
        const base64 = buffer.toString('base64');
        log(`    Base64 length: ${base64.length} chars`);
        return base64;
      } else {
        log(`    Unknown data format: ${JSON.stringify(resourceData)?.substring(0, 100)}`);
      }
    } catch (error: any) {
      log(`    Data API error: ${error?.message}`);
    }
    
    return null;
  } catch (error: any) {
    log(`    Fatal error: ${error?.message}`);
    return null;
  }
}

/**
 * Supported image formats for Google Docs API
 * Only JPEG, PNG, and non-animated GIF are supported
 */
const SUPPORTED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
]);

/**
 * Check if a MIME type is supported by Google Docs
 */
function isSupportedFormat(mimeType: string): boolean {
  return SUPPORTED_MIME_TYPES.has(mimeType);
}

/**
 * Get file extension from MIME type
 */
function getExtensionFromMime(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
  };
  return mimeToExt[mimeType] || 'png';
}

/**
 * Generate a unique object name for GCS
 */
function generateUniqueObjectName(resourceId: string, mimeType?: string, originalFilename?: string): string {
  // Prefer extension from MIME type, then from filename, then default to png
  let ext = 'png';
  if (mimeType) {
    ext = getExtensionFromMime(mimeType);
  } else if (originalFilename) {
    ext = originalFilename.split('.').pop() || 'png';
  }
  
  const timestamp = Date.now();
  const randomBytes = crypto.randomBytes(8).toString('hex');
  return `joplin_${timestamp}_${randomBytes}_${resourceId.substring(0, 8)}.${ext}`;
}

/**
 * Upload an image to Google Cloud Storage
 * 
 * @param auth - Google OAuth2 client
 * @param storage - Google Storage API client (for ACL calls)
 * @param bucketName - GCS bucket name
 * @param imageData - Base64 encoded image data
 * @param objectName - Object name in the bucket
 * @param mimeType - MIME type of the image
 * @returns Public URL of the uploaded image
 */
export async function uploadImageToGCS(
  auth: any,
  storage: any,
  bucketName: string,
  imageData: string,
  objectName: string,
  mimeType: string,
  debugLog?: (msg: string) => void
): Promise<string> {
  const log = debugLog || (() => {});
  
  // Validate input
  if (!imageData) {
    throw new Error('No image data provided');
  }
  if (!bucketName) {
    throw new Error('No GCS bucket name provided');
  }
  
  // Convert base64 to buffer
  const buffer = Buffer.from(imageData, 'base64');
  log(`    Buffer created: ${buffer.length} bytes`);
  if (buffer.length === 0) {
    throw new Error('Image buffer is empty');
  }
  
  // Use direct HTTP upload - googleapis streams don't work in Joplin sandbox
  log(`    Using direct HTTP upload...`);
  
  // Get access token from the auth client
  const accessToken = await auth.getAccessToken();
  log(`    Got access token: ${accessToken?.token ? 'yes' : 'no'}`);
  
  // GCS simple upload endpoint
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucketName)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
  
  // Use Node's https module directly
  const https = require('https');
  const { URL } = require('url');
  
  const uploadResult = await new Promise<{ size: number }>((resolve, reject) => {
    const url = new URL(uploadUrl);
    
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken.token}`,
        'Content-Type': mimeType || 'image/png',
        'Content-Length': buffer.length,
      },
    };
    
    log(`    POST to ${url.hostname}${url.pathname}...`);
    
    const req = https.request(options, (res: any) => {
      let data = '';
      res.on('data', (chunk: any) => { data += chunk; });
      res.on('end', () => {
        log(`    Response status: ${res.statusCode}`);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const json = JSON.parse(data);
            log(`    Uploaded size: ${json.size}`);
            resolve({ size: parseInt(json.size, 10) });
          } catch (e) {
            log(`    Parse error: ${e}`);
            resolve({ size: 0 });
          }
        } else {
          log(`    Upload failed: ${data.substring(0, 200)}`);
          reject(new Error(`Upload failed: ${res.statusCode} - ${data.substring(0, 200)}`));
        }
      });
    });
    
    req.on('error', (e: any) => {
      log(`    Request error: ${e.message}`);
      reject(e);
    });
    
    // Write the buffer directly
    req.write(buffer);
    req.end();
  });
  
  log(`    Direct upload completed, size: ${uploadResult.size}`);
  
  console.log(`[imageHandler] Uploaded: ${objectName}`);
  
  // Make object temporarily public
  log(`    Setting public ACL...`);
  await storage.objectAccessControls.insert({
    bucket: bucketName,
    object: objectName,
    requestBody: {
      entity: 'allUsers',
      role: 'READER',
    },
  });
  
  log(`    Made public: ${objectName}`);
  
  // Wait for ACL propagation - GCS can take 1-2 seconds to propagate ACL changes
  log(`    Waiting 2s for ACL propagation...`);
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Build public URL
  const publicUrl = `https://storage.googleapis.com/${bucketName}/${encodeURIComponent(objectName)}`;
  log(`    Public URL: ${publicUrl}`);
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
  auth: any,
  storage: any,
  bucketName: string,
  imageRanges: ImageRange[],
  debugLog?: (msg: string) => void
): Promise<ProcessImagesResult> {
  const log = debugLog || (() => {});
  const resourceIdToUrl = new Map<string, string>();
  const uploadedObjects: GCSUploadResult[] = [];
  
  log(`processImages: ${imageRanges.length} images, bucket: ${bucketName}`);
  
  for (let i = 0; i < imageRanges.length; i++) {
    const imageRange = imageRanges[i];
    log(`Image ${i + 1}/${imageRanges.length}: ${imageRange.resourceId}`);
    
    try {
      // Get resource info
      const resource = await getResourceInfo(j, imageRange.resourceId);
      if (!resource) {
        log(`  SKIP: Resource not found`);
        continue;
      }
      log(`  Resource: ${resource.filename}, mime=${resource.mime}`);
      
      // Check if format is supported by Google Docs
      const mimeType = resource.mime || 'image/png';
      if (!isSupportedFormat(mimeType)) {
        log(`  SKIP: Unsupported format ${mimeType} - Google Docs only supports PNG, JPEG, GIF`);
        continue;
      }
      
      // Get resource data
      const imageData = await getResourceData(j, imageRange.resourceId, log);
      if (!imageData) {
        log(`  SKIP: Could not get data`);
        continue;
      }
      log(`  Data: ${imageData.length} chars`);
      
      // Validate base64 data
      if (typeof imageData !== 'string' || imageData.length === 0) {
        log(`  SKIP: Invalid data type or empty`);
        continue;
      }
      
      // Generate unique object name using MIME type for correct extension
      const objectName = generateUniqueObjectName(imageRange.resourceId, mimeType, resource.filename);
      log(`  Uploading: ${objectName}`);
      
      // Upload to GCS using auth directly
      const publicUrl = await uploadImageToGCS(
        auth,
        storage,
        bucketName,
        imageData,
        objectName,
        mimeType,
        log
      );
      log(`  SUCCESS: ${publicUrl}`);
      
      resourceIdToUrl.set(imageRange.resourceId, publicUrl);
      uploadedObjects.push({
        objectName,
        publicUrl,
        resourceId: imageRange.resourceId,
      });
      
    } catch (error: any) {
      log(`  ERROR: ${error?.message || error}`);
    }
  }
  
  log(`processImages complete: ${uploadedObjects.length} uploaded`);
  return { resourceIdToUrl, uploadedObjects };
}

/**
 * Build Docs API requests to insert images
 */
export function buildImageInsertRequests(
  imageRanges: ImageRange[],
  resourceIdToUrl: Map<string, string>,
  textOffset: number = 0,
  debugLog?: (msg: string) => void
): any[] {
  const log = debugLog || (() => {});
  const requests: any[] = [];
  
  log(`Building insert requests for ${imageRanges.length} images`);
  
  // Sort images by position in reverse order (insert from end to start)
  // This preserves positions as we insert
  const sortedImages = [...imageRanges].sort((a, b) => b.position - a.position);
  
  for (const imageRange of sortedImages) {
    const publicUrl = resourceIdToUrl.get(imageRange.resourceId);
    if (!publicUrl) {
      log(`  No URL for resource ${imageRange.resourceId}`);
      continue;
    }
    
    // Calculate insertion position (+1 for Docs API 1-based indexing)
    const insertPosition = imageRange.position + textOffset + 1;
    log(`  Image at pos ${insertPosition}: ${publicUrl}`);
    
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
