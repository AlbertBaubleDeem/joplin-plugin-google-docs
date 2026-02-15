/**
 * IR to Markdown Converter
 * 
 * Converts the intermediate representation (IR) to Markdown string.
 * This is used for the pull (Docs→MD) direction.
 */

import { IRDocument, Paragraph, StyledSpan, ConverterConfig } from './types';
import { loadConfig } from './config';
import { debug } from './debug';

/**
 * Check if a paragraph contains only an image reference.
 */
function isImageOnlyParagraph(para: Paragraph): boolean {
  if (para.spans.length !== 1) return false;
  const text = para.spans[0].text.trim();
  // Match Joplin image syntax: ![alt](:/resourceId) or ![](:/resourceId)
  return /^!\[.*?\]\(:\/[a-fA-F0-9]{32}\)$/.test(text);
}

/**
 * Check if a paragraph is a list item.
 * Checks both the type property and legacy text-based detection.
 */
function isListItemParagraph(para: Paragraph): boolean {
  // Check type first (new list_item type)
  if (para.type === 'list_item') return true;
  
  // Legacy detection: list items start with markers
  if (para.spans.length === 0) return false;
  const firstSpan = para.spans[0].text;
  // Match various list markers
  return /^[-*•◦▪]\s/.test(firstSpan) || /^\d+\.\s/.test(firstSpan);
}

/**
 * Check if a paragraph is self-delimiting and doesn't need extra blank lines.
 * 
 * - Code blocks: Triple backticks are self-delimiting
 * - Images: Already visually distinct as inline elements
 * - Callouts: HTML-like tags are self-delimiting
 */
function isSelfDelimitingParagraph(para: Paragraph): boolean {
  return para.type === 'code_block' || para.type === 'callout' || isImageOnlyParagraph(para);
}

/**
 * Determine the newline delimiter between two paragraphs.
 * 
 * Rules:
 * - List → List: single newline (consecutive list items)
 * - Self-delimiting → Self-delimiting: single newline
 * - Self-delimiting → Text: double newline
 * - Text → Self-delimiting: single newline
 * - Text → Text: double newline
 * - Text → List: double newline (list needs blank line before)
 * - List → Text: double newline
 */
function getDelimiter(prev: Paragraph, current: Paragraph): string {
  const prevIsListItem = isListItemParagraph(prev);
  const currIsListItem = isListItemParagraph(current);
  const prevIsSelfDelim = isSelfDelimitingParagraph(prev);
  const currIsSelfDelim = isSelfDelimitingParagraph(current);
  
  // Consecutive list items: single newline
  if (prevIsListItem && currIsListItem) {
    return '\n';
  }
  
  // Self-delimiting elements
  if (currIsSelfDelim) {
    return '\n';
  }
  if (prevIsSelfDelim) {
    return '\n\n';
  }
  
  // Everything else: double newline
  return '\n\n';
}

/**
 * State for tracking ordered list numbering across nesting levels.
 */
type ListNumberingState = {
  /** Counter for each nesting level */
  counters: number[];
  /** Last nesting level processed */
  lastLevel: number;
  /** Last list type processed */
  lastListType: 'ordered' | 'unordered' | null;
};

/**
 * Convert IR document to Markdown string.
 * 
 * @param doc - The IR document
 * @param config - Optional converter configuration
 * @returns The Markdown string
 */
export function irToMarkdown(doc: IRDocument, config?: ConverterConfig): string {
  const cfg = config || loadConfig();
  
  debug('ir-to-md', 'input', doc);
  
  // State for ordered list numbering
  const listState: ListNumberingState = {
    counters: [],
    lastLevel: -1,
    lastListType: null,
  };
  
  // Convert paragraphs and keep reference to original for delimiter logic
  const converted: { text: string; para: Paragraph }[] = [];
  
  for (const para of doc) {
    const line = paragraphToMarkdown(para, cfg, listState);
    if (line !== null) {
      converted.push({ text: line, para });
    }
  }
  
  // Join paragraphs with appropriate spacing using getDelimiter
  const parts: string[] = [];
  for (let i = 0; i < converted.length; i++) {
    const current = converted[i];
    
    if (i === 0) {
      parts.push(current.text);
    } else {
      const prev = converted[i - 1];
      const delimiter = getDelimiter(prev.para, current.para);
      parts.push(delimiter + current.text);
    }
  }
  
  const result = parts.join('');
  debug('ir-to-md', 'result', result);
  return result;
}

/**
 * Convert a paragraph to a Markdown line.
 */
function paragraphToMarkdown(
  para: Paragraph, 
  config: ConverterConfig,
  listState?: ListNumberingState
): string | null {
  // Handle code blocks specially
  if (para.type === 'code_block') {
    const codeText = para.spans.map(s => s.text).join('');
    const lang = para.language || '';
    const fence = config.code?.block?.marker || '```';
    // Reset list state when we exit a list
    if (listState) {
      listState.lastListType = null;
      listState.lastLevel = -1;
    }
    return fence + lang + '\n' + codeText + '\n' + fence;
  }
  
  // Handle callout boxes
  if (para.type === 'callout' && para.calloutType) {
    const content = spansToMarkdown(para.spans, config);
    // Reset list state when we exit a list
    if (listState) {
      listState.lastListType = null;
      listState.lastLevel = -1;
    }
    return `<${para.calloutType}>${content}</${para.calloutType}>`;
  }
  
  // Handle list items
  if (para.type === 'list_item') {
    const nestingLevel = para.nestingLevel || 0;
    const listType = para.listType || 'unordered';
    const indent = '    '.repeat(nestingLevel);
    
    let marker: string;
    if (listType === 'ordered') {
      // Track ordered list numbering
      if (listState) {
        // Reset counters if list type changed or we're at a different level
        if (listState.lastListType !== 'ordered') {
          listState.counters = [];
          listState.lastListType = 'ordered';
        }
        
        // Ensure counters array is long enough
        while (listState.counters.length <= nestingLevel) {
          listState.counters.push(0);
        }
        
        // Reset deeper levels when going to a shallower level
        if (nestingLevel < listState.lastLevel) {
          for (let i = nestingLevel + 1; i < listState.counters.length; i++) {
            listState.counters[i] = 0;
          }
        }
        
        // Increment counter for current level
        listState.counters[nestingLevel]++;
        listState.lastLevel = nestingLevel;
        
        marker = `${listState.counters[nestingLevel]}. `;
      } else {
        marker = '1. ';
      }
    } else {
      // Unordered list - use configured marker
      const unorderedMarker = config.list?.unorderedMarker || '-';
      marker = `${unorderedMarker} `;
      
      // Update list state
      if (listState) {
        if (listState.lastListType !== 'unordered') {
          listState.counters = [];
        }
        listState.lastListType = 'unordered';
        listState.lastLevel = nestingLevel;
      }
    }
    
    const content = spansToMarkdown(para.spans, config);
    return indent + marker + content;
  }
  
  // Reset list state for non-list paragraphs
  if (listState) {
    listState.lastListType = null;
    listState.lastLevel = -1;
  }
  
  // Get prefix for paragraph type
  const prefix = getPrefix(para, config);
  
  // Handle subtitle as italic - strip italic from spans since whole paragraph is italic
  if (para.type === 'subtitle' && config.subtitle?.mode === 'italic') {
    // Remove italic flag from spans to avoid double-wrapping
    const spansWithoutItalic = para.spans.map(s => ({ ...s, italic: undefined }));
    const content = spansToMarkdown(spansWithoutItalic, config);
    if (content.trim() === '') return null;
    return `_${content}_`;
  }
  
  // Convert spans to inline Markdown
  const content = spansToMarkdown(para.spans, config);
  
  return prefix + content;
}

/**
 * Get the Markdown prefix for a paragraph type.
 */
function getPrefix(para: Paragraph, config: ConverterConfig): string {
  const prefixes = config.mdPrefixes || {};
  
  switch (para.type) {
    case 'title':
      return prefixes.TITLE ?? '# ';
    case 'subtitle':
      return prefixes.SUBTITLE ?? '';
    case 'heading':
      const level = para.level || 1;
      const key = `HEADING_${level}` as keyof typeof prefixes;
      return prefixes[key] ?? '#'.repeat(level) + ' ';
    default:
      return '';
  }
}

/**
 * Convert styled spans to inline Markdown.
 */
function spansToMarkdown(spans: StyledSpan[], config: ConverterConfig): string {
  return spans.map(span => spanToMarkdown(span, config)).join('');
}

/**
 * Convert a single span to Markdown.
 */
function spanToMarkdown(span: StyledSpan, config: ConverterConfig): string {
  let text = span.text;
  
  // Handle inline code first (don't apply other formatting inside code)
  if (span.code) {
    const marker = config.code?.inline?.marker || '`';
    // Don't double-wrap if already has markers
    if (!text.startsWith(marker) || !text.endsWith(marker)) {
      text = marker + text + marker;
    }
    return text;
  }
  
  // Apply link
  if (span.link) {
    text = `[${text}](${span.link})`;
  }
  
  // Apply bold and italic
  // Handle combined bold+italic
  if (span.bold && span.italic) {
    text = `***${text}***`;
  } else if (span.bold) {
    text = `**${text}**`;
  } else if (span.italic) {
    text = `*${text}*`;
  }
  
  return text;
}

/**
 * Normalize Markdown for comparison.
 * Useful for round-trip testing.
 */
export function normalizeMarkdown(md: string): string {
  return md
    // Normalize line endings
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, '\n\n')
    // Trim
    .trim();
}
