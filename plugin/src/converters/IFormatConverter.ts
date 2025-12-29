/**
 * IFormatConverter - Provider-agnostic format conversion interface
 * 
 * This interface abstracts the conversion between Markdown and provider-specific
 * document formats, allowing the plugin to support different output formats
 * (Google Docs, DOCX, etc.) without changing the core sync logic.
 */

/**
 * Range within the plain text output indicating a paragraph style
 */
export interface ParagraphStyleRange {
  /** Start index in plain text */
  start: number;
  /** End index in plain text */
  end: number;
  /** Style identifier (e.g., 'HEADING_1', 'NORMAL_TEXT', 'CODEBLOCK') */
  style: string;
}

/**
 * Range within the plain text output indicating inline styling
 */
export interface TextStyleRange {
  /** Start index in plain text */
  start: number;
  /** End index in plain text */
  end: number;
  /** Bold formatting */
  bold?: boolean;
  /** Italic formatting */
  italic?: boolean;
  /** Monospace/code formatting */
  codeMono?: boolean;
  /** Link URL (if this is a link) */
  linkUrl?: string;
}

/**
 * Information about an image in the document
 */
export interface ImageReference {
  /** Position in the plain text where image should be inserted */
  position: number;
  /** Joplin resource ID */
  resourceId: string;
  /** Alt text from Markdown */
  altText?: string;
  /** Optional title from Markdown */
  title?: string;
  /** Original markdown syntax for reference */
  originalMarkdown: string;
}

/**
 * Result of converting Markdown to a provider format
 */
export interface MarkdownToFormatResult {
  /** Plain text content (without Markdown syntax) */
  plainText: string;
  /** Paragraph style ranges */
  paragraphStyles: ParagraphStyleRange[];
  /** Inline text style ranges */
  textStyles: TextStyleRange[];
  /** Image references found in the Markdown */
  images: ImageReference[];
}

/**
 * Result of converting a provider format to Markdown
 */
export interface FormatToMarkdownResult {
  /** Markdown content */
  markdown: string;
  /** Title extracted from the document (if any) */
  extractedTitle?: string;
  /** Any warnings during conversion */
  warnings?: string[];
}

/**
 * Configuration for format conversion
 */
export interface ConversionConfig {
  /** Path to configuration files (for loading custom mappings) */
  configDir?: string;
  /** Monospace font family name */
  monoFont?: string;
  /** Whether to use document title as first line */
  useTitle?: boolean;
  /** Whether to render subtitle as italic */
  subtitleAsItalic?: boolean;
}

/**
 * Interface for format converters.
 * 
 * Converters handle the bidirectional conversion between Markdown
 * and provider-specific document formats.
 * 
 * @example Google Docs Converter
 * ```typescript
 * class GoogleDocsConverter implements IFormatConverter {
 *   formatName = 'google-docs';
 *   
 *   fromMarkdown(markdown: string): MarkdownToFormatResult {
 *     // Convert Markdown to Google Docs format
 *   }
 *   
 *   toMarkdown(content: any): FormatToMarkdownResult {
 *     // Convert Google Docs body.content to Markdown
 *   }
 * }
 * ```
 * 
 * @example DOCX Converter (future)
 * ```typescript
 * class DocxConverter implements IFormatConverter {
 *   formatName = 'docx';
 *   // ... implementation for DOCX format
 * }
 * ```
 */
export interface IFormatConverter {
  /** Unique format identifier */
  readonly formatName: string;

  /**
   * Converts Markdown to the provider's document format.
   * 
   * @param markdown - Markdown content to convert
   * @param config - Optional conversion configuration
   * @returns Conversion result with plain text and style information
   */
  fromMarkdown(markdown: string, config?: ConversionConfig): MarkdownToFormatResult;

  /**
   * Converts provider-specific content to Markdown.
   * 
   * @param content - Provider-specific document content
   * @param config - Optional conversion configuration
   * @returns Conversion result with Markdown and optional metadata
   */
  toMarkdown(content: any, config?: ConversionConfig): FormatToMarkdownResult;

  /**
   * Builds provider-specific formatting requests from conversion result.
   * 
   * For Google Docs, this creates batchUpdate requests.
   * For DOCX, this might create paragraph/run definitions.
   * 
   * @param result - Result from fromMarkdown()
   * @param config - Optional conversion configuration
   * @returns Array of provider-specific formatting requests
   */
  buildFormattingRequests(result: MarkdownToFormatResult, config?: ConversionConfig): any[];
}

/**
 * Base class providing common functionality for converters.
 * Converters can extend this or implement IFormatConverter directly.
 */
export abstract class BaseFormatConverter implements IFormatConverter {
  abstract readonly formatName: string;

  abstract fromMarkdown(markdown: string, config?: ConversionConfig): MarkdownToFormatResult;
  abstract toMarkdown(content: any, config?: ConversionConfig): FormatToMarkdownResult;
  abstract buildFormattingRequests(result: MarkdownToFormatResult, config?: ConversionConfig): any[];

  /**
   * Helper to normalize line endings in Markdown
   */
  protected normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  /**
   * Helper to check if a range overlaps with any ranges in a list
   */
  protected rangesOverlap(
    start: number,
    end: number,
    ranges: Array<{ start: number; end: number }>
  ): boolean {
    return ranges.some(r => Math.max(r.start, start) < Math.min(r.end, end));
  }
}

/**
 * Registry for format converters.
 * Allows dynamic registration and lookup of converters by format name.
 */
export class ConverterRegistry {
  private converters = new Map<string, IFormatConverter>();

  /**
   * Registers a converter for a format.
   */
  register(converter: IFormatConverter): void {
    this.converters.set(converter.formatName, converter);
  }

  /**
   * Gets a converter by format name.
   */
  get(formatName: string): IFormatConverter | undefined {
    return this.converters.get(formatName);
  }

  /**
   * Gets all registered format names.
   */
  getRegisteredFormats(): string[] {
    return Array.from(this.converters.keys());
  }
}

