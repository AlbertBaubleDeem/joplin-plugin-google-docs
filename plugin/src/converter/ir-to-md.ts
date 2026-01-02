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
 * List items start with "- " (unordered) or "N. " (ordered).
 */
function isListItemParagraph(para: Paragraph): boolean {
  if (para.spans.length === 0) return false;
  const firstSpan = para.spans[0].text;
  // Match "- " for unordered or "1. ", "2. " etc for ordered
  return /^-\s/.test(firstSpan) || /^\d+\.\s/.test(firstSpan);
}

/**
 * Check if a paragraph is self-delimiting and doesn't need extra blank lines.
 * 
 * - Code blocks: Triple backticks are self-delimiting
 * - Images: Already visually distinct as inline elements
 */
function isSelfDelimitingParagraph(para: Paragraph): boolean {
  return para.type === 'code_block' || isImageOnlyParagraph(para);
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
 * Convert IR document to Markdown string.
 * 
 * @param doc - The IR document
 * @param config - Optional converter configuration
 * @returns The Markdown string
 */
export function irToMarkdown(doc: IRDocument, config?: ConverterConfig): string {
  const cfg = config || loadConfig();
  
  debug('ir-to-md', 'input', doc);
  
  // Convert paragraphs and keep reference to original for delimiter logic
  const converted: { text: string; para: Paragraph }[] = [];
  
  for (const para of doc) {
    const line = paragraphToMarkdown(para, cfg);
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
function paragraphToMarkdown(para: Paragraph, config: ConverterConfig): string | null {
  // Handle code blocks specially
  if (para.type === 'code_block') {
    const codeText = para.spans.map(s => s.text).join('');
    const lang = para.language || '';
    const fence = config.code?.block?.marker || '```';
    return fence + lang + '\n' + codeText + '\n' + fence;
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

