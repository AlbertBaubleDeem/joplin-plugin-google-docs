/**
 * Google Docs to IR Converter
 * 
 * Parses Google Docs document structure (from documents.get API)
 * and converts it to the intermediate representation (IR).
 * 
 * Handles:
 * - Text runs with styles (bold, italic, code, links)
 * - Inline images (via inlineObjectElement with description for roundtrip)
 * - Paragraph styles (headings, code blocks, etc.)
 * - Native Google Docs lists (ordered and unordered with nesting)
 */

import { IRDocument, Paragraph, StyledSpan, ParagraphType, ConverterConfig, CalloutType, TableBlock, DocBlock } from './types';
import { loadConfig } from './config';
import { debug } from './debug';
import { calloutDefinitions, matchCalloutByColor } from './callout-config';

/** Google Docs text style structure (subset). */
type DocsTextStyle = {
  bold?: boolean;
  italic?: boolean;
  weightedFontFamily?: { fontFamily?: string };
  link?: { url?: string };
};

/** Google Docs paragraph style structure (subset). */
type DocsParagraphStyle = {
  namedStyleType?: string;
  shading?: any;
  borderLeft?: any;
};

/** Google Docs inline object dictionary. Maps objectId -> inlineObject data. */
type InlineObjectsDict = Record<string, any>;

/** Google Docs lists dictionary. Maps listId -> list properties with nesting levels. */
type ListsDict = Record<string, {
  listProperties?: {
    nestingLevels?: Array<{
      glyphType?: string;
      glyphSymbol?: string;
      glyphFormat?: string;
    }>;
  };
}>;

/** Result of list type detection. */
type ListDetectionResult = {
  isListItem: true;
  listType: 'ordered' | 'unordered';
  nestingLevel: number;
} | {
  isListItem: false;
};

/**
 * Ordered list glyph types in Google Docs.
 * Includes all known variations (with/without underscores).
 */
const orderedGlyphTypes = [
  'DECIMAL',
  'ALPHA',
  'ROMAN',
  'UPPER_ALPHA',
  'UPPER_ROMAN',
  'ZERO_DECIMAL',
  'ZERODECIMAL',
  'NUMBER',
  'LOWER_ALPHA',
  'LOWER_ROMAN',
];

/** Escape special regex characters in a string. */
const escapeRegex = (str: string): string => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * Extract Joplin resource ID from a GCS URL.
 * Expected format: https://storage.googleapis.com/{bucket}/joplin_img_{resourceId}_{timestamp}.{ext}
 */
const extractResourceIdFromUrl = (url: string): string | null => {
  if (!url) return null;
  const match = url.match(/joplin_img_([a-fA-F0-9]{32})_\d+\.\w+/);
  return match?.[1] || null;
};

/**
 * Check if a glyph format indicates an ordered list.
 * glyphFormat like "%0." or "%1." indicates numbered list.
 */
const isOrderedGlyphFormat = (glyphFormat?: string): boolean => {
  if (!glyphFormat) return false;
  return /%\d/.test(glyphFormat);
};

/**
 * Detect if a paragraph is a list item and determine its type.
 * 
 * @param bullet - The bullet property from the paragraph
 * @param lists - The lists dictionary from the document
 * @returns Detection result with list type and nesting level if it's a list item
 */
const detectListItem = (bullet: any, lists: ListsDict): ListDetectionResult => {
  if (!bullet) {
    return { isListItem: false };
  }

  const listId = bullet.listId;
  const nestingLevel = bullet.nestingLevel || 0;
  
  // Get list definition to determine if ordered or unordered
  const listDef = lists[listId];
  const nestingLevelDef = listDef?.listProperties?.nestingLevels?.[nestingLevel];
  const glyphType = nestingLevelDef?.glyphType;
  const glyphFormat = nestingLevelDef?.glyphFormat;
  const glyphSymbol = nestingLevelDef?.glyphSymbol;
  
  // Determine list type:
  // 1. glyphType is most reliable
  // 2. Fallback to glyphFormat for some list presets
  // 3. glyphSymbol (like "-" or "•") indicates unordered
  let isOrdered = false;
  if (glyphType) {
    isOrdered = orderedGlyphTypes.includes(glyphType);
  } else if (isOrderedGlyphFormat(glyphFormat)) {
    isOrdered = true;
  }
  if (glyphSymbol) {
    isOrdered = false;
  }
  
  const listType: 'ordered' | 'unordered' = isOrdered ? 'ordered' : 'unordered';
  
  debug('docs-to-ir', 'detected-list-item', { 
    listId, nestingLevel, glyphType, glyphFormat, glyphSymbol, listType
  });
  
  return { isListItem: true, listType, nestingLevel };
};

/**
 * Check if a paragraph has all text runs in monospace font.
 * This indicates a native Google Docs code block (Building Block > Code block).
 * 
 * Logic:
 * - Filter to runs with visible content (excluding PUA markers and whitespace)
 * - All visible runs must have explicit monospace font
 * - Google Docs uses Private Use Area characters (U+E000-U+F8FF) as internal markers
 */
const isAllMonospaceParagraph = (elements: any[]): boolean => {
  // Get text runs with VISIBLE content only
  const textRuns = elements.filter(e => {
    const content = e.textRun?.content;
    if (!content) return false;
    // Remove PUA characters and whitespace, check if anything visible remains
    const visibleContent = content.replace(/[\uE000-\uF8FF\s]/g, '');
    return visibleContent.length > 0;
  });
  
  if (textRuns.length === 0) return false;
  
  let hasMonospace = false;
  for (const e of textRuns) {
    const font = e.textRun?.textStyle?.weightedFontFamily?.fontFamily || '';
    const isMonospace = /mono|courier/i.test(font);
    
    if (isMonospace) {
      hasMonospace = true;
    } else {
      return false; // Visible content without monospace font
    }
  }
  
  return hasMonospace;
};

/**
 * Determine paragraph type from Google Docs paragraph style.
 */
const determineParagraphType = (
  style: DocsParagraphStyle,
  config: ConverterConfig
): { type: ParagraphType; level?: number; calloutType?: CalloutType } => {
  const namedStyle = style.namedStyleType;
  
  // Check for callout box (colored border matching a callout definition)
  if (style.borderLeft?.color?.color?.rgbColor) {
    const borderColor = style.borderLeft.color.color.rgbColor;
    const calloutType = matchCalloutByColor(borderColor);
    if (calloutType) {
      debug('docs-to-ir', 'detected-callout-by-border', { calloutType, borderColor });
      return { type: 'callout', calloutType };
    }
  }
  
  // Check for code block (shading or border indicates code - grey borders)
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
};

/**
 * Check if a Google Docs paragraph element is a language label.
 * Language labels are small grey right-aligned text following a code block.
 */
const isLanguageLabelElement = (element: any): { isLabel: boolean; language?: string } => {
  const p = element?.paragraph;
  if (!p?.elements?.length) return { isLabel: false };
  
  const paragraphStyle = p.paragraphStyle || {};
  
  // Check for right alignment
  if (paragraphStyle.alignment !== 'END') {
    return { isLabel: false };
  }
  
  // Get the text content - should be a single text run with a language name
  const textRuns = p.elements.filter((e: any) => e.textRun?.content);
  if (textRuns.length !== 1) return { isLabel: false };
  
  const textRun = textRuns[0].textRun;
  const content = (textRun.content || '').replace(/\n+$/g, '').trim();
  
  // Language names are typically single words (e.g., "bash", "python", "javascript")
  if (!content || !/^[\w\-+#]+$/.test(content)) {
    return { isLabel: false };
  }
  
  // Check text style for small font and grey color
  const textStyle = textRun.textStyle || {};
  
  const fontSize = textStyle.fontSize?.magnitude;
  if (fontSize && fontSize >= 10) {
    return { isLabel: false };
  }
  
  const fgColor = textStyle.foregroundColor?.color?.rgbColor;
  if (fgColor) {
    const { red = 0, green = 0, blue = 0 } = fgColor;
    const isGrey = red > 0.3 && red < 1 && 
                   green > 0.3 && green < 1 && 
                   blue > 0.3 && blue < 1 &&
                   Math.abs(red - green) < 0.1 && 
                   Math.abs(green - blue) < 0.1;
    if (!isGrey) {
      return { isLabel: false };
    }
  }
  
  debug('docs-to-ir', 'detected-lang-label', { content, fontSize, fgColor });
  return { isLabel: true, language: content };
};

/**
 * Convert an inline object element (image) to a StyledSpan.
 * Extracts the Joplin resource ID from the image's sourceUri.
 */
const inlineObjectToSpan = (
  inlineObjectElement: any,
  inlineObjects: InlineObjectsDict
): StyledSpan | null => {
  const objectId = inlineObjectElement?.inlineObjectId;
  if (!objectId) return null;
  
  const inlineObject = inlineObjects[objectId];
  if (!inlineObject) {
    debug('docs-to-ir', 'missing-inline-object', objectId);
    return { text: '[GDoc image]' };
  }
  
  const embeddedObject = inlineObject?.inlineObjectProperties?.embeddedObject;
  const imageProps = embeddedObject?.imageProperties || {};
  const sourceUri = imageProps?.sourceUri || '';
  const title = embeddedObject?.title || '';
  const description = embeddedObject?.description || '';
  
  debug('docs-to-ir', 'inline-object', { objectId, sourceUri: sourceUri?.substring(0, 60), title });
  
  // Try to extract resource ID from sourceUri (the GCS URL we uploaded)
  const resourceId = extractResourceIdFromUrl(sourceUri);
  if (resourceId) {
    const altText = title || description || '';
    const markdown = altText ? `![${altText}](:/` + resourceId + ')' : `![](:/` + resourceId + ')';
    debug('docs-to-ir', 'image-roundtrip', { objectId, resourceId, markdown });
    return { text: markdown };
  }
  
  // Fallback: images added directly in Google Docs (not from Joplin)
  const altText = title ? `GDoc image: ${title}` : 'GDoc image';
  debug('docs-to-ir', 'image-external', { objectId, altText, sourceUri: sourceUri?.substring(0, 40) });
  return { text: `[${altText}]` };
};

/**
 * Convert a Google Docs element (textRun or inlineObjectElement) to a StyledSpan.
 */
const elementToSpan = (
  element: any,
  isCodeBlock: boolean,
  config: ConverterConfig,
  inlineObjects: InlineObjectsDict
): StyledSpan | null => {
  // Handle inline image objects
  if (element?.inlineObjectElement) {
    return inlineObjectToSpan(element.inlineObjectElement, inlineObjects);
  }
  
  // Handle text runs
  const textRun = element?.textRun;
  if (!textRun?.content) return null;
  
  // Normalize content
  const text = textRun.content
    .replace(/\n+$/g, '')
    .replace(/\u000B/g, '\n')
    .replace(/[\uE000-\uF8FF]/g, '');
  
  if (text.length === 0) return null;
  
  const textStyle: DocsTextStyle = textRun.textStyle || {};
  const fontFamily = textStyle.weightedFontFamily?.fontFamily || '';
  const isMonospace = fontFamily.toLowerCase().includes('mono');
  
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
  if (textStyle.link?.url) {
    let url = textStyle.link.url;
    // Google Docs prepends http:// to URLs without a recognized scheme.
    // Strip it to restore Joplin internal links (:/resourceId).
    if (url.startsWith('http://:/')) {
      url = url.slice(7); // Remove "http://" prefix, keep ":/..."
    }
    span.link = url;
  }
  
  return span;
};

/**
 * Convert a document element to a Paragraph.
 */
const elementToParagraph = (
  element: any,
  config: ConverterConfig,
  inlineObjects: InlineObjectsDict,
  lists: ListsDict
): Paragraph | null => {
  const p = element?.paragraph;
  if (!p?.elements?.length) return null;
  
  const paragraphStyle: DocsParagraphStyle = p.paragraphStyle || {};
  
  // Determine base paragraph type from style
  let { type, level, calloutType } = determineParagraphType(paragraphStyle, config);
  
  // Override to code_block if all-monospace paragraph detected
  if (type === 'paragraph' && isAllMonospaceParagraph(p.elements)) {
    type = 'code_block';
    debug('docs-to-ir', 'detected-native-code-block', p.elements[0]?.textRun?.content?.substring(0, 30));
  }
  
  // Extract spans from text runs and inline objects
  const spans: StyledSpan[] = [];
  for (const el of p.elements) {
    const span = elementToSpan(el, type === 'code_block', config, inlineObjects);
    if (span) {
      spans.push(span);
    }
  }
  
  // Skip empty paragraphs
  if (spans.length === 0 || spans.every(s => s.text.trim() === '')) {
    return null;
  }
  
  // Handle callout: strip the symbol prefix from the content
  if (type === 'callout' && calloutType && spans.length > 0) {
    const calloutDef = calloutDefinitions.find(d => d.type === calloutType);
    if (calloutDef) {
      const symbolPattern = new RegExp(`^${escapeRegex(calloutDef.symbol)}\\s*`);
      if (symbolPattern.test(spans[0].text)) {
        spans[0].text = spans[0].text.replace(symbolPattern, '');
        debug('docs-to-ir', 'stripped-callout-symbol', { calloutType, symbol: calloutDef.symbol });
      }
    }
    return { type, calloutType, spans };
  }
  
  // Handle list items
  const listResult = detectListItem(p.bullet, lists);
  if (listResult.isListItem) {
    return { 
      type: 'list_item', 
      listType: listResult.listType,
      nestingLevel: listResult.nestingLevel,
      spans 
    };
  }
  
  return { type, level, spans };
};

/**
 * Convert a Google Docs table element to a TableBlock.
 * Walks tableRows -> tableCells -> cell content (paragraphs) and extracts spans per cell.
 */
const tableElementToTableBlock = (
  table: any,
  config: ConverterConfig,
  inlineObjects: InlineObjectsDict,
  lists: ListsDict
): TableBlock => {
  const headerRow: StyledSpan[][] = [];
  const rows: StyledSpan[][][] = [];
  const tableRows = table?.tableRows || [];

  const cellToSpans = (cell: any): StyledSpan[] => {
    const content = cell?.content || [];
    const paragraphTexts: string[] = [];
    for (const se of content) {
      const para = se?.paragraph;
      if (!para?.elements) continue;
      let paraText = '';
      for (const el of para.elements) {
        const span = elementToSpan(el, false, config, inlineObjects);
        if (span) paraText += span.text;
      }
      paragraphTexts.push(paraText);
    }
    const cellText = paragraphTexts.join('\n');
    return [{ text: cellText }];
  };

  for (let r = 0; r < tableRows.length; r++) {
    const row = tableRows[r];
    const cells = (row?.tableCells || []).map(cellToSpans);
    if (r === 0) {
      headerRow.push(...cells);
    } else {
      rows.push(cells);
    }
  }

  return { type: 'table', headerRow, rows };
};

/**
 * Merge consecutive code_block paragraphs into a single code block.
 * When mergeAcrossBlankLine is true, also merges when a blank paragraph separates them (paste-artifact case).
 */
const mergeConsecutiveCodeBlocks = (paragraphs: Paragraph[], config?: ConverterConfig): Paragraph[] => {
  if (paragraphs.length === 0) return [];
  
  const mergeAcrossBlank = config?.code?.block?.mergeAcrossBlankLine === true;
  const result: Paragraph[] = [];
  
  for (const para of paragraphs) {
    const last = result[result.length - 1];
    const mayMerge = last?.type === 'code_block' && para.type === 'code_block' &&
      (!para.hasPrecedingSeparator || mergeAcrossBlank);
    
    if (mayMerge) {
      const separator = para.hasPrecedingSeparator ? '\n\n' : '\n';
      last.spans.push({ text: separator }, ...para.spans);
      debug('docs-to-ir', 'merged-code-block', para.spans[0]?.text?.substring(0, 20));
    } else {
      result.push(para);
    }
  }
  
  return result;
};

/**
 * Extract language labels from paragraphs and associate with preceding code blocks.
 */
const extractLanguageLabels = (paragraphs: Paragraph[], rawBody: any[]): Paragraph[] => {
  if (paragraphs.length === 0) return [];
  
  // Build map of paragraph text to raw element for style checking
  const rawElementMap = new Map<string, any>();
  for (const element of rawBody) {
    if (element?.paragraph?.elements) {
      const content = element.paragraph.elements
        .map((e: any) => e.textRun?.content || '')
        .join('')
        .replace(/\n+$/g, '')
        .trim();
      if (content) {
        rawElementMap.set(content, element);
      }
    }
  }
  
  const result: Paragraph[] = [];
  let i = 0;
  
  while (i < paragraphs.length) {
    const para = paragraphs[i];
    
    // Check if next paragraph is a language label for this code block
    if (para.type === 'code_block' && i + 1 < paragraphs.length) {
      const nextPara = paragraphs[i + 1];
      const nextContent = nextPara.spans.map(s => s.text).join('').trim();
      const rawElement = rawElementMap.get(nextContent);
      
      if (rawElement) {
        const { isLabel, language } = isLanguageLabelElement(rawElement);
        if (isLabel && language) {
          para.language = language;
          debug('docs-to-ir', 'extracted-lang-from-label', { language, codePreview: para.spans[0]?.text?.substring(0, 30) });
          result.push(para);
          i += 2; // Skip both code block and label
          continue;
        }
      }
    }
    
    result.push(para);
    i++;
  }
  
  return result;
};

/**
 * Merge adjacent spans with identical styles in paragraph blocks; table blocks unchanged.
 */
export const mergeAdjacentSpans = (doc: IRDocument): IRDocument => {
  return doc.map(block => {
    if (block.type === 'table') return block;
    return { ...block, spans: mergeSpans(block.spans) };
  });
};

const mergeSpans = (spans: StyledSpan[]): StyledSpan[] => {
  if (spans.length === 0) return [];
  
  const merged: StyledSpan[] = [{ ...spans[0] }];
  
  for (let i = 1; i < spans.length; i++) {
    const current = spans[i];
    const last = merged[merged.length - 1];
    
    if (
      last.bold === current.bold &&
      last.italic === current.italic &&
      last.code === current.code &&
      last.link === current.link
    ) {
      last.text += current.text;
    } else {
      merged.push({ ...current });
    }
  }
  
  return merged;
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
  const inlineObjects: InlineObjectsDict = doc?.inlineObjects || {};
  const lists: ListsDict = doc?.lists || {};

  debug('docs-to-ir', 'input', body);
  debug('docs-to-ir', 'inlineObjects-count', Object.keys(inlineObjects).length);
  debug('docs-to-ir', 'lists-count', Object.keys(lists).length);

  const blocks: DocBlock[] = [];
  let lastWasEmpty = false;

  for (const element of body) {
    if (element?.table) {
      blocks.push(tableElementToTableBlock(element.table, cfg, inlineObjects, lists));
      lastWasEmpty = false;
      continue;
    }

    const result = elementToParagraph(element, cfg, inlineObjects, lists);
    if (result === null) {
      lastWasEmpty = true;
      continue;
    }
    if (lastWasEmpty) {
      result.hasPrecedingSeparator = true;
      lastWasEmpty = false;
    }
    blocks.push(result);
  }

  const mergedBlocks = mergeConsecutiveCodeBlocksInDoc(blocks, cfg);
  const finalBlocks = extractLanguageLabelsInDoc(mergedBlocks, body);
  debug('docs-to-ir', 'result', finalBlocks);
  return finalBlocks;
}

/**
 * Merge consecutive code_block paragraphs in-place within a DocBlock list.
 * Tables act as barriers — code blocks on opposite sides of a table are never merged.
 */
const mergeConsecutiveCodeBlocksInDoc = (blocks: DocBlock[], config?: ConverterConfig): DocBlock[] => {
  if (blocks.length === 0) return [];
  const mergeAcrossBlank = config?.code?.block?.mergeAcrossBlankLine === true;
  const result: DocBlock[] = [];

  for (const block of blocks) {
    if (block.type === 'table') {
      result.push(block);
      continue;
    }
    const last = result[result.length - 1];
    const lastIsPara = last && last.type !== 'table';
    const mayMerge = lastIsPara && (last as Paragraph).type === 'code_block' &&
      block.type === 'code_block' &&
      (!(block as Paragraph).hasPrecedingSeparator || mergeAcrossBlank);

    if (mayMerge) {
      const lastPara = last as Paragraph;
      const separator = (block as Paragraph).hasPrecedingSeparator ? '\n\n' : '\n';
      lastPara.spans.push({ text: separator }, ...(block as Paragraph).spans);
      debug('docs-to-ir', 'merged-code-block', (block as Paragraph).spans[0]?.text?.substring(0, 20));
    } else {
      result.push(block);
    }
  }
  return result;
};

/**
 * Extract language labels from code blocks in-place within a DocBlock list.
 * Tables act as barriers — a label is only absorbed if it immediately follows a
 * code block in the block list (not across a table boundary).
 */
const extractLanguageLabelsInDoc = (blocks: DocBlock[], rawBody: any[]): DocBlock[] => {
  if (blocks.length === 0) return [];

  const rawElementMap = new Map<string, any>();
  for (const element of rawBody) {
    if (element?.paragraph?.elements) {
      const content = element.paragraph.elements
        .map((e: any) => e.textRun?.content || '')
        .join('')
        .replace(/\n+$/g, '')
        .trim();
      if (content) rawElementMap.set(content, element);
    }
  }

  const result: DocBlock[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];

    if (block.type !== 'table' && (block as Paragraph).type === 'code_block' && i + 1 < blocks.length) {
      const next = blocks[i + 1];
      if (next.type !== 'table') {
        const nextPara = next as Paragraph;
        const nextContent = nextPara.spans.map(s => s.text).join('').trim();
        const rawElement = rawElementMap.get(nextContent);
        if (rawElement) {
          const { isLabel, language } = isLanguageLabelElement(rawElement);
          if (isLabel && language) {
            (block as Paragraph).language = language;
            debug('docs-to-ir', 'extracted-lang-from-label', {
              language, codePreview: (block as Paragraph).spans[0]?.text?.substring(0, 30),
            });
            result.push(block);
            i += 2;
            continue;
          }
        }
      }
    }

    result.push(block);
    i++;
  }
  return result;
}