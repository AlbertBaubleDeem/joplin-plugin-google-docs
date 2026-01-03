/**
 * Converter Module
 * 
 * This module provides bidirectional conversion between Markdown and Google Docs.
 * It uses an intermediate representation (IR) for reliable, debuggable conversion.
 * 
 * Architecture:
 *   Markdown ──► IR ──► Docs API requests (push)
 *   Docs content ──► IR ──► Markdown (pull)
 * 
 * @example
 * ```typescript
 * import { 
 *   convertMarkdownToPlainAndStyles, 
 *   buildDocsStyleUpdateRequests,
 *   convertDocumentToMarkdown 
 * } from './converter';
 * 
 * // Push: Markdown to Docs
 * const { plain, paraRanges, textRanges } = convertMarkdownToPlainAndStyles(markdown);
 * const requests = buildDocsStyleUpdateRequests(paraRanges, textRanges);
 * 
 * // Pull: Docs to Markdown
 * const markdown = convertDocumentToMarkdown(docsContent);
 * ```
 */

// Re-export types
export * from './types';

// Re-export config utilities
export { loadConfig, setInstallDir, getMonoFont, clearConfigCache } from './config';

// Re-export debug utilities
export { setDebugMode, isDebugEnabled, getDebugLog, clearDebugLog, formatIRDocument, getDebugLogPath } from './debug';

// Re-export core conversion functions
export { markdownToIR } from './md-to-ir';
export { docsToIR, mergeAdjacentSpans } from './docs-to-ir';
export { irToMarkdown, normalizeMarkdown } from './ir-to-md';
export { irToPlainTextWithRanges, buildDocsRequests, buildCodeBlockFontRequests } from './ir-to-docs';
export { extractImages, calculateImagePositions, hasJoplinImages } from './image-extractor';

// Import for backward-compatible wrappers
import { markdownToIR } from './md-to-ir';
import { docsToIR } from './docs-to-ir';
import { irToMarkdown } from './ir-to-md';
import { irToPlainTextWithRanges, buildDocsRequests, buildCodeBlockFontRequests } from './ir-to-docs';
import { extractImages, calculateImagePositions, hasJoplinImages } from './image-extractor';
import { loadConfig, setInstallDir } from './config';
import type { ParaRange, TextRange, ImageRange, ConverterConfig } from './types';

/**
 * Convert Markdown to plain text and style ranges.
 * 
 * This is a backward-compatible wrapper that matches the old converter API.
 * Internally, it uses: markdown → IR → plainTextWithRanges
 * 
 * Now also extracts images and returns their positions for later insertion.
 * 
 * @param mdRaw - The Markdown source
 * @param opts - Options including installDir for config
 * @returns Plain text, style ranges, and image ranges
 */
export function convertMarkdownToPlainAndStyles(
  mdRaw: string,
  opts?: { installDir?: string }
): { plain: string; paraRanges: ParaRange[]; textRanges: TextRange[]; imageRanges: ImageRange[] } {
  if (opts?.installDir) {
    setInstallDir(opts.installDir);
  }
  
  const config = loadConfig(opts?.installDir);
  
  // Step 1: Extract images and replace with placeholders
  const { markdownWithPlaceholders, images } = extractImages(mdRaw);
  
  // Step 2: Convert markdown (with placeholders) to IR
  const ir = markdownToIR(markdownWithPlaceholders, config);
  
  // Step 3: Convert IR to plain text with style ranges
  const { plain: plainWithPlaceholders, paraRanges: rawParaRanges, textRanges: rawTextRanges } = irToPlainTextWithRanges(ir, opts?.installDir);
  
  // Step 4: Calculate image positions, remove placeholders, and adjust ranges
  const { cleanPlainText, imageRanges, adjustedParaRanges, adjustedTextRanges } = calculateImagePositions(
    plainWithPlaceholders, 
    images,
    rawParaRanges,
    rawTextRanges
  );
  
  return { plain: cleanPlainText, paraRanges: adjustedParaRanges, textRanges: adjustedTextRanges, imageRanges };
}

/**
 * Build Docs API style update requests.
 * 
 * This is a backward-compatible wrapper that matches the old converter API.
 * 
 * @param paraRanges - Paragraph ranges from convertMarkdownToPlainAndStyles
 * @param textRanges - Text ranges from convertMarkdownToPlainAndStyles
 * @param opts - Options including installDir for config
 * @returns Array of Docs API request objects
 */
export function buildDocsStyleUpdateRequests(
  paraRanges: ParaRange[],
  textRanges: TextRange[],
  opts?: { installDir?: string }
): any[] {
  // Build requests from ranges
  const plainWithRanges = { plain: '', paraRanges, textRanges };
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

