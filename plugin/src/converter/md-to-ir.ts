/**
 * Markdown to IR Converter
 * 
 * Uses marked.lexer() to tokenize Markdown, then walks the token tree
 * to build our intermediate representation (IR).
 */

import { marked, Token, Tokens } from 'marked';
import { IRDocument, Paragraph, StyledSpan, ConverterConfig } from './types';
import { loadConfig } from './config';
import { debug } from './debug';

/**
 * Convert Markdown string to IR document.
 * 
 * @param markdown - The Markdown source
 * @param config - Optional converter configuration
 * @returns The IR document
 */
export function markdownToIR(markdown: string, config?: ConverterConfig): IRDocument {
  const cfg = config || loadConfig();
  
  console.log('[converter] markdownToIR called, input length:', markdown.length);
  
  // Normalize line endings
  const normalized = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  // Use marked's lexer to tokenize
  const tokens = marked.lexer(normalized);
  console.log('[converter] tokens generated:', tokens.length);
  debug('md-to-ir', 'tokens', tokens);
  
  // Convert tokens to IR paragraphs
  const paragraphs: Paragraph[] = [];
  
  for (const token of tokens) {
    const para = tokenToParagraph(token, cfg);
    if (para) {
      paragraphs.push(para);
    }
  }
  
  // Apply title/subtitle rules
  applyTitleRules(paragraphs, cfg);
  
  debug('md-to-ir', 'result', paragraphs);
  return paragraphs;
}

/**
 * Convert a single marked token to a Paragraph.
 */
function tokenToParagraph(token: Token, config: ConverterConfig): Paragraph | null {
  switch (token.type) {
    case 'heading':
      return {
        type: 'heading',
        level: (token as Tokens.Heading).depth,
        spans: inlineTokensToSpans((token as Tokens.Heading).tokens || []),
      };
    
    case 'paragraph':
      return {
        type: 'paragraph',
        spans: inlineTokensToSpans((token as Tokens.Paragraph).tokens || []),
      };
    
    case 'code':
      // Code block: single span with the raw code text
      return {
        type: 'code_block',
        language: (token as Tokens.Code).lang || undefined,
        spans: [{ text: (token as Tokens.Code).text, code: true }],
      };
    
    case 'space':
      // Skip empty space tokens
      return null;
    
    case 'hr':
      // Horizontal rule - render as paragraph with dashes
      return {
        type: 'paragraph',
        spans: [{ text: '---' }],
      };
    
    case 'blockquote':
      // For now, flatten blockquote to paragraph with '>' prefix
      const bqTokens = (token as Tokens.Blockquote).tokens || [];
      const bqSpans: StyledSpan[] = [{ text: '> ' }];
      for (const t of bqTokens) {
        if (t.type === 'paragraph') {
          bqSpans.push(...inlineTokensToSpans((t as Tokens.Paragraph).tokens || []));
        }
      }
      return {
        type: 'paragraph',
        spans: bqSpans,
      };
    
    case 'list':
      // For now, flatten list items to paragraphs
      // TODO: Better list handling in future
      const listToken = token as Tokens.List;
      const listParagraphs: Paragraph[] = [];
      for (let i = 0; i < listToken.items.length; i++) {
        const item = listToken.items[i];
        const startNum = typeof listToken.start === 'number' ? listToken.start : 1;
        const prefix = listToken.ordered ? `${startNum + i}. ` : '- ';
        const itemSpans: StyledSpan[] = [{ text: prefix }];
        for (const t of item.tokens || []) {
          if (t.type === 'text' || t.type === 'paragraph') {
            const textToken = t as Tokens.Text | Tokens.Paragraph;
            if ('tokens' in textToken && textToken.tokens) {
              itemSpans.push(...inlineTokensToSpans(textToken.tokens));
            } else {
              itemSpans.push({ text: textToken.text || '' });
            }
          }
        }
        listParagraphs.push({ type: 'paragraph', spans: itemSpans });
      }
      // Return first item, caller should handle multiple
      // TODO: Return array of paragraphs for lists
      return listParagraphs[0] || null;
    
    default:
      // Unknown token type - log and skip
      debug('md-to-ir', 'unknown-token', { type: token.type, token });
      return null;
  }
}

/**
 * Convert marked inline tokens to styled spans.
 */
function inlineTokensToSpans(tokens: Token[]): StyledSpan[] {
  const spans: StyledSpan[] = [];
  
  for (const token of tokens) {
    const tokenSpans = inlineTokenToSpans(token);
    spans.push(...tokenSpans);
  }
  
  // Merge adjacent spans with same styles
  return mergeSpans(spans);
}

/**
 * Convert a single inline token to one or more spans.
 */
function inlineTokenToSpans(token: Token): StyledSpan[] {
  switch (token.type) {
    case 'text':
      return [{ text: (token as Tokens.Text).text }];
    
    case 'strong':
      // Bold: recursively process children and mark as bold
      const strongChildren = inlineTokensToSpans((token as Tokens.Strong).tokens || []);
      return strongChildren.map(span => ({ ...span, bold: true }));
    
    case 'em':
      // Italic: recursively process children and mark as italic
      const emChildren = inlineTokensToSpans((token as Tokens.Em).tokens || []);
      return emChildren.map(span => ({ ...span, italic: true }));
    
    case 'codespan':
      // Inline code
      return [{ text: (token as Tokens.Codespan).text, code: true }];
    
    case 'link':
      // Link: text with URL
      const linkToken = token as Tokens.Link;
      const linkChildren = inlineTokensToSpans(linkToken.tokens || []);
      // Skip internal Joplin resource links
      if (linkToken.href.startsWith(':/')) {
        // Return as plain text for now (preserve image syntax handled separately)
        return [{ text: linkToken.text || linkToken.href }];
      }
      return linkChildren.map(span => ({ ...span, link: linkToken.href }));
    
    case 'image':
      // Image: preserve the Markdown syntax for now
      // Joplin uses ![alt](:/resourceId) format
      const imgToken = token as Tokens.Image;
      return [{ text: `![${imgToken.text || ''}](${imgToken.href})` }];
    
    case 'br':
      // Line break
      return [{ text: '\n' }];
    
    case 'escape':
      // Escaped character
      return [{ text: (token as Tokens.Escape).text }];
    
    default:
      // Unknown inline token - try to extract text
      if ('text' in token) {
        return [{ text: (token as any).text || '' }];
      }
      debug('md-to-ir', 'unknown-inline-token', { type: token.type, token });
      return [];
  }
}

/**
 * Merge adjacent spans with identical styles.
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

/**
 * Apply title/subtitle rules based on config.
 */
function applyTitleRules(paragraphs: Paragraph[], config: ConverterConfig): void {
  if (paragraphs.length === 0) return;
  
  // First paragraph becomes title if configured
  if (config.title?.useTitle) {
    paragraphs[0].type = 'title';
    paragraphs[0].level = undefined;
  }
  
  // Detect subtitle (first italic paragraph after title)
  if (config.subtitle?.mode === 'italic' && paragraphs.length > 1) {
    for (let i = 1; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      if (para.type === 'code_block') continue;
      
      // Check if all spans are italic
      const allItalic = para.spans.length > 0 && 
        para.spans.every(span => span.italic || span.text.trim() === '');
      
      if (allItalic) {
        para.type = 'subtitle';
        break;
      }
      
      // Stop looking if we hit a non-empty, non-italic paragraph
      if (para.spans.some(s => s.text.trim() !== '')) {
        break;
      }
    }
  }
}

