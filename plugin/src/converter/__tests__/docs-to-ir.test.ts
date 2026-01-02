/**
 * Unit tests for docs-to-ir.ts
 * Tests conversion of Google Docs structure to Intermediate Representation (IR)
 */

import { docsToIR, mergeAdjacentSpans } from '../docs-to-ir';

// Helper to create a minimal Google Docs paragraph structure
function createDocParagraph(
  text: string,
  options: {
    style?: string;
    bold?: boolean;
    italic?: boolean;
    link?: string;
    fontFamily?: string;
    shading?: boolean;
  } = {}
) {
  return {
    paragraph: {
      elements: [
        {
          textRun: {
            content: text + '\n',
            textStyle: {
              bold: options.bold,
              italic: options.italic,
              link: options.link ? { url: options.link } : undefined,
              weightedFontFamily: options.fontFamily 
                ? { fontFamily: options.fontFamily } 
                : undefined,
            },
          },
        },
      ],
      paragraphStyle: {
        namedStyleType: options.style || 'NORMAL_TEXT',
        shading: options.shading ? { backgroundColor: {} } : undefined,
      },
    },
  };
}

// Helper to create inline object element (image)
function createImageElement(objectId: string) {
  return {
    inlineObjectElement: {
      inlineObjectId: objectId,
    },
  };
}

describe('docsToIR', () => {
  describe('paragraph types', () => {
    it('should parse TITLE paragraph', () => {
      const doc = {
        body: {
          content: [createDocParagraph('My Title', { style: 'TITLE' })],
        },
      };
      const result = docsToIR(doc);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('title');
      expect(result[0].spans[0].text).toBe('My Title');
    });

    it('should parse SUBTITLE paragraph', () => {
      const doc = {
        body: {
          content: [createDocParagraph('My Subtitle', { style: 'SUBTITLE' })],
        },
      };
      const result = docsToIR(doc);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('subtitle');
    });

    it('should parse heading levels', () => {
      const doc = {
        body: {
          content: [
            createDocParagraph('H1', { style: 'HEADING_1' }),
            createDocParagraph('H2', { style: 'HEADING_2' }),
            createDocParagraph('H3', { style: 'HEADING_3' }),
          ],
        },
      };
      const result = docsToIR(doc);
      expect(result).toHaveLength(3);
      expect(result[0].type).toBe('heading');
      expect(result[0].level).toBe(1);
      expect(result[1].level).toBe(2);
      expect(result[2].level).toBe(3);
    });

    it('should detect code block from shading', () => {
      const doc = {
        body: {
          content: [createDocParagraph('const x = 1;', { shading: true })],
        },
      };
      const result = docsToIR(doc);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('code_block');
      expect(result[0].spans[0].code).toBe(true);
    });

    it('should parse normal paragraph', () => {
      const doc = {
        body: {
          content: [createDocParagraph('Regular text', { style: 'NORMAL_TEXT' })],
        },
      };
      const result = docsToIR(doc);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('paragraph');
    });
  });

  describe('text styles', () => {
    it('should parse bold text', () => {
      const doc = {
        body: {
          content: [createDocParagraph('Bold text', { bold: true })],
        },
      };
      const result = docsToIR(doc);
      expect(result[0].spans[0].bold).toBe(true);
    });

    it('should parse italic text', () => {
      const doc = {
        body: {
          content: [createDocParagraph('Italic text', { italic: true })],
        },
      };
      const result = docsToIR(doc);
      expect(result[0].spans[0].italic).toBe(true);
    });

    it('should parse links', () => {
      const doc = {
        body: {
          content: [createDocParagraph('Link text', { link: 'https://example.com' })],
        },
      };
      const result = docsToIR(doc);
      expect(result[0].spans[0].link).toBe('https://example.com');
    });

    it('should detect monospace font as code', () => {
      const doc = {
        body: {
          content: [createDocParagraph('Code text', { fontFamily: 'Roboto Mono' })],
        },
      };
      const result = docsToIR(doc);
      expect(result[0].spans[0].code).toBe(true);
    });
  });

  describe('inline images', () => {
    it('should extract Joplin image from GCS URL', () => {
      const resourceId = 'abc123def456abc123def456abc123de';
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [createImageElement('img1')],
                paragraphStyle: {},
              },
            },
          ],
        },
        inlineObjects: {
          img1: {
            inlineObjectProperties: {
              embeddedObject: {
                imageProperties: {
                  sourceUri: `https://storage.googleapis.com/bucket/joplin_img_${resourceId}_1234567890.png`,
                },
              },
            },
          },
        },
      };
      const result = docsToIR(doc);
      expect(result).toHaveLength(1);
      expect(result[0].spans[0].text).toBe(`![](:/` + resourceId + `)`);
    });

    it('should use alt text from title', () => {
      const resourceId = 'abc123def456abc123def456abc123de';
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [createImageElement('img1')],
                paragraphStyle: {},
              },
            },
          ],
        },
        inlineObjects: {
          img1: {
            inlineObjectProperties: {
              embeddedObject: {
                title: 'My Image',
                imageProperties: {
                  sourceUri: `https://storage.googleapis.com/bucket/joplin_img_${resourceId}_1234567890.png`,
                },
              },
            },
          },
        },
      };
      const result = docsToIR(doc);
      expect(result[0].spans[0].text).toBe(`![My Image](:/` + resourceId + `)`);
    });

    it('should return placeholder for external images', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [createImageElement('img1')],
                paragraphStyle: {},
              },
            },
          ],
        },
        inlineObjects: {
          img1: {
            inlineObjectProperties: {
              embeddedObject: {
                imageProperties: {
                  sourceUri: 'https://external.com/image.png',
                },
              },
            },
          },
        },
      };
      const result = docsToIR(doc);
      // GDoc images can't be displayed in Joplin (require auth)
      expect(result[0].spans[0].text).toBe('[GDoc image]');
    });

    it('should include title in placeholder for external images', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [createImageElement('img1')],
                paragraphStyle: {},
              },
            },
          ],
        },
        inlineObjects: {
          img1: {
            inlineObjectProperties: {
              embeddedObject: {
                title: 'My Photo',
                imageProperties: {
                  sourceUri: 'https://external.com/image.png',
                },
              },
            },
          },
        },
      };
      const result = docsToIR(doc);
      expect(result[0].spans[0].text).toBe('[GDoc image: My Photo]');
    });

    it('should handle missing inline object', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [createImageElement('missing')],
                paragraphStyle: {},
              },
            },
          ],
        },
        inlineObjects: {},
      };
      const result = docsToIR(doc);
      expect(result[0].spans[0].text).toBe('[GDoc image]');
    });
  });

  describe('content normalization', () => {
    it('should strip trailing newlines from text runs', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  { textRun: { content: 'Text with newlines\n\n' } },
                ],
                paragraphStyle: {},
              },
            },
          ],
        },
      };
      const result = docsToIR(doc);
      expect(result[0].spans[0].text).toBe('Text with newlines');
    });

    it('should skip empty paragraphs', () => {
      const doc = {
        body: {
          content: [
            createDocParagraph('Valid text'),
            { paragraph: { elements: [{ textRun: { content: '\n' } }], paragraphStyle: {} } },
            createDocParagraph('More text'),
          ],
        },
      };
      const result = docsToIR(doc);
      expect(result).toHaveLength(2);
    });
  });

  describe('mergeAdjacentSpans', () => {
    it('should merge spans with identical styles', () => {
      const doc = [
        {
          type: 'paragraph' as const,
          spans: [
            { text: 'Hello ' },
            { text: 'World' },
          ],
        },
      ];
      const result = mergeAdjacentSpans(doc);
      expect(result[0].spans).toHaveLength(1);
      expect(result[0].spans[0].text).toBe('Hello World');
    });

    it('should not merge spans with different styles', () => {
      const doc = [
        {
          type: 'paragraph' as const,
          spans: [
            { text: 'Normal ' },
            { text: 'Bold', bold: true },
            { text: ' Normal' },
          ],
        },
      ];
      const result = mergeAdjacentSpans(doc);
      expect(result[0].spans).toHaveLength(3);
    });

    it('should merge multiple adjacent same-style spans', () => {
      const doc = [
        {
          type: 'paragraph' as const,
          spans: [
            { text: 'A', bold: true },
            { text: 'B', bold: true },
            { text: 'C', bold: true },
          ],
        },
      ];
      const result = mergeAdjacentSpans(doc);
      expect(result[0].spans).toHaveLength(1);
      expect(result[0].spans[0].text).toBe('ABC');
      expect(result[0].spans[0].bold).toBe(true);
    });
  });
});

