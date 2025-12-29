/**
 * Google Docs to IR Converter
 * 
 * Parses Google Docs document structure (from documents.get API)
 * and converts it to the intermediate representation (IR).
 */

import { IRDocument, Paragraph, StyledSpan, ParagraphType, ConverterConfig } from './types';
import { loadConfig } from './config';
import { debug } from './debug';

/**
 * Google Docs text style structure (subset).
 */
type DocsTextStyle = {
  bold?: boolean;
  italic?: boolean;
  weightedFontFamily?: { fontFamily?: string };
  link?: { url?: string };
};

/**
 * Google Docs paragraph style structure (subset).
 */
type DocsParagraphStyle = {
  namedStyleType?: string;
  shading?: any;
  borderLeft?: any;
};

/**
 * Convert a Google Docs document to IR.
 * 
 * @param doc - The document object from documents.get API
 * @param config - Optional converter configuration
 * @returns The IR document
 */
export function docsToIR(doc: any, config?: ConverterConfig): IRDocument {
  const cfg = config || loadConfig();
  const body = doc?.body?.content || [];
  
  debug('docs-to-ir', 'input', body);
  
  const paragraphs: Paragraph[] = [];
  
  for (const element of body) {
    const para = elementToParagraph(element, cfg);
    if (para) {
      paragraphs.push(para);
    }
  }
  
  debug('docs-to-ir', 'result', paragraphs);
  return paragraphs;
}

/**
 * Convert a document element to a Paragraph.
 */
function elementToParagraph(element: any, config: ConverterConfig): Paragraph | null {
  const p = element?.paragraph;
  if (!p?.elements?.length) return null;
  
  const paragraphStyle: DocsParagraphStyle = p.paragraphStyle || {};
  const namedStyle = paragraphStyle.namedStyleType;
  
  // Determine paragraph type
  const { type, level } = determineParagraphType(paragraphStyle, config);
  
  // Extract spans from text runs
  const spans: StyledSpan[] = [];
  
  for (const el of p.elements) {
    const span = textRunToSpan(el, type === 'code_block', config);
    if (span) {
      spans.push(span);
    }
  }
  
  // Skip empty paragraphs
  if (spans.length === 0 || spans.every(s => s.text.trim() === '')) {
    return null;
  }
  
  return { type, level, spans };
}

/**
 * Determine paragraph type from Google Docs paragraph style.
 */
function determineParagraphType(
  style: DocsParagraphStyle,
  config: ConverterConfig
): { type: ParagraphType; level?: number } {
  const namedStyle = style.namedStyleType;
  
  // Check for code block (shading or border indicates code)
  const isCodeBlock = !!(style.shading || style.borderLeft);
  if (isCodeBlock && config.code?.block?.detect !== false) {
    return { type: 'code_block' };
  }
  
  // Map named styles to paragraph types
  switch (namedStyle) {
    case 'TITLE':
      return { type: 'title' };
    case 'SUBTITLE':
      return { type: 'subtitle' };
    case 'HEADING_1':
      return { type: 'heading', level: 1 };
    case 'HEADING_2':
      return { type: 'heading', level: 2 };
    case 'HEADING_3':
      return { type: 'heading', level: 3 };
    case 'HEADING_4':
      return { type: 'heading', level: 4 };
    case 'HEADING_5':
      return { type: 'heading', level: 5 };
    case 'HEADING_6':
      return { type: 'heading', level: 6 };
    default:
      return { type: 'paragraph' };
  }
}

/**
 * Convert a Google Docs textRun to a StyledSpan.
 */
function textRunToSpan(
  element: any,
  isCodeBlock: boolean,
  config: ConverterConfig
): StyledSpan | null {
  const textRun = element?.textRun;
  if (!textRun?.content) return null;
  
  // Normalize content
  let text = textRun.content
    // Remove trailing newlines (Docs adds these to runs)
    .replace(/\n+$/g, '')
    // Replace vertical tab with newline (Docs quirky linebreak)
    .replace(/\u000B/g, '\n')
    // Remove Private Use Area chars (Docs variable markers)
    .replace(/[\uE000-\uF8FF]/g, '');
  
  if (text.length === 0) return null;
  
  // Extract text style
  const textStyle: DocsTextStyle = textRun.textStyle || {};
  
  // Check for monospace font (indicates inline code)
  const fontFamily = textStyle.weightedFontFamily?.fontFamily || '';
  const isMonospace = fontFamily.toLowerCase().includes('mono');
  
  // Build span
  const span: StyledSpan = { text };
  
  // In code blocks, don't apply inline styles
  if (isCodeBlock) {
    span.code = true;
    return span;
  }
  
  // Apply styles
  if (textStyle.bold) span.bold = true;
  if (textStyle.italic) span.italic = true;
  if (isMonospace) span.code = true;
  if (textStyle.link?.url) span.link = textStyle.link.url;
  
  return span;
}

/**
 * Merge adjacent spans with identical styles.
 * Call this after docsToIR for cleaner output.
 */
export function mergeAdjacentSpans(doc: IRDocument): IRDocument {
  return doc.map(para => ({
    ...para,
    spans: mergeSpans(para.spans),
  }));
}

/**
 * Merge adjacent spans with same styles.
 */
function mergeSpans(spans: StyledSpan[]): StyledSpan[] {
  if (spans.length === 0) return [];
  
  const merged: StyledSpan[] = [{ ...spans[0] }];
  
  for (let i = 1; i < spans.length; i++) {
    const current = spans[i];
    const last = merged[merged.length - 1];
    
    // Check if styles match
    if (
      last.bold === current.bold &&
      last.italic === current.italic &&
      last.code === current.code &&
      last.link === current.link
    ) {
      // Merge text
      last.text += current.text;
    } else {
      merged.push({ ...current });
    }
  }
  
  return merged;
}

