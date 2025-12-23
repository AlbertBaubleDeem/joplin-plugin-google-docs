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
 * Default Markdown prefixes for paragraph types.
 */
const DEFAULT_PREFIXES: Record<string, string> = {
  title: '# ',
  subtitle: '',
  heading_1: '# ',
  heading_2: '## ',
  heading_3: '### ',
  heading_4: '#### ',
  heading_5: '##### ',
  heading_6: '###### ',
  paragraph: '',
  code_block: '',
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
  
  const lines: string[] = [];
  
  for (const para of doc) {
    const line = paragraphToMarkdown(para, cfg);
    if (line !== null) {
      lines.push(line);
    }
  }
  
  const result = lines.join('\n\n');
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
    return '```' + lang + '\n' + codeText + '\n```';
  }
  
  // Get prefix for paragraph type
  const prefix = getPrefix(para, config);
  
  // Convert spans to inline Markdown
  const content = spansToMarkdown(para.spans, config);
  
  // Skip empty paragraphs
  if (content.trim() === '' && prefix === '') {
    return null;
  }
  
  // Handle subtitle as italic
  if (para.type === 'subtitle' && config.subtitle?.mode === 'italic') {
    return `_${content}_`;
  }
  
  return prefix + content;
}

/**
 * Get the Markdown prefix for a paragraph type.
 */
function getPrefix(para: Paragraph, config: ConverterConfig): string {
  // Check for config overrides via mdPrefixes
  const mdPrefixes = config.mdPrefixes || {};
  
  switch (para.type) {
    case 'title':
      return mdPrefixes.TITLE ?? DEFAULT_PREFIXES.title;
    case 'subtitle':
      return mdPrefixes.SUBTITLE ?? DEFAULT_PREFIXES.subtitle;
    case 'heading':
      const level = para.level || 1;
      const key = `HEADING_${level}` as keyof typeof mdPrefixes;
      return mdPrefixes[key] ?? DEFAULT_PREFIXES[`heading_${level}`] ?? '';
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

