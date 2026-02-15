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
import { getCalloutDefinition, CALLOUT_BY_TYPE } from './callout-config';

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
  const listRanges: ListRange[] = [];
  let plain = '';
  let cursor = 0;
  let prevWasCodeBlock = false;
  
  // List tracking state
  let currentListType: 'ordered' | 'unordered' | null = null;
  let currentListStart = 0;
  let currentListEnd = 0;
  let maxNestingInCurrentList = 0;
  
  for (let i = 0; i < doc.length; i++) {
    const para = doc[i];
    const isCodeBlock = para.type === 'code_block';
    const isCallout = para.type === 'callout';
    const isListItem = para.type === 'list_item';
    
    // Check if we need to close the current list range
    if (currentListType !== null && (!isListItem || para.listType !== currentListType)) {
      // Close the current list range
      // Subtract maxNestingInCurrentList to prevent deeply nested lists from
      // causing Google Docs to include following paragraphs as list items
      const adjustedEndIndex = currentListEnd - maxNestingInCurrentList;
      if (adjustedEndIndex > currentListStart) {
        listRanges.push({
          startIndex: currentListStart,
          endIndex: adjustedEndIndex,
          listType: currentListType,
        });
        debug('ir-to-docs', 'closed-list-range', { 
          startIndex: currentListStart, 
          endIndex: adjustedEndIndex, 
          listType: currentListType,
          maxNesting: maxNestingInCurrentList
        });
      }
      currentListType = null;
      maxNestingInCurrentList = 0;
    }
    
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
      
      // Start a new list range if needed
      if (currentListType === null) {
        currentListType = para.listType || 'unordered';
        currentListStart = cursor;
        maxNestingInCurrentList = 0;
      }
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
    
    // Update list end position to include full text (newline added separately)
    if (isListItem) {
      currentListEnd = paraEnd;
      // Track max nesting level for later adjustment
      const nestingLevel = para.nestingLevel || 0;
      if (nestingLevel > maxNestingInCurrentList) {
        maxNestingInCurrentList = nestingLevel;
      }
    }
    
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
  
  // Close any remaining list range
  // Apply same nesting adjustment as mid-document closures
  const finalAdjustedEndIndex = currentListEnd - maxNestingInCurrentList;
  if (currentListType !== null && finalAdjustedEndIndex > currentListStart) {
    listRanges.push({
      startIndex: currentListStart,
      endIndex: finalAdjustedEndIndex,
      listType: currentListType,
    });
    debug('ir-to-docs', 'closed-final-list-range', { 
      startIndex: currentListStart, 
      endIndex: finalAdjustedEndIndex, 
      listType: currentListType,
      maxNesting: maxNestingInCurrentList
    });
  }
  
  // Safety clamp: ensure no list range endIndex exceeds plain.length - 1
  // This prevents "endIndex must be less than segment end" API errors
  // when the list extends to the end of the document
  const maxEndIndex = plain.length > 0 ? plain.length - 1 : 0;
  for (const range of listRanges) {
    if (range.endIndex > maxEndIndex) {
      debug('ir-to-docs', 'clamping-list-endIndex', { 
        from: range.endIndex, 
        to: maxEndIndex 
      });
      range.endIndex = maxEndIndex;
    }
  }
  
  const result = { plain, paraRanges, textRanges, calloutRanges, listRanges };
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
    case 'list_item':
      return 'NORMAL_TEXT'; // Lists are styled via createParagraphBullets
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
 * @param listRanges - Array of list ranges
 * @returns Array of Docs API request objects for bullet formatting
 */
export function buildListBulletRequests(listRanges: ListRange[]): any[] {
  return listRanges
    .filter(r => r.endIndex > r.startIndex)
    .map(range => ({
      createParagraphBullets: {
        range: {
          // Docs API uses 1-based indices
          // Use endIndex without +1 to be more conservative and avoid
          // including trailing content in the list
          startIndex: range.startIndex + 1,
          endIndex: range.endIndex,
        },
        bulletPreset: range.listType === 'ordered' 
          ? 'NUMBERED_DECIMAL_NESTED' 
          : 'BULLET_DISC_CIRCLE_SQUARE',
      },
    }));
}

/**
 * Build a paragraph style request.
 */
function buildParagraphStyleRequest(range: ParaRange, monoFont: string, installDir?: string): any {
  // Docs API uses 1-based indices
  const startIndex = range.start + 1;
  const endIndex = range.end + 1;
  
  if (range.style === 'CODEBLOCK') {
    // Code blocks get special styling (shading + border + spacing)
    const spacing = getElementSpacing('code_block', installDir);
    const paragraphStyle: any = {
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
    };
    
    // Build fields list dynamically based on what's set
    const fields = ['shading', 'borderLeft'];
    if (spacing.spaceAbove !== undefined) {
      paragraphStyle.spaceAbove = { magnitude: spacing.spaceAbove, unit: 'PT' };
      fields.push('spaceAbove');
    }
    if (spacing.spaceBelow !== undefined) {
      paragraphStyle.spaceBelow = { magnitude: spacing.spaceBelow, unit: 'PT' };
      fields.push('spaceBelow');
    }
    
    return {
      updateParagraphStyle: {
        range: { startIndex, endIndex },
        paragraphStyle,
        fields: fields.join(','),
      },
    };
  }
  
  if (range.style === 'CODE_LANG_LABEL') {
    // Language label: right-aligned, configurable spacing
    const spacing = getElementSpacing('code_lang_label', installDir);
    const paragraphStyle: any = {
      alignment: 'END',
    };
    
    const fields = ['alignment'];
    if (spacing.spaceAbove !== undefined) {
      paragraphStyle.spaceAbove = { magnitude: spacing.spaceAbove, unit: 'PT' };
      fields.push('spaceAbove');
    }
    if (spacing.spaceBelow !== undefined) {
      paragraphStyle.spaceBelow = { magnitude: spacing.spaceBelow, unit: 'PT' };
      fields.push('spaceBelow');
    }
    
    return {
      updateParagraphStyle: {
        range: { startIndex, endIndex },
        paragraphStyle,
        fields: fields.join(','),
      },
    };
  }
  
  // Check for callout styles (CALLOUT_NOTE, CALLOUT_INFO, etc.)
  if (range.style.startsWith('CALLOUT_')) {
    const calloutTypeName = range.style.replace('CALLOUT_', '').toLowerCase();
    const def = CALLOUT_BY_TYPE[calloutTypeName as keyof typeof CALLOUT_BY_TYPE];
    
    if (def) {
      const spacing = getElementSpacing('callout', installDir);
      
      // Create lighter shade for background (mix with white)
      const bgColor = {
        red: 0.95 + def.rgbColor.red * 0.05,
        green: 0.95 + def.rgbColor.green * 0.05,
        blue: 0.95 + def.rgbColor.blue * 0.05,
      };
      
      const paragraphStyle: any = {
        shading: {
          backgroundColor: {
            color: { rgbColor: bgColor },
          },
        },
        borderLeft: {
          width: { magnitude: 3, unit: 'PT' },
          padding: { magnitude: 8, unit: 'PT' },
          color: { color: { rgbColor: def.rgbColor } },
          dashStyle: 'SOLID',
        },
        borderTop: {
          width: { magnitude: 1, unit: 'PT' },
          padding: { magnitude: 4, unit: 'PT' },
          color: { color: { rgbColor: def.rgbColor } },
          dashStyle: 'SOLID',
        },
        borderBottom: {
          width: { magnitude: 1, unit: 'PT' },
          padding: { magnitude: 4, unit: 'PT' },
          color: { color: { rgbColor: def.rgbColor } },
          dashStyle: 'SOLID',
        },
        borderRight: {
          width: { magnitude: 1, unit: 'PT' },
          padding: { magnitude: 4, unit: 'PT' },
          color: { color: { rgbColor: def.rgbColor } },
          dashStyle: 'SOLID',
        },
      };
      
      const fields = ['shading', 'borderLeft', 'borderTop', 'borderBottom', 'borderRight'];
      if (spacing.spaceAbove !== undefined) {
        paragraphStyle.spaceAbove = { magnitude: spacing.spaceAbove, unit: 'PT' };
        fields.push('spaceAbove');
      }
      if (spacing.spaceBelow !== undefined) {
        paragraphStyle.spaceBelow = { magnitude: spacing.spaceBelow, unit: 'PT' };
        fields.push('spaceBelow');
      }
      
      return {
        updateParagraphStyle: {
          range: { startIndex, endIndex },
          paragraphStyle,
          fields: fields.join(','),
        },
      };
    }
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


