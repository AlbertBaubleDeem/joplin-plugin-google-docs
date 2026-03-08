/**
 * GoogleDocsConverter - Google Docs implementation of IFormatConverter
 * 
 * This converter wraps the existing converter functions to provide
 * an OOP interface conforming to IFormatConverter.
 */

import {
  IFormatConverter,
  MarkdownToFormatResult,
  FormatToMarkdownResult,
  ConversionConfig,
  ParagraphStyleRange,
  TextStyleRange,
  ImageReference,
} from './IFormatConverter';
import { markdownToIR } from './md-to-ir';
import { docsToIR } from './docs-to-ir';
import { irToMarkdown } from './ir-to-md';
import { irToPlainTextWithRanges, buildDocsRequests, buildCodeBlockFontRequests } from './ir-to-docs';
import { extractImages, calculateImagePositions } from './image-extractor';
import { loadConfig, setInstallDir } from './config';

/**
 * Google Docs implementation of the format converter interface.
 * 
 * This converter transforms between Markdown and Google Docs API structures,
 * enabling bidirectional sync between Joplin notes and Google Docs.
 * 
 * @example
 * ```typescript
 * const converter = new GoogleDocsConverter();
 * 
 * // Push: Markdown to Google Docs
 * const result = converter.fromMarkdown(markdownContent);
 * const requests = converter.buildFormattingRequests(result);
 * 
 * // Pull: Google Docs to Markdown
 * const { markdown } = converter.toMarkdown(docsContent);
 * ```
 */
export class GoogleDocsConverter implements IFormatConverter {
  readonly formatName = 'google-docs';

  /**
   * Converts Markdown to Google Docs-compatible structure.
   * 
   * The result includes plain text, paragraph styles, text styles,
   * and image references that can be used with the Google Docs API.
   */
  fromMarkdown(markdown: string, config?: ConversionConfig): MarkdownToFormatResult {
    // Set install dir if provided
    if (config?.configDir) {
      setInstallDir(config.configDir);
    }

    const converterConfig = loadConfig(config?.configDir);

    // Step 1: Extract images and replace with placeholders
    const { markdownWithPlaceholders, images } = extractImages(markdown);

    // Step 2: Convert markdown (with placeholders) to IR
    const ir = markdownToIR(markdownWithPlaceholders, converterConfig);

    // Step 3: Convert IR to plain text with style ranges
    const { plain: plainWithPlaceholders, paraRanges, textRanges } = irToPlainTextWithRanges(ir, config?.configDir);

    // Step 4: Calculate image positions, remove placeholders, and adjust ranges
    const { cleanPlainText, imageRanges, adjustedParaRanges, adjustedTextRanges } = calculateImagePositions(
      plainWithPlaceholders,
      images,
      paraRanges,
      textRanges
    );

    // Convert internal types to IFormatConverter types
    const paragraphStyles: ParagraphStyleRange[] = adjustedParaRanges.map(r => ({
      start: r.start,
      end: r.end,
      style: r.style,
    }));

    const textStyles: TextStyleRange[] = adjustedTextRanges.map(r => ({
      start: r.start,
      end: r.end,
      bold: r.bold,
      italic: r.italic,
      codeMono: r.codeMono,
      linkUrl: r.linkUrl,
    }));

    const imageRefs: ImageReference[] = imageRanges.map(r => ({
      position: r.position,
      resourceId: r.resourceId,
      altText: r.altText,
      title: r.title,
      originalMarkdown: r.originalMarkdown,
    }));

    return {
      plainText: cleanPlainText,
      paragraphStyles,
      textStyles,
      images: imageRefs,
    };
  }

  /**
   * Converts Google Docs content to Markdown.
   * 
   * @param content - The document object from Google Docs API (documents.get)
   */
  toMarkdown(content: any, config?: ConversionConfig): FormatToMarkdownResult {
    if (config?.configDir) {
      setInstallDir(config.configDir);
    }

    const converterConfig = loadConfig(config?.configDir);
    const ir = docsToIR(content, converterConfig);
    const markdown = irToMarkdown(ir, converterConfig);

    // Extract title if present (first paragraph of type 'title')
    const extractedTitle = (ir.length > 0 && ir[0].type === 'title')
      ? ir[0].spans.map(s => s.text).join('')
      : undefined;

    return {
      markdown,
      extractedTitle,
    };
  }

  /**
   * Builds Google Docs API batchUpdate requests from conversion result.
   * 
   * These requests can be used with documents.batchUpdate to apply
   * formatting to the document content.
   */
  buildFormattingRequests(result: MarkdownToFormatResult, config?: ConversionConfig): any[] {
    // Convert IFormatConverter types back to internal types
    const paraRanges = result.paragraphStyles.map(r => ({
      start: r.start,
      end: r.end,
      style: r.style,
    }));

    const textRanges = result.textStyles.map(r => ({
      start: r.start,
      end: r.end,
      bold: r.bold,
      italic: r.italic,
      codeMono: r.codeMono,
      linkUrl: r.linkUrl,
    }));

    // Build requests from ranges
    const plainWithRanges = { plain: result.plainText, paraRanges, textRanges };
    const requests = buildDocsRequests(plainWithRanges, config?.configDir);

    // Add code block font requests
    const codeBlockFonts = buildCodeBlockFontRequests(paraRanges, config?.configDir);

    return [...requests, ...codeBlockFonts];
  }
}

/**
 * Factory function to create a GoogleDocsConverter.
 */
export function createGoogleDocsConverter(): GoogleDocsConverter {
  return new GoogleDocsConverter();
}

