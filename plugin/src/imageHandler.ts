import { ImageRange } from './converter';

export interface JoplinResource {
  id: string;
  mime?: string;
  filename?: string;
  size?: number;
}

export async function getResourceInfo(j: any, resourceId: string): Promise<JoplinResource | null> {
  try {
    const resource = await j.data.get(['resources', resourceId]);
    return resource;
  } catch (error) {
    console.error(`Failed to get resource ${resourceId}:`, error);
    return null;
  }
}

export async function getResourceData(j: any, resourceId: string): Promise<string | null> {
  try {
    console.log(`Attempting to get resource data for ${resourceId}`);
    
    // Try workspace.resourcePath API first (more reliable)
    try {
      console.log('Trying workspace.resourcePath API...');
      const resourcePath = await j.workspace.resourcePath(resourceId);
      console.log(`Got resource path: ${resourcePath}`);
      
      if (!resourcePath) {
        console.log('Resource path is null/undefined');
        throw new Error('No resource path returned');
      }
      
      if (resourcePath) {
        try {
          const fs = require('fs').promises || require('fs');
          // Try async read first
          let data;
          if (fs.readFile) {
            data = await fs.readFile(resourcePath);
          } else {
            // Fallback to sync
            data = fs.readFileSync(resourcePath);
          }
          
          const base64 = data.toString('base64');
          console.log(`Read file from disk, base64 length: ${base64.length}`);
          return base64;
        } catch (fsError) {
          console.error('Failed to read file from disk:', fsError);
        }
      }
    } catch (e: any) {
      console.error('Workspace API failed:', e?.message || e);
    }
    
    // Try the data API as fallback
    try {
      const resourceData = await j.data.get(['resources', resourceId, 'file']);
      console.log(`Got resource data via data API, type: ${typeof resourceData}`);
      
      // Handle different response formats
      if (typeof resourceData === 'string') {
        // Check if it's already base64 or needs encoding
        if (resourceData.match(/^[A-Za-z0-9+/]+=*$/)) {
          return resourceData;
        }
        // If it's a data URL, extract the base64 part
        if (resourceData.startsWith('data:')) {
          const base64Part = resourceData.split(',')[1];
          return base64Part;
        }
        return resourceData;
      } else if (resourceData && resourceData.data) {
        // Might be wrapped in an object
        return resourceData.data;
      } else if (resourceData && resourceData.body) {
        // Another possible format
        return resourceData.body;
      } else if (Buffer.isBuffer(resourceData)) {
        // If it's a buffer, convert to base64
        return resourceData.toString('base64');
      } else if (typeof resourceData === 'object' && resourceData) {
        // Check if it has a buffer-like structure
        if (resourceData.type === 'Buffer' && Array.isArray(resourceData.data)) {
          // It's a JSON-serialized Buffer
          const buffer = Buffer.from(resourceData.data);
          return buffer.toString('base64');
        }
      }
      
      console.log('Unexpected resource data format:', typeof resourceData, resourceData);
    } catch (error: any) {
      console.error(`Failed to get resource data via data API:`, error?.message || error);
    }
    
    return null;
  } catch (error: any) {
    console.error(`Failed to get resource data ${resourceId}:`, error?.message || error);
    return null;
  }
}

export async function uploadImageToDrive(
  drive: any,
  imageData: string,
  fileName: string,
  mimeType: string,
  parentFolderId: string
): Promise<string | null> {
  try {
    console.log(`Uploading ${fileName} to Drive, mime: ${mimeType}`);
    
    // Validate input
    if (!imageData) {
      throw new Error('No image data provided');
    }
    
    if (!parentFolderId) {
      throw new Error('No parent folder ID provided');
    }
    
    // Convert base64 to buffer
    const buffer = Buffer.from(imageData, 'base64');
    console.log(`Buffer size: ${buffer.length} bytes`);
    
    if (buffer.length === 0) {
      throw new Error('Image buffer is empty');
    }
    
    // Create readable stream from buffer using the proper Node.js stream
    const { Readable } = require('stream');
    const stream = Readable.from(buffer);
    
    const fileMetadata = {
      name: fileName,
      parents: [parentFolderId],
      mimeType: mimeType || 'image/png',
    };
    
    const media = {
      mimeType: mimeType || 'image/png',
      body: stream,
    };
    
    console.log(`Calling drive.files.create with metadata:`, fileMetadata);
    
    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id,webContentLink',
      supportsAllDrives: true,
    });
    
    console.log(`Upload successful, Drive ID: ${response.data.id}`);
    
    // Make the image publicly accessible for embedding
    try {
      await drive.permissions.create({
        fileId: response.data.id,
        requestBody: {
          role: 'reader',
          type: 'anyone',
        },
      });
      console.log(`Made image ${response.data.id} publicly accessible`);
    } catch (permError) {
      console.error('Failed to set public permissions:', permError);
    }
    
    return response.data.id;
  } catch (error: any) {
    console.error('Failed to upload image to Drive:', error?.message || error);
    console.error('Full error:', error);
    // Rethrow to let caller handle with dialog
    throw error;
  }
}

export async function processImages(
  j: any,
  drive: any,
  imageRanges: ImageRange[],
  syncFolderId: string
): Promise<Map<string, string>> {
  const resourceIdToDriveId = new Map<string, string>();
  
  for (const imageRange of imageRanges) {
    try {
      // Get resource info
      const resource = await getResourceInfo(j, imageRange.resourceId);
      if (!resource) {
        console.warn(`Resource ${imageRange.resourceId} not found`);
        continue;
      }
      
      // Get resource data
      const imageData = await getResourceData(j, imageRange.resourceId);
      if (!imageData) {
        console.warn(`Could not get data for resource ${imageRange.resourceId}`);
        continue;
      }
      
      // Validate base64 data
      if (typeof imageData !== 'string' || imageData.length === 0) {
        console.warn(`Invalid image data for ${imageRange.resourceId}: type=${typeof imageData}, length=${imageData?.length}`);
        continue;
      }
      
      // Debug: check data format
      const dataPreview = imageData.substring(0, 50);
      const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(imageData);
      const isDataUrl = imageData.startsWith('data:');
      const isJson = imageData.startsWith('{');
      
      // Show one debug dialog for the first image
      if (imageRanges.indexOf(imageRange) === 0) {
        await j.views.dialogs.showMessageBox(
          `First image data check:\n` +
          `- Type: ${typeof imageData}\n` +
          `- Length: ${imageData.length}\n` +
          `- Is Base64: ${isBase64}\n` +
          `- Is Data URL: ${isDataUrl}\n` +
          `- Is JSON: ${isJson}\n` +
          `- Preview: ${dataPreview}...`
        );
      }
      
      
      // Upload to Drive
      const fileName = resource.filename || `joplin-image-${imageRange.resourceId}`;
      const mimeType = resource.mime || 'image/png';
      
      try {
        const driveId = await uploadImageToDrive(
          drive, 
          imageData, 
          fileName, 
          mimeType, 
          syncFolderId
        );
        
        if (driveId) {
          resourceIdToDriveId.set(imageRange.resourceId, driveId);
          console.log(`Successfully uploaded ${fileName} -> ${driveId}`);
        }
      } catch (uploadError: any) {
        console.error(`Upload error for ${fileName}:`, uploadError);
      }
    } catch (error: any) {
      console.error(`Error processing image ${imageRange.resourceId}:`, error);
    }
  }
  
  return resourceIdToDriveId;
}

export function buildImageInsertRequests(
  imageRanges: ImageRange[],
  resourceIdToDriveId: Map<string, string>,
  textOffset: number = 0
): any[] {
  const requests: any[] = [];
  
  console.log(`Building image insert requests for ${imageRanges.length} images`);
  console.log(`Resource to Drive ID map size: ${resourceIdToDriveId.size}`);
  
  // Sort images by position in reverse order (insert from end to start)
  const sortedImages = [...imageRanges].sort((a, b) => b.position - a.position);
  
  for (const imageRange of sortedImages) {
    const driveId = resourceIdToDriveId.get(imageRange.resourceId);
    if (!driveId) {
      console.warn(`No Drive ID for resource ${imageRange.resourceId}`);
      continue;
    }
    
    // Calculate insertion position
    const insertPosition = imageRange.position + textOffset + 1; // +1 for Docs API indexing
    console.log(`Inserting image at position ${insertPosition}, Drive ID: ${driveId}`);
    
    requests.push({
      insertInlineImage: {
        location: { 
          index: insertPosition 
        },
        uri: `https://drive.google.com/uc?export=view&id=${driveId}`,
        objectSize: {
          height: { 
            magnitude: 300, 
            unit: 'PT' 
          },
          width: { 
            magnitude: 300, 
            unit: 'PT' 
          }
        }
      }
    });
  }
  
  console.log(`Built ${requests.length} image insertion requests`);
  return requests;
}