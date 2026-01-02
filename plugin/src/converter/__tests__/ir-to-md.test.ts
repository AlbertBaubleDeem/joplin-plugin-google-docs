/**
 * Unit tests for ir-to-md.ts
 * Tests conversion of Intermediate Representation (IR) to Markdown
 */

import { irToMarkdown, normalizeMarkdown } from '../ir-to-md';
import { IRDocument, Paragraph } from '../types';

describe('irToMarkdown', () => {
  describe('headings', () => {
    it('should render title as H1', () => {
      const doc: IRDocument = [
        { type: 'title', spans: [{ text: 'My Title' }] },
      ];
      const result = irToMarkdown(doc);
      expect(result).toBe('# My Title');
    });

    it('should render heading with level', () => {
      const doc: IRDocument = [
        { type: 'title', spans: [{ text: 'Title' }] },
        { type: 'heading', level: 2, spans: [{ text: 'Section' }] },
      ];
      const result = irToMarkdown(doc);
      expect(result).toContain('## Section');
    });

    it('should render multiple heading levels', () => {
      const doc: IRDocument = [
        { type: 'title', spans: [{ text: 'Title' }] },
        { type: 'heading', level: 2, spans: [{ text: 'H2' }] },
        { type: 'heading', level: 3, spans: [{ text: 'H3' }] },
        { type: 'heading', level: 4, spans: [{ text: 'H4' }] },
      ];
      const result = irToMarkdown(doc);
      expect(result).toContain('## H2');
      expect(result).toContain('### H3');
      expect(result).toContain('#### H4');
    });
  });

  describe('inline formatting', () => {
    it('should render bold text', () => {
      const doc: IRDocument = [
        { type: 'paragraph', spans: [
          { text: 'This is ' },
          { text: 'bold', bold: true },
          { text: ' text' },
        ]},
      ];
      const result = irToMarkdown(doc);
      expect(result).toBe('This is **bold** text');
    });

    it('should render italic text', () => {
      const doc: IRDocument = [
        { type: 'paragraph', spans: [
          { text: 'This is ' },
          { text: 'italic', italic: true },
          { text: ' text' },
        ]},
      ];
      const result = irToMarkdown(doc);
      expect(result).toBe('This is *italic* text');
    });

    it('should render bold and italic combined', () => {
      const doc: IRDocument = [
        { type: 'paragraph', spans: [
          { text: 'This is ' },
          { text: 'bold italic', bold: true, italic: true },
        ]},
      ];
      const result = irToMarkdown(doc);
      expect(result).toBe('This is ***bold italic***');
    });

    it('should render inline code', () => {
      const doc: IRDocument = [
        { type: 'paragraph', spans: [
          { text: 'Use ' },
          { text: 'console.log()', code: true },
          { text: ' for debugging' },
        ]},
      ];
      const result = irToMarkdown(doc);
      expect(result).toBe('Use `console.log()` for debugging');
    });

    it('should render links', () => {
      const doc: IRDocument = [
        { type: 'paragraph', spans: [
          { text: 'Visit ' },
          { text: 'Google', link: 'https://google.com' },
          { text: ' for search' },
        ]},
      ];
      const result = irToMarkdown(doc);
      expect(result).toBe('Visit [Google](https://google.com) for search');
    });
  });

  describe('code blocks', () => {
    it('should render code block with language', () => {
      const doc: IRDocument = [
        { type: 'title', spans: [{ text: 'Title' }] },
        { type: 'code_block', language: 'javascript', spans: [{ text: 'const x = 1;', code: true }] },
      ];
      const result = irToMarkdown(doc);
      expect(result).toContain('```javascript\nconst x = 1;\n```');
    });

    it('should render code block without language', () => {
      const doc: IRDocument = [
        { type: 'title', spans: [{ text: 'Title' }] },
        { type: 'code_block', spans: [{ text: 'plain code', code: true }] },
      ];
      const result = irToMarkdown(doc);
      expect(result).toContain('```\nplain code\n```');
    });
  });

  describe('subtitles', () => {
    it('should render subtitle as italic', () => {
      const doc: IRDocument = [
        { type: 'title', spans: [{ text: 'Title' }] },
        { type: 'subtitle', spans: [{ text: 'A subtitle', italic: true }] },
      ];
      const result = irToMarkdown(doc);
      expect(result).toContain('_A subtitle_');
    });
  });

  describe('newline handling', () => {
    it('should separate regular paragraphs with blank lines', () => {
      const doc: IRDocument = [
        { type: 'paragraph', spans: [{ text: 'First paragraph' }] },
        { type: 'paragraph', spans: [{ text: 'Second paragraph' }] },
      ];
      const result = irToMarkdown(doc);
      expect(result).toBe('First paragraph\n\nSecond paragraph');
    });

    it('should use single newline before code blocks', () => {
      const doc: IRDocument = [
        { type: 'paragraph', spans: [{ text: 'Some text' }] },
        { type: 'code_block', spans: [{ text: 'code', code: true }] },
      ];
      const result = irToMarkdown(doc);
      // Single newline before code block (not double)
      expect(result).toBe('Some text\n```\ncode\n```');
    });

    it('should use blank line after code blocks before text', () => {
      const doc: IRDocument = [
        { type: 'code_block', spans: [{ text: 'code', code: true }] },
        { type: 'paragraph', spans: [{ text: 'Text after' }] },
      ];
      const result = irToMarkdown(doc);
      // Double newline after code block before regular text
      expect(result).toBe('```\ncode\n```\n\nText after');
    });

    it('should use single newline before images', () => {
      const doc: IRDocument = [
        { type: 'paragraph', spans: [{ text: 'Some text' }] },
        { type: 'paragraph', spans: [{ text: '![](:/abc123def456abc123def456abc123de)' }] },
      ];
      const result = irToMarkdown(doc);
      // Single newline before image (not double)
      expect(result).toBe('Some text\n![](:/abc123def456abc123def456abc123de)');
    });

    it('should use blank line after images before text', () => {
      const doc: IRDocument = [
        { type: 'paragraph', spans: [{ text: '![](:/abc123def456abc123def456abc123de)' }] },
        { type: 'paragraph', spans: [{ text: 'Text after' }] },
      ];
      const result = irToMarkdown(doc);
      // Double newline after image before regular text
      expect(result).toBe('![](:/abc123def456abc123def456abc123de)\n\nText after');
    });

    it('should use single newline between consecutive code blocks', () => {
      const doc: IRDocument = [
        { type: 'code_block', language: 'js', spans: [{ text: 'code1', code: true }] },
        { type: 'code_block', language: 'py', spans: [{ text: 'code2', code: true }] },
      ];
      const result = irToMarkdown(doc);
      expect(result).toBe('```js\ncode1\n```\n```py\ncode2\n```');
    });
  });

  describe('normalizeMarkdown', () => {
    it('should normalize line endings', () => {
      expect(normalizeMarkdown('a\r\nb')).toBe('a\nb');
      expect(normalizeMarkdown('a\rb')).toBe('a\nb');
    });

    it('should collapse multiple blank lines', () => {
      expect(normalizeMarkdown('a\n\n\n\nb')).toBe('a\n\nb');
    });

    it('should trim whitespace', () => {
      expect(normalizeMarkdown('  hello  ')).toBe('hello');
    });
  });
});

