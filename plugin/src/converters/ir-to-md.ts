/**
 * IR to Markdown Converter
 * 
 * Converts the intermediate representation (IR) to Markdown string.
 * This is used for the pull (Docs→MD) direction.
 */

import { IRDocument, Paragraph, StyledSpan, ConverterConfig, DocBlock, TableBlock, isParagraph } from './types';
import { loadConfig } from './config';
import { debug } from './debug';

const isImageOnlyParagraph = (para: Paragraph): boolean => {
  if (para.spans.length !== 1) return false;
  const text = para.spans[0].text.trim();
  // Match Joplin image syntax: ![alt](:/resourceId) or ![](:/resourceId)
  return /^!\[.*?\]\(:\/[a-fA-F0-9]{32}\)$/.test(text);
};

const isListItemParagraph = (para: Paragraph): boolean => {
  // Check type first (new list_item type)
  if (para.type === 'list_item') return true;
  
  // Legacy detection: list items start with markers
  if (para.spans.length === 0) return false;
  const firstSpan = para.spans[0].text;
  // Match various list markers
  return /^[-*•◦▪]\s/.test(firstSpan) || /^\d+\.\s/.test(firstSpan);
};

/**
 * - Code blocks: Triple backticks are self-delimiting
 * - Images: Already visually distinct as inline elements
 * - Callouts: HTML-like tags are self-delimiting
 */
const isSelfDelimitingParagraph = (para: Paragraph): boolean => {
  return para.type === 'code_block' || para.type === 'callout' || isImageOnlyParagraph(para);
};

/** Escape pipe for GFM table cell content; use <br> for newlines so row stays one line (Joplin/marked) and renders as multiline; no spaces around <br> to avoid space growth on roundtrip */
const escapeCell = (s: string): string =>
  s.replace(/\|/g, '\\|').replace(/\n/g, '<br>');

/**
 * Determine the newline delimiter between two blocks.
 * Single newline before tables; blank line after tables (required by marked to
 * terminate the table — without it, marked absorbs the next line as a table row).
 */
const getDelimiter = (prev: DocBlock, current: DocBlock): string => {
  if (current.type === 'table') return '\n';
  if (prev.type === 'table') return '\n\n';
  const prevPara = prev;
  const currentPara = current;
  const prevIsListItem = isListItemParagraph(prevPara);
  const currIsListItem = isListItemParagraph(currentPara);
  const prevIsSelfDelim = isSelfDelimitingParagraph(prevPara);
  const currIsSelfDelim = isSelfDelimitingParagraph(currentPara);

  if (prevIsListItem && currIsListItem) return '\n';
  if (prevPara.type === 'code_block' && currentPara.type === 'code_block') return '\n\n';
  if (currIsSelfDelim) return '\n';
  if (prevIsSelfDelim) return '\n\n';
  const prevIsPlainText = prevPara.type === 'paragraph';
  const currIsPlainText = currentPara.type === 'paragraph';
  if (prevIsPlainText && currIsPlainText && !currentPara.hasPrecedingSeparator) return '\n';
  return '\n\n';
};

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
  
  const converted: { text: string; block: DocBlock }[] = [];

  for (const block of doc) {
    if (block.type === 'table') {
      converted.push({ text: tableBlockToMarkdown(block, cfg), block });
    } else {
      const line = paragraphToMarkdown(block, cfg, listState);
      if (line != null && line !== '') {
        converted.push({ text: line, block });
      }
    }
  }

  const parts: string[] = [];
  for (let i = 0; i < converted.length; i++) {
    const current = converted[i];
    if (i === 0) {
      parts.push(current.text);
    } else {
      const prev = converted[i - 1];
      parts.push(getDelimiter(prev.block, current.block) + current.text);
    }
  }
  
  const result = parts.join('');
  debug('ir-to-md', 'result', result);
  return result;
}

/**
 * Convert a paragraph to a Markdown line.
 */
const paragraphToMarkdown = (
  para: Paragraph, 
  config: ConverterConfig,
  listState?: ListNumberingState
): string | null => {
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
};

const getPrefix = (para: Paragraph, config: ConverterConfig): string => {
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
};

const spansToMarkdown = (spans: StyledSpan[], config: ConverterConfig): string => {
  return spans.map(span => spanToMarkdown(span, config)).join('');
};

/**
 * Convert a table block to GFM markdown with column-aligned cells (pretty-printed).
 */
const tableBlockToMarkdown = (table: TableBlock, config: ConverterConfig): string => {
  const cellToText = (cell: StyledSpan[]): string =>
    escapeCell(spansToMarkdown(cell, config).trim());
  const headerCells = table.headerRow.map(cellToText);
  const colCount = Math.max(headerCells.length, ...table.rows.map(r => r.length));
  const padToCount = (arr: string[]): string[] => {
    const out = [...arr];
    while (out.length < colCount) out.push('');
    return out;
  };
  const allRows: string[][] = [
    padToCount(headerCells),
    ...table.rows.map(row => padToCount(row.map(cellToText))),
  ];
  const colWidths = Array.from({ length: colCount }, (_, j) =>
    Math.max(3, ...allRows.map(row => (row[j] ?? '').length))
  );
  const padCell = (text: string, j: number): string =>
    (text ?? '').padEnd(colWidths[j], ' ');
  const headerLine = '| ' + allRows[0].map((c, j) => padCell(c, j)).join(' | ') + ' |';
  const delimiterLine = '| ' + colWidths.map(w => '---'.padEnd(w, '-')).join(' | ') + ' |';
  const dataLines = allRows.slice(1).map(row =>
    '| ' + row.map((c, j) => padCell(c, j)).join(' | ') + ' |'
  );
  return [headerLine, delimiterLine, ...dataLines].join('\n');
};

const spanToMarkdown = (span: StyledSpan, config: ConverterConfig): string => {
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
};

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
