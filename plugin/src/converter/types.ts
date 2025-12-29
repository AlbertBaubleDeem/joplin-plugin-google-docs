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
  | 'subtitle';    // document subtitle

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
};

/**
 * A complete document in IR format.
 * This is the intermediate representation used for all conversions.
 */
export type IRDocument = Paragraph[];

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
    };
    /** Monospace font for code (default: 'Roboto Mono') */
    monoFont?: string;
  };
  /** Custom heading mappings */
  headings?: Record<string, string>;
  /** Custom Markdown prefixes for Docs→MD conversion */
  mdPrefixes?: Partial<Record<
    'TITLE' | 'SUBTITLE' | 'HEADING_1' | 'HEADING_2' | 'HEADING_3' | 'HEADING_4' | 'HEADING_5' | 'HEADING_6',
    string
  >>;
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

