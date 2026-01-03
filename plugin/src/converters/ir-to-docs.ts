/**
 * IR to Google Docs Converter
 * 
 * Converts the intermediate representation (IR) to:
 * 1. Plain text for insertion
 * 2. Style ranges for batchUpdate requests
 */

import { IRDocument, Paragraph, StyledSpan, PlainTextWithRanges, ParaRange, TextRange } from './types';
import { getMonoFont } from './config';
import { debug } from './debug';

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
  let plain = '';
  let cursor = 0;
  let prevWasCodeBlock = false;
  
  for (const para of doc) {
    const isCodeBlock = para.type === 'code_block';
    
    // Insert blank line between consecutive code blocks to prevent visual merging
    if (isCodeBlock && prevWasCodeBlock) {
      // Add empty paragraph (just a newline) as separator
      paraRanges.push({
        start: cursor,
        end: cursor,
        style: 'NORMAL_TEXT',
      });
      plain += '\n';
      cursor += 1;
    }
    
    const { text, ranges } = paragraphToTextAndRanges(para, cursor);
    
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
    
    // Append to plain text with newline
    plain += text + '\n';
    cursor = paraEnd + 1;
    prevWasCodeBlock = isCodeBlock;
  }
  
  const result = { plain, paraRanges, textRanges };
  debug('ir-to-docs', 'result', result);
  return result;
}

/**
 * Convert a paragraph to text and inline style ranges.
 * 
 * For code blocks, newlines are converted to vertical tabs (\u000B)
 * which creates soft line breaks within the same paragraph in Google Docs.
 */
function paragraphToTextAndRanges(
  para: Paragraph,
  startOffset: number
): { text: string; ranges: TextRange[] } {
  let text = '';
  const ranges: TextRange[] = [];
  const isCodeBlock = para.type === 'code_block';
  
  for (const span of para.spans) {
    const spanStart = startOffset + text.length;
    
    // For code blocks, replace newlines with vertical tabs (soft line breaks)
    // This keeps all code lines in a single Google Docs paragraph
    let spanText = span.text;
    if (isCodeBlock) {
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
}

/**
 * Get the Google Docs named style type for a paragraph.
 */
function getParagraphStyle(para: Paragraph): string {
  switch (para.type) {
    case 'title':
      return 'TITLE';
    case 'subtitle':
      return 'SUBTITLE';
    case 'heading':
      return `HEADING_${para.level || 1}`;
    case 'code_block':
      return 'CODEBLOCK'; // Custom style, handled specially
    case 'paragraph':
    default:
      return 'NORMAL_TEXT';
  }
}

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
  const { paraRanges, textRanges } = plainWithRanges;
  const monoFont = getMonoFont(installDir);
  
  debug('ir-to-docs', 'buildDocsRequests', { paraRanges, textRanges, monoFont });
  
  // Build paragraph style requests
  const paraReqs = paraRanges
    .filter(r => r.end > r.start)
    .map(r => buildParagraphStyleRequest(r, monoFont));
  
  // Build text style requests
  const textReqs = textRanges
    .filter(r => r.end > r.start)
    .flatMap(r => buildTextStyleRequests(r, monoFont));
  
  return [...paraReqs, ...textReqs];
}

/**
 * Build a paragraph style request.
 */
function buildParagraphStyleRequest(range: ParaRange, monoFont: string): any {
  // Docs API uses 1-based indices
  const startIndex = range.start + 1;
  const endIndex = range.end + 1;
  
  if (range.style === 'CODEBLOCK') {
    // Code blocks get special styling (shading + border + spacing)
    return {
      updateParagraphStyle: {
        range: { startIndex, endIndex },
        paragraphStyle: {
          shading: {
            backgroundColor: {
              color: { rgbColor: { red: 0.96, green: 0.96, blue: 0.96 } },
            },
          },
          borderLeft: {
            width: { magnitude: 1, unit: 'PT' },
            padding: { magnitude: 6, unit: 'PT' },
            color: { color: { rgbColor: { red: 0.8, green: 0.8, blue: 0.8 } } },
            dashStyle: 'SOLID',
          },
          spaceBelow: { magnitude: 12, unit: 'PT' },
        },
        fields: 'shading,borderLeft,spaceBelow',
      },
    };
  }
  
  // Regular paragraph with named style
  return {
    updateParagraphStyle: {
      range: { startIndex, endIndex },
      paragraphStyle: { namedStyleType: range.style },
      fields: 'namedStyleType',
    },
  };
}

/**
 * Build text style requests for a text range.
 * Returns multiple requests if needed (one for bold/italic/link, one for font).
 */
function buildTextStyleRequests(range: TextRange, monoFont: string): any[] {
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
  
  return requests;
}

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

