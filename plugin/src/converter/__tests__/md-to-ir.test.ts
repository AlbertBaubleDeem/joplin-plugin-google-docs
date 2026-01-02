/**
 * Unit tests for md-to-ir.ts
 * Tests conversion of Markdown to Intermediate Representation (IR)
 */

import { markdownToIR } from '../md-to-ir';
import { Paragraph } from '../types';

// Disable console.log during tests
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('markdownToIR', () => {
  describe('headings', () => {
    it('should parse H1 heading', () => {
      const result = markdownToIR('# Hello World');
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('title'); // First becomes title by default
      expect(result[0].spans[0].text).toBe('Hello World');
    });

    it('should parse H2 heading', () => {
      const result = markdownToIR('# Title\n\n## Subtitle');
      expect(result).toHaveLength(2);
      expect(result[1].type).toBe('heading');
      expect(result[1].level).toBe(2);
      expect(result[1].spans[0].text).toBe('Subtitle');
    });

    it('should parse multiple heading levels', () => {
      const md = '# H1\n\n## H2\n\n### H3\n\n#### H4';
      const result = markdownToIR(md);
      expect(result).toHaveLength(4);
      expect(result[0].type).toBe('title');
      expect(result[1].level).toBe(2);
      expect(result[2].level).toBe(3);
      expect(result[3].level).toBe(4);
    });
  });

  describe('inline formatting', () => {
    it('should parse bold text', () => {
      const result = markdownToIR('This is **bold** text');
      expect(result).toHaveLength(1);
      const spans = result[0].spans;
      expect(spans).toHaveLength(3);
      expect(spans[0].text).toBe('This is ');
      expect(spans[1].text).toBe('bold');
      expect(spans[1].bold).toBe(true);
      expect(spans[2].text).toBe(' text');
    });

    it('should parse italic text', () => {
      const result = markdownToIR('This is *italic* text');
      expect(result).toHaveLength(1);
      const spans = result[0].spans;
      expect(spans).toHaveLength(3);
      expect(spans[1].text).toBe('italic');
      expect(spans[1].italic).toBe(true);
    });

    it('should parse bold and italic combined', () => {
      const result = markdownToIR('This is ***bold italic*** text');
      expect(result).toHaveLength(1);
      const spans = result[0].spans;
      const boldItalicSpan = spans.find(s => s.bold && s.italic);
      expect(boldItalicSpan).toBeDefined();
      expect(boldItalicSpan?.text).toBe('bold italic');
    });

    it('should parse inline code', () => {
      const result = markdownToIR('Use `console.log()` for debugging');
      expect(result).toHaveLength(1);
      const spans = result[0].spans;
      const codeSpan = spans.find(s => s.code);
      expect(codeSpan).toBeDefined();
      expect(codeSpan?.text).toBe('console.log()');
    });

    it('should parse links', () => {
      const result = markdownToIR('Visit [Google](https://google.com) for search');
      expect(result).toHaveLength(1);
      const spans = result[0].spans;
      const linkSpan = spans.find(s => s.link);
      expect(linkSpan).toBeDefined();
      expect(linkSpan?.text).toBe('Google');
      expect(linkSpan?.link).toBe('https://google.com');
    });
  });

  describe('code blocks', () => {
    it('should parse fenced code block', () => {
      const md = '```javascript\nconst x = 1;\n```';
      const result = markdownToIR(md);
      expect(result).toHaveLength(1);
      // Code blocks should NOT be converted to title even if first
      expect(result[0].type).toBe('code_block');
      expect(result[0].language).toBe('javascript');
      expect(result[0].spans[0].text).toBe('const x = 1;');
      expect(result[0].spans[0].code).toBe(true);
    });

    it('should parse code block without language', () => {
      const md = '```\nplain code\n```';
      const result = markdownToIR(md);
      expect(result).toHaveLength(1);
      // Code blocks should NOT be converted to title even if first
      expect(result[0].type).toBe('code_block');
      expect(result[0].language).toBeUndefined();
    });

    it('should not convert code block to title when first', () => {
      // Regression test for bug where code blocks became titles
      const md = '```python\nprint("hello")\n```\n\nSome text after.';
      const result = markdownToIR(md);
      expect(result[0].type).toBe('code_block');
      expect(result[1].type).toBe('paragraph');
    });
  });

  describe('images', () => {
    it('should preserve image syntax', () => {
      const md = '![alt text](https://example.com/img.png)';
      const result = markdownToIR(md);
      expect(result).toHaveLength(1);
      expect(result[0].spans[0].text).toBe('![alt text](https://example.com/img.png)');
    });

    it('should preserve Joplin resource image syntax', () => {
      const md = '![my image](:/abc123def456abc123def456abc123de)';
      const result = markdownToIR(md);
      expect(result).toHaveLength(1);
      expect(result[0].spans[0].text).toBe('![my image](:/abc123def456abc123def456abc123de)');
    });

    it('should handle image with empty alt text', () => {
      const md = '![](:/abc123def456abc123def456abc123de)';
      const result = markdownToIR(md);
      expect(result).toHaveLength(1);
      expect(result[0].spans[0].text).toBe('![](:/abc123def456abc123def456abc123de)');
    });

    it('should not convert image-only paragraph to title when first', () => {
      // Images should stay as paragraphs, not become titles
      const md = '![my image](:/abc123def456abc123def456abc123de)\n\nSome text.';
      const result = markdownToIR(md);
      expect(result[0].type).toBe('paragraph'); // Not 'title'
      expect(result[0].spans[0].text).toContain('![');
    });
  });

  describe('lists', () => {
    it('should parse unordered list', () => {
      const md = '- Item 1\n- Item 2\n- Item 3';
      const result = markdownToIR(md);
      expect(result).toHaveLength(3);
      expect(result[0].spans[0].text).toBe('- ');
      expect(result[0].spans[1].text).toBe('Item 1');
      expect(result[1].spans[1].text).toBe('Item 2');
      expect(result[2].spans[1].text).toBe('Item 3');
    });

    it('should parse ordered list', () => {
      const md = '1. First\n2. Second\n3. Third';
      const result = markdownToIR(md);
      expect(result).toHaveLength(3);
      expect(result[0].spans[0].text).toBe('1. ');
      expect(result[1].spans[0].text).toBe('2. ');
      expect(result[2].spans[0].text).toBe('3. ');
    });

    it('should handle list with formatting', () => {
      const md = '- **Bold item**\n- *Italic item*';
      const result = markdownToIR(md);
      expect(result).toHaveLength(2);
      expect(result[0].spans[1].bold).toBe(true);
      expect(result[1].spans[1].italic).toBe(true);
    });
  });

  describe('blockquotes', () => {
    it('should parse blockquote', () => {
      const md = '> This is a quote';
      const result = markdownToIR(md);
      expect(result).toHaveLength(1);
      expect(result[0].spans[0].text).toBe('> ');
      expect(result[0].spans[1].text).toBe('This is a quote');
    });
  });

  describe('horizontal rules', () => {
    it('should parse horizontal rule', () => {
      const md = 'Before\n\n---\n\nAfter';
      const result = markdownToIR(md);
      const hrPara = result.find(p => p.spans[0]?.text === '---');
      expect(hrPara).toBeDefined();
    });
  });

  describe('title/subtitle detection', () => {
    it('should mark first paragraph as title', () => {
      const result = markdownToIR('My Document Title\n\nSome content');
      expect(result[0].type).toBe('title');
    });

    it('should detect italic paragraph as subtitle', () => {
      const md = '# Title\n\n*This is a subtitle*\n\nRegular paragraph';
      const result = markdownToIR(md);
      expect(result[0].type).toBe('title');
      expect(result[1].type).toBe('subtitle');
      expect(result[2].type).toBe('paragraph');
    });
  });

  describe('mixed content', () => {
    it('should handle complex document', () => {
      const md = `# My Document

*A subtitle here*

This is a paragraph with **bold** and *italic* text.

## Section 1

- List item 1
- List item 2

\`\`\`javascript
const code = true;
\`\`\`

![image](:/abc123def456abc123def456abc123de)

The end.`;

      const result = markdownToIR(md);
      
      // Should have: title, subtitle, paragraph, heading, 2 list items, code block, image paragraph, text paragraph
      expect(result.length).toBeGreaterThanOrEqual(8);
      
      // Verify types
      const types = result.map(p => p.type);
      expect(types).toContain('title');
      expect(types).toContain('subtitle');
      expect(types).toContain('heading');
      expect(types).toContain('code_block');
    });
  });
});

