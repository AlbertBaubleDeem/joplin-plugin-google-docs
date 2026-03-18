/**
 * Converter Intermediate Representation (IR) Types
 * 
 * These types define the intermediate format used for bidirectional conversion
 * between Markdown and Google Docs. Both directions produce/consume this format,
 * enabling:
 * - Round-trip fidelity (MD → Docs → MD)
 * - Debuggable conversion (log IR at each step)
 * - Testable parsing (unit test IR generation without API calls)
 */

/**
 * A span of styled text within a paragraph.
 * Multiple styles can be combined (e.g., bold + italic).
 */
export type StyledSpan = {
  /** The text content (no Markdown syntax) */
  text: string;
  /** Bold formatting */
  bold?: boolean;
  /** Italic formatting */
  italic?: boolean;
  /** Inline code (monospace) */
  code?: boolean;
  /** Link URL (text becomes link text) */
  link?: string;
};

/**
 * Paragraph types supported by the converter.
 */
export type ParagraphType = 
  | 'heading'      // h1-h6
  | 'paragraph'    // normal text
  | 'code_block'   // fenced code block
  | 'title'        // document title (special heading)
  | 'subtitle'     // document subtitle
  | 'callout'      // callout box (note, info, question, warning, jarvis)
  | 'list_item';   // list item (ordered or unordered)

/**
 * Callout box types supported by the converter.
 */
export type CalloutType = 'note' | 'info' | 'question' | 'warning' | 'jarvis' | 'tip';

/**
 * Element spacing configuration for Google Docs paragraphs.
 * Values are in points (PT).
 * 
 * - undefined = use Google Docs named style default (no explicit spacing in API request)
 * - number = explicit spacing value in points
 */
export type ElementSpacing = {
  /** Space above paragraph in points */
  spaceAbove?: number;
  /** Space below paragraph in points */
  spaceBelow?: number;
  /** Insert empty paragraph between consecutive elements of this type (default: true for code_block) */
  insertSeparatorBetweenConsecutive?: boolean;
};

/**
 * A paragraph in the document.
 * Contains styled spans and paragraph-level metadata.
 */
export type Paragraph = {
  /** The type of paragraph */
  type: ParagraphType;
  /** Heading level (1-6), only used when type === 'heading' */
  level?: number;
  /** The styled text spans within this paragraph */
  spans: StyledSpan[];
  /** Language hint for code blocks */
  language?: string;
  /** Callout type, only used when type === 'callout' */
  calloutType?: CalloutType;
  /** List type, only used when type === 'list_item' */
  listType?: 'ordered' | 'unordered';
  /** Nesting level for lists (0 = top level, 1 = first indent, etc.) */
  nestingLevel?: number;
  /** Set during pull: true if an empty paragraph preceded this one in the source document */
  hasPrecedingSeparator?: boolean;
};

/**
 * A GFM table block.
 * headerRow: one row of cells (each cell = array of spans).
 * rows: data rows (same shape).
 */
export type TableBlock = {
  type: 'table';
  /** First row (header). Each element is one cell's spans. */
  headerRow: StyledSpan[][];
  /** Data rows. Each row is an array of cells; each cell is StyledSpan[]. */
  rows: StyledSpan[][][];
};

/**
 * Document block: either a paragraph or a table.
 */
export type DocBlock = Paragraph | TableBlock;

/** Type guard for Paragraph */
export function isParagraph(block: DocBlock): block is Paragraph {
  return block.type !== 'table';
}

/** Type guard for TableBlock */
export function isTableBlock(block: DocBlock): block is TableBlock {
  return block.type === 'table';
}

/**
 * A complete document in IR format.
 * This is the intermediate representation used for all conversions.
 */
export type IRDocument = DocBlock[];

/**
 * Configuration for the converter.
 * Loaded from config/md-mapping.json.
 */
export type ConverterConfig = {
  /** Title handling configuration */
  title?: {
    /** Whether to treat first line as title */
    useTitle?: boolean;
    /** Source of title: 'first_line' or 'metadata' */
    source?: string;
  };
  /** Subtitle handling */
  subtitle?: {
    /** How to render subtitles: 'italic' or 'none' */
    mode?: 'italic' | 'none';
  };
  /** Code formatting */
  code?: {
    /** Inline code settings */
    inline?: {
      /** Marker character (default: backtick) */
      marker?: string;
    };
    /** Code block settings */
    block?: {
      /** Whether to detect code blocks from Docs */
      detect?: boolean;
      /** Fence marker (default: '```', alternative: '~~~') */
      marker?: string;
      /** When true, merge consecutive code blocks even when separated by a blank line (e.g. paste-artifact splits) */
      mergeAcrossBlankLine?: boolean;
    };
    /** Monospace font for code (default: 'Roboto Mono') */
    monoFont?: string;
    /** Text color for code in Google Docs (hex, e.g. '#333333'). Omit for Docs default. */
    foregroundColor?: string;
    /** Font size for code in Google Docs (points, e.g. 10). Omit or 0 for Docs default. */
    fontSize?: number;
  };
  /** Custom heading mappings */
  headings?: Record<string, string>;
  /** Custom Markdown prefixes for Docs→MD conversion */
  mdPrefixes?: Partial<Record<
    'TITLE' | 'SUBTITLE' | 'HEADING_1' | 'HEADING_2' | 'HEADING_3' | 'HEADING_4' | 'HEADING_5' | 'HEADING_6',
    string
  >>;
  /** Element spacing configuration (overrides defaults) */
  elementSpacing?: Record<string, ElementSpacing>;
  /** List formatting configuration */
  list?: {
    /** Unordered list marker: '-', '*', or '+' (default: '-') */
    unorderedMarker?: '-' | '*' | '+';
  };
};

/**
 * A list range for applying bullet formatting.
 * Tracks consecutive list items of the same type.
 */
export type ListRange = {
  /** Start index (inclusive, 0-based in plain text) */
  startIndex: number;
  /** End index (0-based in plain text, points past last content char) */
  endIndex: number;
  /** List type for bullet preset selection */
  listType: 'ordered' | 'unordered';
  /** Number of tab characters in this list (consumed by createParagraphBullets API) */
  totalTabs: number;
};

/**
 * Result of converting Markdown to plain text with style ranges.
 * Used for Google Docs API calls.
 */
export type PlainTextWithRanges = {
  /** Plain text content (no Markdown syntax) */
  plain: string;
  /** Paragraph-level style ranges */
  paraRanges: ParaRange[];
  /** Inline text style ranges */
  textRanges: TextRange[];
  /** Callout boxes to be rendered as tables */
  calloutRanges?: CalloutRange[];
  /** List ranges for bullet formatting */
  listRanges?: ListRange[];
  /** Tables to insert (position + cell contents). InsertTableRequest then insertText per cell after re-fetch. */
  tableRanges?: TableRange[];
};

/**
 * A table to be inserted at a position in the plain text.
 * position: 0-based index where the table placeholder is in plain.
 * headerRow + dataRows: cell contents as plain strings (for insertText into each cell).
 */
export type TableRange = {
  position: number;
  rowCount: number;
  columnCount: number;
  /** Header row cell texts */
  headerRow: string[];
  /** Data row cell texts (row-major) */
  dataRows: string[][];
};

/**
 * A paragraph range with its style.
 * Indices are 0-based positions in the plain text.
 */
export type ParaRange = {
  /** Start index (inclusive) */
  start: number;
  /** End index (exclusive) */
  end: number;
  /** Google Docs named style type */
  style: string;
};

/**
 * An inline text range with its styles.
 * Indices are 0-based positions in the plain text.
 */
export type TextRange = {
  /** Start index (inclusive) */
  start: number;
  /** End index (exclusive) */
  end: number;
  /** Bold formatting */
  bold?: boolean;
  /** Italic formatting */
  italic?: boolean;
  /** Inline code (monospace) */
  codeMono?: boolean;
  /** Link URL */
  linkUrl?: string;
  /** Language label (small grey text for code block language) */
  langLabel?: boolean;
};

/**
 * Debug info for a conversion step.
 */
export type ConversionDebug = {
  /** Step name */
  step: string;
  /** Input description */
  input: string;
  /** Output or intermediate state */
  output: any;
  /** Timestamp */
  timestamp: number;
};

/**
 * A callout box to be rendered as a 2-cell table.
 * Used for tracking callout positions and generating table requests.
 */
export type CalloutRange = {
  /** Position in the plain text where the callout table should be inserted */
  position: number;
  /** The callout type (determines color and symbol) */
  calloutType: CalloutType;
  /** The text content of the callout */
  content: string;
};

/**
 * An image reference extracted from Markdown.
 * Used for tracking image positions and uploading to cloud storage.
 */
export type ImageRange = {
  /** Position in the plain text where image should be inserted */
  position: number;
  /** Joplin resource ID (from :/resourceId syntax) */
  resourceId: string;
  /** Alt text from Markdown ![alt](url) */
  altText?: string;
  /** Optional title from Markdown ![alt](url "title") */
  title?: string;
  /** Original markdown for reference/debugging */
  originalMarkdown: string;
  /** Link URL if image is wrapped in a link (e.g., [<img.../>](url)) */
  linkUrl?: string;
};

