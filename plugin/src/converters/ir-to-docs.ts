/**
 * IR to Google Docs Converter
 * 
 * Converts the intermediate representation (IR) to:
 * 1. Plain text for insertion
 * 2. Style ranges for batchUpdate requests
 */

import { IRDocument, Paragraph, StyledSpan, PlainTextWithRanges, ParaRange, TextRange, CalloutRange, ListRange } from './types';
import { getMonoFont, getElementSpacing } from './config';
import { debug } from './debug';
import { getCalloutDefinition, calloutByType } from './callout-config';

/**
 * Builder class for tracking and creating list ranges.
 * 
 * Encapsulates the complexity of:
 * - Tracking current list state (type, start, end positions)
 * - Counting nesting tabs (consumed by createParagraphBullets API)
 * - Closing lists when type changes or document ends
 * - Adjusting endIndex to account for tab consumption
 */
class ListRangeBuilder {
  private ranges: ListRange[] = [];
  private currentType: 'ordered' | 'unordered' | null = null;
  private currentStart = 0;
  private currentEnd = 0;
  private maxNesting = 0;
  private totalTabs = 0;
  private cumulativeTabs = 0; // Total tabs across ALL lists - used for final clamping

  /**
   * Process a paragraph - starts, continues, or closes lists as needed.
   * @param isListItem - whether this paragraph is a list item
   * @param listType - the type of list (ordered/unordered)
   * @param nestingLevel - nesting depth (0 = top level)
   * @param startPosition - cursor position at start of this paragraph
   * @param endPosition - cursor position at end of this paragraph (before newline)
   */
  processItem(
    isListItem: boolean,
    listType: 'ordered' | 'unordered' | undefined,
    nestingLevel: number,
    startPosition: number,
    endPosition: number
  ): void {
    // Check if we need to close the current list
    if (this.currentType !== null && (!isListItem || listType !== this.currentType)) {
      this.closeCurrentList();
    }

    // If this is a list item, update tracking
    if (isListItem) {
      if (this.currentType === null) {
        // Start a new list
        this.currentType = listType || 'unordered';
        this.currentStart = startPosition;
        this.maxNesting = 0;
        this.totalTabs = 0;
      }

      // Update end position and tab counts
      this.currentEnd = endPosition;
      if (nestingLevel > this.maxNesting) {
        this.maxNesting = nestingLevel;
      }
      this.totalTabs += nestingLevel;
    }
  }

  /**
   * Close the current list and add it to ranges.
   * Stores totalTabs per range so buildListBulletRequests can compute
   * cumulative tab offsets (tabs consumed by earlier requests shift
   * effective positions for later requests in the same batchUpdate).
   */
  private closeCurrentList(): void {
    if (this.currentType === null) return;

    // Accumulate tabs for final clamping calculation
    this.cumulativeTabs += this.totalTabs;
    
    // currentEnd points past the last content character (cursor + text.length).
    // Store it as-is — buildListBulletRequests handles the 0-to-1-based
    // conversion and cumulative tab offset adjustments.
    if (this.currentEnd > this.currentStart) {
      this.ranges.push({
        startIndex: this.currentStart,
        endIndex: this.currentEnd,
        listType: this.currentType,
        totalTabs: this.totalTabs,
      });
      debug('ir-to-docs', 'closed-list-range', {
        startIndex: this.currentStart,
        endIndex: this.currentEnd,
        listType: this.currentType,
        totalTabs: this.totalTabs,
        cumulativeTabs: this.cumulativeTabs,
      });
    }

    // Reset per-list state (but keep cumulativeTabs)
    this.currentType = null;
    this.currentStart = 0;
    this.currentEnd = 0;
    this.maxNesting = 0;
    this.totalTabs = 0;
  }

  /**
   * Finalize and close any remaining open list.
   * Call this after processing all paragraphs.
   */
  finalize(): void {
    this.closeCurrentList();
  }

  /**
   * Get the built list ranges.
   */
  getRanges(): ListRange[] {
    return this.ranges;
  }

  /**
   * Apply safety clamp to ensure no endIndex exceeds the API's effective segment end.
   * The API consumes ALL tabs in the document, so we must subtract cumulativeTabs.
   * @param plainLength - the length of the plain text being inserted
   */
  clampRanges(plainLength: number): void {
    // The API segment end is reduced by ALL tabs in the document
    // plainLength - 1 gives us the max 0-based index
    // Then subtract cumulativeTabs to account for tab consumption
    const effectiveMaxEndIndex = plainLength - 1 - this.cumulativeTabs;
    
    for (const range of this.ranges) {
      if (range.endIndex > effectiveMaxEndIndex) {
        debug('ir-to-docs', 'clamping-list-endIndex', {
          from: range.endIndex,
          to: effectiveMaxEndIndex,
        });
        range.endIndex = effectiveMaxEndIndex;
      }
    }
  }
}

/**
 * Convert IR document to plain text with style ranges.
 * This is the primary function for the push (MD→Docs) direction.
 * 
 * @param doc - The IR document
 * @param installDir - Optional install directory for config
 * @returns Plain text and style ranges for Docs API
 */
export function irToPlainTextWithRanges(doc: IRDocument, installDir?: string): PlainTextWithRanges {
  debug('ir-to-docs', 'input', doc);
  
  const paraRanges: ParaRange[] = [];
  const textRanges: TextRange[] = [];
  const calloutRanges: CalloutRange[] = [];
  const listBuilder = new ListRangeBuilder();
  let plain = '';
  let cursor = 0;
  let prevWasCodeBlock = false;
  
  for (let i = 0; i < doc.length; i++) {
    const para = doc[i];
    const isCodeBlock = para.type === 'code_block';
    const isCallout = para.type === 'callout';
    const isListItem = para.type === 'list_item';
    
    // Handle callout boxes - render as styled paragraph with symbol prefix
    if (isCallout && para.calloutType) {
      const def = getCalloutDefinition(para.calloutType);
      if (def) {
        const content = para.spans.map(s => s.text).join('');
        // Add symbol prefix followed by content
        const calloutText = def.symbol + '  ' + content;
        const calloutEnd = cursor + calloutText.length;
        
        // Add paragraph range with callout style
        paraRanges.push({
          start: cursor,
          end: calloutEnd,
          style: `CALLOUT_${para.calloutType.toUpperCase()}`,
        });
        
        // Track for callout-specific styling (symbol formatting, etc.)
        calloutRanges.push({
          position: cursor,
          calloutType: para.calloutType,
          content: calloutText,
        });
        
        plain += calloutText + '\n';
        cursor = calloutEnd + 1;
        debug('ir-to-docs', 'added-callout', { type: para.calloutType, position: cursor, content: content.substring(0, 50) });
        continue;
      }
    }
    
    // Insert blank line between consecutive code blocks to prevent visual merging (configurable)
    if (isCodeBlock && prevWasCodeBlock) {
      const codeBlockSpacing = getElementSpacing('code_block', installDir);
      // Only insert separator if configured (defaults to true)
      if (codeBlockSpacing.insertSeparatorBetweenConsecutive !== false) {
        // Add empty paragraph (just a newline) as separator
        paraRanges.push({
          start: cursor,
          end: cursor,
          style: 'NORMAL_TEXT',
        });
        plain += '\n';
        cursor += 1;
      }
    }
    
    // Handle list items - prepend tabs for nesting
    let text: string;
    let ranges: TextRange[];
    
    if (isListItem) {
      // Prepend \t characters for nesting level
      const tabPrefix = '\t'.repeat(para.nestingLevel || 0);
      const result = paragraphToTextAndRanges(para, cursor + tabPrefix.length);
      text = tabPrefix + result.text;
      ranges = result.ranges;
    } else {
      const result = paragraphToTextAndRanges(para, cursor);
      text = result.text;
      ranges = result.ranges;
    }
    
    if (text.length === 0) {
      prevWasCodeBlock = isCodeBlock;
      continue;
    }
    
    // Add paragraph range
    const paraEnd = cursor + text.length;
    paraRanges.push({
      start: cursor,
      end: paraEnd,
      style: getParagraphStyle(para),
    });
    
    // Add text ranges with offset
    textRanges.push(...ranges);
    
    // Track list items - handles starting, continuing, and closing lists
    listBuilder.processItem(
      isListItem,
      para.listType,
      para.nestingLevel || 0,
      cursor,
      paraEnd
    );
    
    // Append to plain text with newline
    plain += text + '\n';
    cursor = paraEnd + 1;
    
    // Add language label after code blocks that have a language specified
    if (isCodeBlock && para.language) {
      const langLabel = para.language;
      const labelStart = cursor;
      const labelEnd = cursor + langLabel.length;
      
      // Add paragraph range for the language label
      paraRanges.push({
        start: labelStart,
        end: labelEnd,
        style: 'CODE_LANG_LABEL',
      });
      
      // Add text range for the label styling (small font, grey color)
      textRanges.push({
        start: labelStart,
        end: labelEnd,
        langLabel: true, // Special flag for language label styling
      });
      
      plain += langLabel + '\n';
      cursor = labelEnd + 1;
      debug('ir-to-docs', 'added-lang-label', { language: langLabel, start: labelStart, end: labelEnd });
    }
    
    prevWasCodeBlock = isCodeBlock;
  }
  
  // Finalize list builder - closes any remaining open list
  listBuilder.finalize();
  
  // Clamp ranges based on plain.length and cumulative tabs consumed by API
  listBuilder.clampRanges(plain.length);
  
  const listRanges = listBuilder.getRanges();
  
  const result = { plain, paraRanges, textRanges, calloutRanges, listRanges };
  debug('ir-to-docs', 'result', result);
  return result;
}

/**
 * Convert a paragraph to text and inline style ranges.
 * 
 * For code blocks and list items, newlines are converted to vertical tabs (\u000B)
 * which creates soft line breaks within the same paragraph in Google Docs.
 * This allows multi-line content (like images) to stay within a single list item.
 */
const paragraphToTextAndRanges = (
  para: Paragraph,
  startOffset: number
): { text: string; ranges: TextRange[] } => {
  let text = '';
  const ranges: TextRange[] = [];
  const isCodeBlock = para.type === 'code_block';
  const isListItem = para.type === 'list_item';
  
  for (const span of para.spans) {
    const spanStart = startOffset + text.length;
    
    // For code blocks and list items, replace newlines with vertical tabs (soft line breaks)
    // This keeps all content in a single Google Docs paragraph/list item
    let spanText = span.text;
    if (isCodeBlock || isListItem) {
      spanText = spanText.replace(/\n/g, '\u000B');
    }
    
    const spanEnd = spanStart + spanText.length;
    
    text += spanText;
    
    // Create text range if span has any styling
    if (span.bold || span.italic || span.code || span.link) {
      ranges.push({
        start: spanStart,
        end: spanEnd,
        bold: span.bold,
        italic: span.italic,
        codeMono: span.code,
        linkUrl: span.link,
      });
    }
  }
  
  return { text, ranges };
};

/**
 * Get the Google Docs named style type for a paragraph.
 */
const getParagraphStyle = (para: Paragraph): string => {
  switch (para.type) {
    case 'title':
      return 'TITLE';
    case 'subtitle':
      return 'SUBTITLE';
    case 'heading':
      return `HEADING_${para.level || 1}`;
    case 'code_block':
      return 'CODEBLOCK'; // Custom style, handled specially
    case 'list_item':
      return 'NORMAL_TEXT'; // Lists are styled via createParagraphBullets
    case 'paragraph':
    default:
      return 'NORMAL_TEXT';
  }
};

/**
 * Build Google Docs API batchUpdate requests from plain text and ranges.
 * 
 * @param plainWithRanges - The plain text and style ranges
 * @param installDir - Optional install directory for config
 * @returns Array of Docs API request objects
 */
export function buildDocsRequests(
  plainWithRanges: PlainTextWithRanges,
  installDir?: string
): any[] {
  const { paraRanges, textRanges, listRanges } = plainWithRanges;
  const monoFont = getMonoFont(installDir);
  
  debug('ir-to-docs', 'buildDocsRequests', { paraRanges, textRanges, listRanges, monoFont });
  
  // Build paragraph style requests
  const paraReqs = paraRanges
    .filter(r => r.end > r.start)
    .map(r => buildParagraphStyleRequest(r, monoFont, installDir));
  
  // Build text style requests
  const textReqs = textRanges
    .filter(r => r.end > r.start)
    .flatMap(r => buildTextStyleRequests(r, monoFont));
  
  // Build list bullet requests
  const listReqs = buildListBulletRequests(listRanges || []);
  
  return [...paraReqs, ...textReqs, ...listReqs];
}

/**
 * Build createParagraphBullets requests for list ranges.
 * 
 * When multiple list ranges are sent in one batchUpdate, the API processes
 * them sequentially. Each createParagraphBullets consumes tab characters
 * used for nesting, which shifts effective document positions for all
 * subsequent requests. We must subtract cumulative tabs from prior ranges
 * to keep indices aligned.
 * 
 * @param listRanges - Array of list ranges (must be in document order)
 * @returns Array of Docs API request objects for bullet formatting
 */
export function buildListBulletRequests(listRanges: ListRange[]): any[] {
  let cumulativeTabsConsumed = 0;

  return listRanges
    .filter(r => r.endIndex > r.startIndex)
    .map(range => {
      // Adjust indices by tabs consumed by all prior list ranges
      const adjustedStart = range.startIndex - cumulativeTabsConsumed;
      const adjustedEnd = range.endIndex - cumulativeTabsConsumed;

      // After this request executes, its tabs will be consumed
      cumulativeTabsConsumed += range.totalTabs;

      return {
        createParagraphBullets: {
          range: {
            // Convert 0-based to 1-based for Docs API
            startIndex: adjustedStart + 1,
            endIndex: adjustedEnd,
          },
          bulletPreset: range.listType === 'ordered'
            ? 'NUMBERED_DECIMAL_NESTED'
            : 'BULLET_DISC_CIRCLE_SQUARE',
        },
      };
    });
}

/** RGB color type for paragraph styling */
interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

/** Build border style object */
const buildBorderStyle = (width: number, padding: number, color: RgbColor): any => {
  return {
    width: { magnitude: width, unit: 'PT' },
    padding: { magnitude: padding, unit: 'PT' },
    color: { color: { rgbColor: color } },
    dashStyle: 'SOLID',
  };
};

/** Apply spacing to paragraph style and fields list */
const applySpacing = (
  paragraphStyle: any,
  fields: string[],
  spacing: { spaceAbove?: number; spaceBelow?: number }
): void => {
  if (spacing.spaceAbove !== undefined) {
    paragraphStyle.spaceAbove = { magnitude: spacing.spaceAbove, unit: 'PT' };
    fields.push('spaceAbove');
  }
  if (spacing.spaceBelow !== undefined) {
    paragraphStyle.spaceBelow = { magnitude: spacing.spaceBelow, unit: 'PT' };
    fields.push('spaceBelow');
  }
};

/** Build code block style request */
const buildCodeBlockStyle = (startIndex: number, endIndex: number, installDir?: string): any => {
  const spacing = getElementSpacing('code_block', installDir);
  const paragraphStyle: any = {
    shading: {
      backgroundColor: {
        color: { rgbColor: { red: 0.96, green: 0.96, blue: 0.96 } },
      },
    },
    borderLeft: buildBorderStyle(1, 6, { red: 0.8, green: 0.8, blue: 0.8 }),
  };
  
  const fields = ['shading', 'borderLeft'];
  applySpacing(paragraphStyle, fields, spacing);
  
  return {
    updateParagraphStyle: {
      range: { startIndex, endIndex },
      paragraphStyle,
      fields: fields.join(','),
    },
  };
};

/** Build code language label style request */
const buildCodeLangLabelStyle = (startIndex: number, endIndex: number, installDir?: string): any => {
  const spacing = getElementSpacing('code_lang_label', installDir);
  const paragraphStyle: any = { alignment: 'END' };
  
  const fields = ['alignment'];
  applySpacing(paragraphStyle, fields, spacing);
  
  return {
    updateParagraphStyle: {
      range: { startIndex, endIndex },
      paragraphStyle,
      fields: fields.join(','),
    },
  };
};

/** Build callout style request */
const buildCalloutStyle = (
  startIndex: number,
  endIndex: number,
  calloutTypeName: string,
  installDir?: string
): any | null => {
  const def = calloutByType[calloutTypeName as keyof typeof calloutByType];
  if (!def) return null;
  
  const spacing = getElementSpacing('callout', installDir);
  
  // Create lighter shade for background (mix with white)
  const bgColor: RgbColor = {
    red: 0.95 + def.rgbColor.red * 0.05,
    green: 0.95 + def.rgbColor.green * 0.05,
    blue: 0.95 + def.rgbColor.blue * 0.05,
  };
  
  const paragraphStyle: any = {
    shading: {
      backgroundColor: { color: { rgbColor: bgColor } },
    },
    borderLeft: buildBorderStyle(3, 8, def.rgbColor),
    borderTop: buildBorderStyle(1, 4, def.rgbColor),
    borderBottom: buildBorderStyle(1, 4, def.rgbColor),
    borderRight: buildBorderStyle(1, 4, def.rgbColor),
  };
  
  const fields = ['shading', 'borderLeft', 'borderTop', 'borderBottom', 'borderRight'];
  applySpacing(paragraphStyle, fields, spacing);
  
  return {
    updateParagraphStyle: {
      range: { startIndex, endIndex },
      paragraphStyle,
      fields: fields.join(','),
    },
  };
};

/** Build named style request (for headings, normal text, etc.) */
const buildNamedStyle = (startIndex: number, endIndex: number, styleName: string): any => {
  return {
    updateParagraphStyle: {
      range: { startIndex, endIndex },
      paragraphStyle: { namedStyleType: styleName },
      fields: 'namedStyleType',
    },
  };
};

/**
 * Build a paragraph style request.
 * Delegates to specific style builders based on the style type.
 */
const buildParagraphStyleRequest = (range: ParaRange, monoFont: string, installDir?: string): any => {
  // Docs API uses 1-based indices
  const startIndex = range.start + 1;
  const endIndex = range.end + 1;
  
  // Code blocks get special styling (shading + border + spacing)
  if (range.style === 'CODEBLOCK') {
    return buildCodeBlockStyle(startIndex, endIndex, installDir);
  }
  
  // Language label: right-aligned, configurable spacing
  if (range.style === 'CODE_LANG_LABEL') {
    return buildCodeLangLabelStyle(startIndex, endIndex, installDir);
  }
  
  // Callout styles (CALLOUT_NOTE, CALLOUT_INFO, etc.)
  if (range.style.startsWith('CALLOUT_')) {
    const calloutTypeName = range.style.replace('CALLOUT_', '').toLowerCase();
    const calloutStyle = buildCalloutStyle(startIndex, endIndex, calloutTypeName, installDir);
    if (calloutStyle) return calloutStyle;
  }
  
  // Regular paragraph with named style
  return buildNamedStyle(startIndex, endIndex, range.style);
};

/**
 * Build text style requests for a text range.
 * Returns multiple requests if needed (one for bold/italic/link, one for font).
 */
const buildTextStyleRequests = (range: TextRange, monoFont: string): any[] => {
  const requests: any[] = [];
  const startIndex = range.start + 1;
  const endIndex = range.end + 1;
  
  // Build style request for bold/italic/link
  const fieldList: string[] = [];
  const textStyle: any = {};
  
  if (range.bold) {
    fieldList.push('bold');
    textStyle.bold = true;
  }
  if (range.italic) {
    fieldList.push('italic');
    textStyle.italic = true;
  }
  if (range.linkUrl) {
    fieldList.push('link');
    textStyle.link = { url: range.linkUrl };
  }
  
  if (fieldList.length > 0) {
    requests.push({
      updateTextStyle: {
        range: { startIndex, endIndex },
        textStyle,
        fields: fieldList.join(','),
      },
    });
  }
  
  // Add font request for code
  if (range.codeMono) {
    requests.push({
      updateTextStyle: {
        range: { startIndex, endIndex },
        textStyle: { weightedFontFamily: { fontFamily: monoFont } },
        fields: 'weightedFontFamily',
      },
    });
  }
  
  // Add styling for language label (small font, darker grey for visibility)
  if (range.langLabel) {
    requests.push({
      updateTextStyle: {
        range: { startIndex, endIndex },
        textStyle: {
          fontSize: { magnitude: 8, unit: 'PT' },
          foregroundColor: {
            color: { rgbColor: { red: 0.5, green: 0.5, blue: 0.5 } },
          },
        },
        fields: 'fontSize,foregroundColor',
      },
    });
  }
  
  return requests;
};

/**
 * Build monospace font requests for code block paragraphs.
 * Call this after buildDocsRequests for additional code block styling.
 */
export function buildCodeBlockFontRequests(
  paraRanges: ParaRange[],
  installDir?: string
): any[] {
  const monoFont = getMonoFont(installDir);
  
  return paraRanges
    .filter(r => r.style === 'CODEBLOCK' && r.end > r.start)
    .map(r => ({
      updateTextStyle: {
        range: { startIndex: r.start + 1, endIndex: r.end + 1 },
        textStyle: { weightedFontFamily: { fontFamily: monoFont } },
        fields: 'weightedFontFamily',
      },
    }));
}


