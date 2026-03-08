/**
 * Image Extractor
 * 
 * Extracts Joplin image references from Markdown and tracks their positions.
 * Images are replaced with placeholders during conversion, then the positions
 * are calculated in the final plain text output.
 */

import { ImageRange } from './types';

// Unique placeholder that won't appear in normal text
const imagePlaceholder = '\u200B\u2063IMG\u2063\u200B';

/**
 * Result of extracting images from markdown
 */
export interface ImageExtractionResult {
  /** Markdown with images replaced by placeholders */
  markdownWithPlaceholders: string;
  /** Extracted image metadata (positions are placeholder indices) */
  images: ExtractedImage[];
}

/**
 * Extracted image metadata
 */
export interface ExtractedImage {
  /** Joplin resource ID */
  resourceId: string;
  /** Alt text */
  altText?: string;
  /** Title (if provided) */
  title?: string;
  /** Original markdown syntax */
  originalMarkdown: string;
  /** Placeholder index (for later position calculation) */
  placeholderIndex: number;
  /** Link URL if image is wrapped in a link */
  linkUrl?: string;
}

/**
 * Regex to match Joplin image syntax: ![alt](:/resourceId) or ![alt](:/resourceId "title")
 * Handles escaped brackets in alt text like ![\[Windows\]](:/id)
 */
const joplinImageRegex = /!\[((?:[^\]\\]|\\.)*)\]\(:\/([a-fA-F0-9]+)(?:\s+"([^"]*)")?\)/g;

/**
 * Regex to match HTML img tags with Joplin resource: <img src=":/resourceId" .../>
 * Captures: resourceId from src attribute
 * Also extracts alt attribute if present
 */
const htmlImgRegex = /<img\s+[^>]*src=["']:\/([a-fA-F0-9]+)["'][^>]*\/?>/gi;

/**
 * Regex to match linked HTML img tags: [<img src=":/resourceId" .../>](url)
 * This pattern must be matched BEFORE standalone HTML img to avoid partial matches
 * Captures: 1=img tag, 2=resourceId, 3=link URL
 */
const linkedHtmlImgRegex = /\[(<img\s+[^>]*src=["']:\/([a-fA-F0-9]+)["'][^>]*\/?>)\]\(([^)]+)\)/gi;

/**
 * Extract alt attribute from HTML img tag
 */
const extractAltFromHtmlImg = (imgTag: string): string | undefined => {
  const altMatch = imgTag.match(/\salt=["']([^"']*)["']/i);
  return altMatch ? altMatch[1] : undefined;
};

/**
 * Extract images from markdown and replace with placeholders
 * 
 * Handles:
 * - Markdown syntax: ![alt](:/resourceId)
 * - HTML img tags: <img src=":/resourceId"/>
 * - Linked HTML images: [<img src=":/resourceId"/>](url)
 * 
 * @param markdown - Original markdown with images
 * @returns Markdown with placeholders and extracted image metadata
 */
export function extractImages(markdown: string): ImageExtractionResult {
  const images: ExtractedImage[] = [];
  let placeholderIndex = 0;
  
  // First pass: Replace markdown images ![alt](:/resourceId)
  let markdownWithPlaceholders = markdown.replace(
    joplinImageRegex,
    (match, altText, resourceId, title) => {
      images.push({
        resourceId,
        altText: altText || undefined,
        title: title || undefined,
        originalMarkdown: match,
        placeholderIndex: placeholderIndex++,
      });
      return `${imagePlaceholder}${placeholderIndex - 1}${imagePlaceholder}`;
    }
  );
  
  // Second pass: Replace LINKED HTML img tags [<img.../>](url) BEFORE standalone
  // This prevents the standalone regex from partially matching
  markdownWithPlaceholders = markdownWithPlaceholders.replace(
    linkedHtmlImgRegex,
    (match, imgTag, resourceId, linkUrl) => {
      const altText = extractAltFromHtmlImg(imgTag);
      images.push({
        resourceId,
        altText,
        title: undefined,
        originalMarkdown: match,
        placeholderIndex: placeholderIndex++,
        linkUrl: linkUrl || undefined,
      });
      return `${imagePlaceholder}${placeholderIndex - 1}${imagePlaceholder}`;
    }
  );
  
  // Third pass: Replace standalone HTML img tags <img src=":/resourceId" .../>
  markdownWithPlaceholders = markdownWithPlaceholders.replace(
    htmlImgRegex,
    (match, resourceId) => {
      const altText = extractAltFromHtmlImg(match);
      images.push({
        resourceId,
        altText,
        title: undefined,
        originalMarkdown: match,
        placeholderIndex: placeholderIndex++,
      });
      return `${imagePlaceholder}${placeholderIndex - 1}${imagePlaceholder}`;
    }
  );
  
  return { markdownWithPlaceholders, images };
}

/**
 * A range that needs adjustment when placeholders are removed
 */
export interface AdjustableRange {
  start: number;
  end: number;
  [key: string]: any;
}

/**
 * Calculate final image positions in plain text output and adjust style ranges
 * 
 * After conversion to plain text, find the placeholders and calculate
 * the actual character positions where images should be inserted.
 * Also adjusts style ranges to account for removed placeholders.
 * 
 * @param plainText - Plain text output with placeholders
 * @param images - Extracted image metadata
 * @param paraRanges - Paragraph ranges to adjust
 * @param textRanges - Text ranges to adjust
 * @returns ImageRange array with actual positions, clean plain text, and adjusted ranges
 */
export function calculateImagePositions<P extends AdjustableRange, T extends AdjustableRange>(
  plainText: string,
  images: ExtractedImage[],
  paraRanges: P[] = [],
  textRanges: T[] = []
): { 
  cleanPlainText: string; 
  imageRanges: ImageRange[];
  adjustedParaRanges: P[];
  adjustedTextRanges: T[];
} {
  // Step 1: Find ALL placeholder positions in the ORIGINAL text
  const placeholderInfos: { 
    originalPosition: number; 
    length: number; 
    image: ExtractedImage;
  }[] = [];
  
  for (const img of images) {
    const placeholder = `${imagePlaceholder}${img.placeholderIndex}${imagePlaceholder}`;
    const pos = plainText.indexOf(placeholder);
    
    if (pos !== -1) {
      placeholderInfos.push({
        originalPosition: pos,
        length: placeholder.length,
        image: img,
      });
    } else {
      console.warn(`[image-extractor] Placeholder ${img.placeholderIndex} not found for resource ${img.resourceId}`);
    }
  }
  
  // Step 2: Sort by original position (ascending)
  placeholderInfos.sort((a, b) => a.originalPosition - b.originalPosition);
  
  // Step 3: Calculate clean text positions by tracking cumulative removal
  const imageRanges: ImageRange[] = [];
  let cumulativeRemoval = 0;
  
  for (const info of placeholderInfos) {
    // Position in clean text = original position - all prior removals
    const cleanPosition = info.originalPosition - cumulativeRemoval;
    
    imageRanges.push({
      position: cleanPosition,
      resourceId: info.image.resourceId,
      altText: info.image.altText,
      title: info.image.title,
      originalMarkdown: info.image.originalMarkdown,
      linkUrl: info.image.linkUrl,
    });
    
    cumulativeRemoval += info.length;
  }
  
  // Step 4: Build clean plain text by removing all placeholders
  let cleanPlainText = plainText;
  // Remove in reverse order to preserve positions
  for (let i = placeholderInfos.length - 1; i >= 0; i--) {
    const info = placeholderInfos[i];
    const placeholder = `${imagePlaceholder}${info.image.placeholderIndex}${imagePlaceholder}`;
    cleanPlainText = cleanPlainText.substring(0, info.originalPosition) + 
                     cleanPlainText.substring(info.originalPosition + info.length);
  }
  
  // Step 5: Adjust style ranges based on placeholder removals
  // Use the sorted placeholderInfos for efficient adjustment
  function adjustPosition(pos: number): number {
    let adjustment = 0;
    for (const info of placeholderInfos) {
      if (info.originalPosition < pos) {
        adjustment += info.length;
      } else {
        break; // Since sorted, no more adjustments needed
      }
    }
    return pos - adjustment;
  }
  
  const adjustedParaRanges = paraRanges.map(range => ({
    ...range,
    start: adjustPosition(range.start),
    end: adjustPosition(range.end),
  }));
  
  const adjustedTextRanges = textRanges.map(range => ({
    ...range,
    start: adjustPosition(range.start),
    end: adjustPosition(range.end),
  }));
  
  return { cleanPlainText, imageRanges, adjustedParaRanges, adjustedTextRanges };
}

/**
 * Check if markdown contains Joplin images (markdown or HTML syntax)
 */
export function hasJoplinImages(markdown: string): boolean {
  joplinImageRegex.lastIndex = 0; // Reset regex state
  htmlImgRegex.lastIndex = 0; // Reset regex state
  linkedHtmlImgRegex.lastIndex = 0; // Reset regex state
  return joplinImageRegex.test(markdown) || htmlImgRegex.test(markdown) || linkedHtmlImgRegex.test(markdown);
}

