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
 */

import { IRDocument, Paragraph, StyledSpan, ParagraphType, ConverterConfig, CalloutType } from './types';
import { loadConfig } from './config';
import { debug } from './debug';
import { CALLOUT_DEFINITIONS, matchCalloutByColor, getCalloutTypeBySymbol } from './callout-config';

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
 * Google Docs inline object dictionary (from top-level inlineObjects).
 * Maps objectId -> inlineObject data.
 */
type InlineObjectsDict = Record<string, any>;

/**
 * Merge consecutive code_block paragraphs into a single code block.
 * This handles native GDoc all-monospace code blocks (Building Block > Code block).
 * 
 * Important: Only merge code blocks that are DIRECTLY adjacent.
 * Code blocks separated by ANY other paragraph (including empty separators) stay separate.
 * This preserves intentional separation between distinct code blocks.
 */
function mergeConsecutiveCodeBlocks(paragraphs: Paragraph[]): Paragraph[] {
  if (paragraphs.length === 0) return [];
  
  const result: Paragraph[] = [];
  
  for (const para of paragraphs) {
    const last = result[result.length - 1];
    
    // If both current and previous are code blocks, AND the current one has NO separator flag, merge them
    // Code blocks with _hasPrecedingSeparator should NOT be merged with the previous
    if (last?.type === 'code_block' && para.type === 'code_block' && !(para as any)._hasPrecedingSeparator) {
      // Add a newline span between the merged content
      last.spans.push({ text: '\n' }, ...para.spans);
      debug('docs-to-ir', 'merged-code-block', para.spans[0]?.text?.substring(0, 20));
    } else {
      result.push(para);
    }
  }
  
  return result;
}

/**
 * Google Docs lists dictionary structure.
 * Maps listId -> list properties with nesting levels.
 */
type ListsDict = Record<string, {
  listProperties?: {
    nestingLevels?: Array<{
      glyphType?: string;
      glyphSymbol?: string;
      glyphFormat?: string;
    }>;
  };
}>;

/**
 * Convert a Google Docs document to IR.
 * 
 * @param doc - The document object from documents.get API (should include inlineObjects for image support)
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
  
  const paragraphs: Paragraph[] = [];
  let lastWasEmpty = false;
  
  for (const element of body) {
    const result = elementToParagraph(element, cfg, inlineObjects, lists);
    
    if (result === null) {
      // Empty paragraph - mark that the next paragraph has a separator before it
      lastWasEmpty = true;
      continue;
    }
    
    // If there was an empty paragraph before this one, flag it
    // This prevents merging code blocks that are intentionally separated
    if (lastWasEmpty) {
      (result as any)._hasPrecedingSeparator = true;
      lastWasEmpty = false;
    }
    
    paragraphs.push(result);
  }
  
  // Merge consecutive code blocks into single code blocks
  // (respects _hasPrecedingSeparator flag to keep separated blocks apart)
  const mergedParagraphs = mergeConsecutiveCodeBlocks(paragraphs);
  
  // Extract language labels and associate with preceding code blocks
  const finalParagraphs = extractLanguageLabels(mergedParagraphs, body);
  
  debug('docs-to-ir', 'result', finalParagraphs);
  return finalParagraphs;
}

/**
 * Check if a paragraph has all text runs in monospace font.
 * This indicates a native Google Docs code block (Building Block > Code block).
 * 
 * Logic:
 * - Runs with actual words (non-whitespace) MUST have explicit monospace font
 * - Runs with only whitespace (spaces between words) can have EMPTY font
 * - If any run with words has EMPTY or non-monospace font, it's not a code block
 * 
 * This distinguishes:
 * - Inline code + text: "normal text " (EMPTY, has words) + "code" (mono) → NOT code block
 * - Native GDoc code block: "code" (mono) + " " (EMPTY, whitespace) + "more" (mono) → IS code block
 */
/**
 * Check if a paragraph has all text runs in monospace font.
 * This indicates a native Google Docs code block (Building Block > Code block).
 * 
 * Logic:
 * - Filter to runs with visible content (excluding PUA markers and whitespace)
 * - All visible runs must have explicit monospace font
 * - Google Docs uses Private Use Area characters (U+E000-U+F8FF) as internal
 *   markers for native code blocks - these are filtered out
 */
function isAllMonospaceParagraph(elements: any[]): boolean {
  // Get text runs with VISIBLE content only
  // Filter out: empty, whitespace-only, and Private Use Area characters
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
      // Visible content without monospace font - not a code block
      return false;
    }
  }
  
  return hasMonospace;
}

/**
 * Ordered list glyph types in Google Docs.
 * Includes all known variations (with/without underscores).
 */
const ORDERED_GLYPH_TYPES = [
  'DECIMAL',
  'ALPHA',
  'ROMAN',
  'UPPER_ALPHA',
  'UPPER_ROMAN',
  'ZERO_DECIMAL',
  'ZERODECIMAL',
  'NUMBER',
  // Additional variations Google might return
  'LOWER_ALPHA',
  'LOWER_ROMAN',
];

/**
 * Check if a glyph format indicates an ordered list.
 * glyphFormat like "%0." or "%1." indicates numbered list.
 */
function isOrderedGlyphFormat(glyphFormat?: string): boolean {
  if (!glyphFormat) return false;
  // Pattern like "%0.", "%1.", "%0.%1." etc. indicates ordered
  return /%\d/.test(glyphFormat);
}

/**
 * Convert a document element to a Paragraph.
 */
function elementToParagraph(
  element: any,
  config: ConverterConfig,
  inlineObjects: InlineObjectsDict,
  lists: ListsDict
): Paragraph | null {
  const p = element?.paragraph;
  if (!p?.elements?.length) return null;
  
  const paragraphStyle: DocsParagraphStyle = p.paragraphStyle || {};
  
  // Determine paragraph type from style
  let { type, level, calloutType } = determineParagraphType(paragraphStyle, config);
  
  // Check for native Google Docs code block (all-monospace paragraph)
  // Override type to code_block if detected
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
    // Get the expected symbol for this callout type
    const calloutDef = CALLOUT_DEFINITIONS.find(d => d.type === calloutType);
    if (calloutDef) {
      const firstSpan = spans[0];
      const symbolPattern = new RegExp(`^${escapeRegex(calloutDef.symbol)}\\s*`);
      if (symbolPattern.test(firstSpan.text)) {
        // Strip the symbol prefix
        firstSpan.text = firstSpan.text.replace(symbolPattern, '');
        debug('docs-to-ir', 'stripped-callout-symbol', { calloutType, symbol: calloutDef.symbol });
      }
    }
    return { type, calloutType, spans };
  }
  
  // Detect native Google Docs bullet lists
  const bullet = p.bullet;
  if (bullet && spans.length > 0) {
    const listId = bullet.listId;
    const nestingLevel = bullet.nestingLevel || 0;
    
    // Get list definition to determine if ordered or unordered
    const listDef = lists[listId];
    const nestingLevelDef = listDef?.listProperties?.nestingLevels?.[nestingLevel];
    const glyphType = nestingLevelDef?.glyphType;
    const glyphFormat = nestingLevelDef?.glyphFormat;
    const glyphSymbol = nestingLevelDef?.glyphSymbol;
    
    // Determine list type from glyphType, with fallback to glyphFormat
    // glyphType is most reliable, but some list presets may only have glyphFormat
    let isOrdered = false;
    if (glyphType) {
      isOrdered = ORDERED_GLYPH_TYPES.includes(glyphType);
    } else if (isOrderedGlyphFormat(glyphFormat)) {
      // Fallback: glyphFormat like "%0." indicates ordered
      isOrdered = true;
    }
    // If glyphSymbol is set (like "-" or "•"), it's definitely unordered
    if (glyphSymbol) {
      isOrdered = false;
    }
    
    const listType: 'ordered' | 'unordered' = isOrdered ? 'ordered' : 'unordered';
    
    debug('docs-to-ir', 'detected-list-item', { 
      listId, 
      nestingLevel, 
      glyphType, 
      glyphFormat,
      glyphSymbol,
      listType,
      text: spans[0].text.substring(0, 30) 
    });
    
    return { 
      type: 'list_item', 
      listType,
      nestingLevel,
      spans 
    };
  }
  
  return { type, level, spans };
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Determine paragraph type from Google Docs paragraph style.
 */
function determineParagraphType(
  style: DocsParagraphStyle,
  config: ConverterConfig
): { type: ParagraphType; level?: number; calloutType?: CalloutType } {
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
}

/**
 * Convert a Google Docs element (textRun or inlineObjectElement) to a StyledSpan.
 */
function elementToSpan(
  element: any,
  isCodeBlock: boolean,
  config: ConverterConfig,
  inlineObjects: InlineObjectsDict
): StyledSpan | null {
  // Handle inline image objects
  if (element?.inlineObjectElement) {
    return inlineObjectToSpan(element.inlineObjectElement, inlineObjects);
  }
  
  // Handle text runs
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
 * Extract Joplin resource ID from a GCS URL.
 * 
 * Expected format: https://storage.googleapis.com/{bucket}/joplin_img_{resourceId}_{timestamp}.{ext}
 * Returns the resource ID or null if not a Joplin image.
 */
function extractResourceIdFromUrl(url: string): string | null {
  if (!url) return null;
  
  // Match pattern: joplin_img_{resourceId}_{timestamp}.{ext}
  // Resource ID is 32 hex characters
  const match = url.match(/joplin_img_([a-fA-F0-9]{32})_\d+\.\w+/);
  if (match && match[1]) {
    return match[1];
  }
  
  return null;
}

/**
 * Convert an inline object element (image) to a StyledSpan.
 * 
 * Extracts the Joplin resource ID from the image's sourceUri (the GCS URL we uploaded)
 * and reconstructs the markdown image reference.
 * 
 * For images not from Joplin (no matching sourceUri pattern), outputs a placeholder.
 */
function inlineObjectToSpan(
  inlineObjectElement: any,
  inlineObjects: InlineObjectsDict
): StyledSpan | null {
  const objectId = inlineObjectElement?.inlineObjectId;
  if (!objectId) return null;
  
  // Look up the inline object in the dictionary
  const inlineObject = inlineObjects[objectId];
  if (!inlineObject) {
    debug('docs-to-ir', 'missing-inline-object', objectId);
    return { text: '[GDoc image]' };
  }
  
  // Get the image properties
  const embeddedObject = inlineObject?.inlineObjectProperties?.embeddedObject;
  const imageProps = embeddedObject?.imageProperties || {};
  const sourceUri = imageProps?.sourceUri || '';
  const contentUri = imageProps?.contentUri || '';
  const title = embeddedObject?.title || '';
  const description = embeddedObject?.description || '';
  
  debug('docs-to-ir', 'inline-object', { objectId, sourceUri: sourceUri?.substring(0, 60), title });
  
  // Try to extract resource ID from sourceUri (the GCS URL we uploaded)
  const resourceId = extractResourceIdFromUrl(sourceUri);
  if (resourceId) {
    // Found Joplin resource ID - reconstruct the markdown
    // Use title as alt text if available, otherwise empty
    const altText = title || description || '';
    const markdown = altText ? `![${altText}](:/` + resourceId + ')' : `![](:/` + resourceId + ')';
    debug('docs-to-ir', 'image-roundtrip', { objectId, resourceId, markdown });
    return { text: markdown };
  }
  
  // Fallback: images added directly in Google Docs (not from Joplin)
  // These can't be displayed in Joplin since GDoc images require authentication
  const altText = title ? `GDoc image: ${title}` : 'GDoc image';
  debug('docs-to-ir', 'image-external', { objectId, altText, sourceUri: sourceUri?.substring(0, 40) });
  return { text: `[${altText}]` };
}

/**
 * Check if a Google Docs paragraph element is a language label.
 * Language labels are small grey right-aligned text following a code block.
 * 
 * Detection criteria:
 * - Right-aligned (alignment: 'END')
 * - Small font size (around 8pt, checking for < 10pt)
 * - Grey color (RGB values around 0.8 each)
 * - Single word content (valid language identifier)
 */
function isLanguageLabelElement(element: any): { isLabel: boolean; language?: string } {
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
  // Allow alphanumeric, hyphen, plus for languages like "c++", "objective-c"
  if (!content || !/^[\w\-+#]+$/.test(content)) {
    return { isLabel: false };
  }
  
  // Check text style for small font and grey color
  const textStyle = textRun.textStyle || {};
  
  // Check font size (should be small, around 8pt)
  const fontSize = textStyle.fontSize?.magnitude;
  if (fontSize && fontSize >= 10) {
    return { isLabel: false };
  }
  
  // Check for grey foreground color
  const fgColor = textStyle.foregroundColor?.color?.rgbColor;
  if (fgColor) {
    const { red = 0, green = 0, blue = 0 } = fgColor;
    // Grey color should have similar RGB values, around 0.4-0.9 (darker grey at ~0.5)
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
}

/**
 * Extract language labels from paragraphs and associate with preceding code blocks.
 * Language labels are removed from the output and their content is set as the
 * `language` property of the preceding code block.
 * 
 * @param paragraphs - The IR paragraphs (after merging code blocks)
 * @param rawBody - The raw Google Docs body.content array for style detection
 */
function extractLanguageLabels(paragraphs: Paragraph[], rawBody: any[]): Paragraph[] {
  if (paragraphs.length === 0) return [];
  
  // Build a map of paragraph text to raw element for style checking
  // This is needed because IR paragraphs don't preserve the raw styling info
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
    
    // If this is a code block, check if the next paragraph is a language label
    if (para.type === 'code_block' && i + 1 < paragraphs.length) {
      const nextPara = paragraphs[i + 1];
      
      // Get the text content of the next paragraph
      const nextContent = nextPara.spans.map(s => s.text).join('').trim();
      
      // Look up the raw element to check if it's a language label
      const rawElement = rawElementMap.get(nextContent);
      if (rawElement) {
        const { isLabel, language } = isLanguageLabelElement(rawElement);
        if (isLabel && language) {
          // Set language on the code block and skip the label paragraph
          para.language = language;
          debug('docs-to-ir', 'extracted-lang-from-label', { language, codePreview: para.spans[0]?.text?.substring(0, 30) });
          result.push(para);
          i += 2; // Skip both the code block (added) and the label (discarded)
          continue;
        }
      }
    }
    
    result.push(para);
    i++;
  }
  
  return result;
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

