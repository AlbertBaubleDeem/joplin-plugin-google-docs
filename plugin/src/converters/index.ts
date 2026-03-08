/**
 * Converter Module
 * 
 * This module provides bidirectional conversion between Markdown and document formats.
 * It uses an intermediate representation (IR) for reliable, debuggable conversion.
 * 
 * Architecture:
 *   Markdown ──► IR ──► Format-specific requests (push)
 *   Format content ──► IR ──► Markdown (pull)
 * 
 * Supports multiple formats via IFormatConverter interface:
 * - GoogleDocsConverter: Full implementation for Google Docs
 * - DocxConverter: Stub for future DOCX support
 * 
 * @example OOP Interface
 * ```typescript
 * import { GoogleDocsConverter } from './converters';
 * 
 * const converter = new GoogleDocsConverter();
 * const result = converter.fromMarkdown(markdown);
 * const requests = converter.buildFormattingRequests(result);
 * const { markdown } = converter.toMarkdown(docsContent);
 * ```
 * 
 * @example Functional Interface (backward compatible)
 * ```typescript
 * import { 
 *   convertMarkdownToPlainAndStyles, 
 *   buildDocsStyleUpdateRequests,
 *   convertDocumentToMarkdown 
 * } from './converters';
 * 
 * const { plain, paraRanges, textRanges } = convertMarkdownToPlainAndStyles(markdown);
 * const requests = buildDocsStyleUpdateRequests(paraRanges, textRanges);
 * const markdown = convertDocumentToMarkdown(docsContent);
 * ```
 */

// Re-export IFormatConverter interface and types
export * from './IFormatConverter';

// Re-export converter implementations
export { GoogleDocsConverter, createGoogleDocsConverter } from './GoogleDocsConverter';
export { DocxConverter, createDocxConverter } from './DocxConverter';

// Re-export internal types
export * from './types';

// Re-export config utilities
export { loadConfig, setInstallDir, setDataDir, getMonoFont, clearConfigCache } from './config';

// Re-export debug utilities
export { setDebugMode, isDebugEnabled, getDebugLog, clearDebugLog, formatIRDocument, getDebugLogPath } from './debug';

// Re-export core conversion functions
export { markdownToIR } from './md-to-ir';
export { docsToIR, mergeAdjacentSpans } from './docs-to-ir';
export { irToMarkdown, normalizeMarkdown } from './ir-to-md';
export { irToPlainTextWithRanges, buildDocsRequests, buildCodeBlockFontRequests, buildListBulletRequests } from './ir-to-docs';
export { extractImages, calculateImagePositions, hasJoplinImages } from './image-extractor';

// Import for backward-compatible wrappers
import { markdownToIR } from './md-to-ir';
import { docsToIR } from './docs-to-ir';
import { irToMarkdown } from './ir-to-md';
import { irToPlainTextWithRanges, buildDocsRequests, buildCodeBlockFontRequests } from './ir-to-docs';
import { extractImages, calculateImagePositions, hasJoplinImages } from './image-extractor';
import { loadConfig, setInstallDir, setDataDir } from './config';
import type { ParaRange, TextRange, ImageRange, ListRange, ConverterConfig } from './types';

/**
 * Convert Markdown to plain text and style ranges.
 * 
 * This is a backward-compatible wrapper that matches the old converter API.
 * Internally, it uses: markdown → IR → plainTextWithRanges
 * 
 * Now also extracts images and returns their positions for later insertion,
 * and list ranges for bullet formatting.
 * 
 * @param mdRaw - The Markdown source
 * @param opts - Options including installDir for config and processImages flag
 * @returns Plain text, style ranges, image ranges, and list ranges
 */
export function convertMarkdownToPlainAndStyles(
  mdRaw: string,
  opts?: { installDir?: string; processImages?: boolean }
): { plain: string; paraRanges: ParaRange[]; textRanges: TextRange[]; imageRanges: ImageRange[]; listRanges: ListRange[] } {
  if (opts?.installDir) {
    setInstallDir(opts.installDir);
  }
  
  const config = loadConfig(opts?.installDir);
  
  // If processImages is false (or not set), skip image extraction entirely
  // This preserves image markdown as-is in the document (for when GCS is not configured)
  if (!opts?.processImages) {
    // Simple path: no image processing, no placeholder complexity
    const ir = markdownToIR(mdRaw, config);
    const { plain, paraRanges, textRanges, listRanges } = irToPlainTextWithRanges(ir, opts?.installDir);
    
    return { plain, paraRanges, textRanges, imageRanges: [], listRanges: listRanges || [] };
  }
  
  // Full image processing path (when GCS is configured)
  // Step 1: Extract images and replace with placeholders
  const { markdownWithPlaceholders, images } = extractImages(mdRaw);
  
  // Step 2: Convert markdown (with placeholders) to IR
  const ir = markdownToIR(markdownWithPlaceholders, config);
  
  // Step 3: Convert IR to plain text with style ranges
  const { plain: plainWithPlaceholders, paraRanges: rawParaRanges, textRanges: rawTextRanges, listRanges: rawListRanges } = irToPlainTextWithRanges(ir, opts?.installDir);
  
  // Step 4: Calculate image positions, remove placeholders, and adjust ranges
  const { cleanPlainText, imageRanges, adjustedParaRanges, adjustedTextRanges } = calculateImagePositions(
    plainWithPlaceholders, 
    images,
    rawParaRanges,
    rawTextRanges
  );
  
  // Step 5: Adjust list ranges for image placeholder removal
  const adjustedListRanges = adjustListRangesForImages(rawListRanges || [], plainWithPlaceholders, images);
  
  return { plain: cleanPlainText, paraRanges: adjustedParaRanges, textRanges: adjustedTextRanges, imageRanges, listRanges: adjustedListRanges };
}

// Image placeholder constant - must match image-extractor.ts
const imagePlaceholder = '\u200B\u2063IMG\u2063\u200B';

/**
 * Adjust list ranges after image placeholder removal.
 * Similar logic to calculateImagePositions but for list ranges.
 */
const adjustListRangesForImages = (
  listRanges: ListRange[],
  plainWithPlaceholders: string,
  images: { placeholderIndex: number }[]
): ListRange[] => {
  if (listRanges.length === 0 || images.length === 0) {
    return listRanges;
  }
  
  // Calculate total placeholder lengths removed before each position
  const placeholderPositions: { position: number; length: number }[] = [];
  for (const img of images) {
    const placeholder = `${imagePlaceholder}${img.placeholderIndex}${imagePlaceholder}`;
    const pos = plainWithPlaceholders.indexOf(placeholder);
    if (pos !== -1) {
      placeholderPositions.push({ position: pos, length: placeholder.length });
    }
  }
  placeholderPositions.sort((a, b) => a.position - b.position);
  
  return listRanges.map(range => {
    let startAdjustment = 0;
    let endAdjustment = 0;
    
    for (const pp of placeholderPositions) {
      if (pp.position < range.startIndex) {
        startAdjustment += pp.length;
      }
      if (pp.position < range.endIndex) {
        endAdjustment += pp.length;
      }
    }
    
    return {
      startIndex: range.startIndex - startAdjustment,
      endIndex: range.endIndex - endAdjustment,
      listType: range.listType,
      totalTabs: range.totalTabs,
    };
  });
};

/**
 * Build Docs API style update requests.
 * 
 * This is a backward-compatible wrapper that matches the old converter API.
 * 
 * @param paraRanges - Paragraph ranges from convertMarkdownToPlainAndStyles
 * @param textRanges - Text ranges from convertMarkdownToPlainAndStyles
 * @param opts - Options including installDir for config and listRanges for bullet formatting
 * @returns Array of Docs API request objects
 */
export function buildDocsStyleUpdateRequests(
  paraRanges: ParaRange[],
  textRanges: TextRange[],
  opts?: { installDir?: string; listRanges?: ListRange[] }
): any[] {
  // Build requests from ranges (including list ranges)
  const plainWithRanges = { plain: '', paraRanges, textRanges, listRanges: opts?.listRanges };
  const requests = buildDocsRequests(plainWithRanges, opts?.installDir);
  
  // Add code block font requests
  const codeBlockFonts = buildCodeBlockFontRequests(paraRanges, opts?.installDir);
  
  return [...requests, ...codeBlockFonts];
}

/**
 * Convert Google Docs document content to Markdown.
 * 
 * This is a backward-compatible wrapper that matches the old converter API.
 * Internally, it uses: docsContent → IR → markdown
 * 
 * @param doc - The document object from documents.get API
 * @param opts - Options including installDir for config
 * @returns The Markdown string
 */
export function convertDocumentToMarkdown(
  doc: any,
  opts?: { installDir?: string }
): string {
  if (opts?.installDir) {
    setInstallDir(opts.installDir);
  }
  
  const config = loadConfig(opts?.installDir);
  const ir = docsToIR(doc, config);
  return irToMarkdown(ir, config);
}

