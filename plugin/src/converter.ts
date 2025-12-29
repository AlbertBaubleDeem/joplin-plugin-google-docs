// Converter: single source for both directions Docs↔Markdown.
// Pull (Docs→MD):
// - Headings via namedStyleType (TITLE, HEADING_1..6)
// - Inline bold/italic from TextStyle
// - Monospace inline → backticks based on mapping
// - Monospace+shaded/bordered paragraphs → fenced code blocks (if enabled)
// - Subtitle italic per mapping
// - Remove variable PUA markers, normalize special whitespace
// - Paragraphs joined with blank lines (Markdown convention)
// Push (MD→Docs):
// - Parse Markdown to plain text and style ranges
// - Skip empty lines (Google Docs handles spacing via paragraph styles)
// - Later applied with Docs API (batchUpdate)

import * as fs from 'fs';
import * as path from 'path';

type TextStyle = { 
  bold?: boolean; 
  italic?: boolean; 
  weightedFontFamily?: { fontFamily?: string };
  link?: { url?: string };
};

export type MappingConfig = {
  title?: { useTitle?: boolean; source?: string };
  subtitle?: { mode?: 'italic' | 'none' };
  headings?: Record<string, string>;
  // Optional: Markdown heading detection patterns for MD→Docs.
  // Keys should be "h1".."h6"; values are regex strings like "^#\\s+".
  mdHeadingPatterns?: Record<string, string>;
  inline?: { bold?: any; italic?: any };
  code?: { inline?: { marker?: string }, block?: any; monoFont?: string };
  // Optional: allow overriding Markdown heading prefixes for Pull (Docs→MD) without code changes.
  // Configure in config/md-mapping.json, e.g. { "mdPrefixes": { "TITLE": "## ", "SUBTITLE": "" } }.
  // This affects ONLY Docs→MD. Push (MD→Docs) uses mapping.headings to map MD back to Docs styles.
  mdPrefixes?: Partial<Record<'TITLE' | 'SUBTITLE' | 'HEADING_1' | 'HEADING_2' | 'HEADING_3' | 'HEADING_4' | 'HEADING_5' | 'HEADING_6', string>>;
};

// Loads mapping config from installDir/config/md-mapping.json with sane defaults.
function loadMappingConfig(installDir?: string): MappingConfig {
  const defaults: MappingConfig = {
    title: { useTitle: true, source: 'first_line' },
    subtitle: { mode: 'italic' },
  };
  if (!installDir) return defaults;
  try {
    const cfgPath = path.resolve(installDir, 'config/md-mapping.json');
    if (fs.existsSync(cfgPath)) {
      const raw = fs.readFileSync(cfgPath, 'utf8');
      const parsed = JSON.parse(raw);
      return { ...defaults, ...parsed };
    }
  } catch {}
  return defaults;
}

// Default Markdown prefixes per Docs named style (used for Docs→MD)
const DEFAULT_MD_PREFIXES: Record<string, string> = {
  TITLE: '# ',
  SUBTITLE: '',
  HEADING_1: '# ',
  HEADING_2: '## ',
  HEADING_3: '### ',
  HEADING_4: '#### ',
  HEADING_5: '##### ',
  HEADING_6: '###### ',
};

// Default Markdown heading detection patterns for MD→Docs
const DEFAULT_MD_HEADING_PATTERNS: Record<string, string> = {
  h1: '^#\\s+',
  h2: '^##\\s+',
  h3: '^###\\s+',
  h4: '^####\\s+',
  h5: '^#####\\s+',
  h6: '^######\\s+',
};

// Default mapping from hN key → Docs named style
const DEFAULT_HEADING_STYLE_BY_KEY: Record<string, string> = {
  h1: 'HEADING_1',
  h2: 'HEADING_2',
  h3: 'HEADING_3',
  h4: 'HEADING_4',
  h5: 'HEADING_5',
  h6: 'HEADING_6',
};

// Applies inline MD emphasis markers based on Docs TextStyle
function applyInline(md: string, style?: TextStyle): string {
  if (!style) return md;
  
  // Handle links first
  if (style.link?.url) {
    md = `[${md}](${style.link.url})`;
  }
  
  // Then apply bold/italic
  const isBold = !!style.bold;
  const isItalic = !!style.italic;
  if (isBold && isItalic) return `***${md}***`;
  if (isBold) return `**${md}**`;
  if (isItalic) return `*${md}*`;
  return md;
}

// Provides Markdown heading prefix for a Docs named style. Defaults live in
// DEFAULT_MD_PREFIXES; users can override via mapping.mdPrefixes.
function headingPrefix(namedStyle: string | undefined, mapping: MappingConfig): string {
  if (!namedStyle) return '';
  const override = mapping.mdPrefixes?.[namedStyle as keyof NonNullable<typeof mapping.mdPrefixes>];
  if (typeof override === 'string') return override;
  return DEFAULT_MD_PREFIXES[namedStyle] || '';
}

function isDocParagraphCodeBlock(p: any): boolean {
  // Simpler rule: only treat as code block if paragraph has background shading or border
  return !!(p?.paragraphStyle?.shading || p?.paragraphStyle?.borderLeft);
}

export function convertDocumentToMarkdown(doc: any, opts?: { installDir?: string }): string {
  const mapping = loadMappingConfig(opts?.installDir);
  const body = doc?.body?.content || [];
  const out: string[] = [];
  for (const c of body) {
    const p = c?.paragraph;
    if (!p?.elements?.length) continue;
    const prefix = headingPrefix(p.paragraphStyle?.namedStyleType, mapping);
    const allowBlock = !!mapping.code?.block;
    const shouldFence = allowBlock && !prefix && isDocParagraphCodeBlock(p);
    let line = '';
    for (const el of p.elements) {
      const tr = el?.textRun;
      if (!tr?.content) continue;
      // Normalize content:
      // - Trim trailing newlines added by Docs in runs
      // - Replace vertical tab with newline (Docs quirky linebreak)
      // - Remove Private Use Area chars (Docs variable markers) but keep inner text
      let content = tr.content
        .replace(/\n+$/g, '')
        .replace(/\u000B/g, '\n')
        .replace(/[\uE000-\uF8FF]/g, '');
      const ff = tr?.textRun?.textStyle?.weightedFontFamily?.fontFamily || tr?.textStyle?.weightedFontFamily?.fontFamily;
      const isRunMono = typeof ff === 'string' && ff.toLowerCase().includes('mono');
      const inlineMarker = mapping.code?.inline?.marker;
      if (!shouldFence) {
        if (isRunMono && inlineMarker) {
          if (!(content.startsWith(inlineMarker) && content.endsWith(inlineMarker))) {
            content = `${inlineMarker}${content}${inlineMarker}`;
          }
        }
        line += applyInline(content, tr.textStyle as TextStyle);
      } else {
        // Inside a fenced code block: output text verbatim, no inline Markdown markers
        line += content;
      }
    }
    if (line.trim().length) {
      // Code block heuristic (Docs→MD) behind mapping.code.block flag.
      if (shouldFence) {
        const block = ['```', line.trimEnd(), '```'].join('\n');
        out.push(block);
      } else {
        let finalLine = prefix + line.trimEnd();
        if (p.paragraphStyle?.namedStyleType === 'SUBTITLE' && mapping.subtitle?.mode === 'italic') {
          // Render Docs SUBTITLE as italic in Markdown (underscore style: _subtitle_)
          const core = finalLine.replace(/^#+\s*/, '');
          finalLine = `_${core}_`;
        }
        out.push(finalLine);
      }
    }
  }
  return out.join('\n\n');
}

// --- Markdown → Docs (for push) ---

export type ParaRange = { start: number; end: number; style: string };
export type TextRange = { start: number; end: number; bold?: boolean; italic?: boolean; codeMono?: boolean; linkUrl?: string };

// Public: load mapping config for callers outside this module (identical to internal loader)
export function loadMdMappingConfig(installDir?: string): MappingConfig {
  return loadMappingConfig(installDir);
}

// Parse markdown to a plain text buffer plus paragraph and inline style ranges.
// These ranges can be translated into Docs API batchUpdate requests.
export function convertMarkdownToPlainAndStyles(mdRaw: string, opts?: { installDir?: string }): { plain: string; paraRanges: ParaRange[]; textRanges: TextRange[] } {
  // Load mapping dynamically (symmetry with Docs→MD); callers need not supply it.
  const mapping = loadMappingConfig(opts?.installDir);
  const md = mdRaw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = md.split('\n');
  const paraRanges: ParaRange[] = [];
  const textRanges: TextRange[] = [];
  let plain = '';
  let cursor = 0;

  // Build heading detection table dynamically from mapping.mdHeadingPatterns (or defaults),
  // mapping each key (h1..h6) to a Docs named style via mapping.headings (or defaults).
  const patternDict = mapping.mdHeadingPatterns || DEFAULT_MD_HEADING_PATTERNS;
  const styleDict = { ...DEFAULT_HEADING_STYLE_BY_KEY, ...(mapping.headings || {}) } as Record<string, string>;
  const defaultStyle = styleDict['default'] || 'NORMAL_TEXT';
  const headingKeys = Object.keys(patternDict).filter(k => /^h[1-6]$/.test(k));
  // Sort to prefer stronger headings (h6 first) to avoid matching h1 when a line is h6
  headingKeys.sort((a, b) => parseInt(b.slice(1), 10) - parseInt(a.slice(1), 10));
  const headingTable: Array<{ re: RegExp; style: string }> = headingKeys.map(k => ({
    re: new RegExp(patternDict[k]),
    style: styleDict[k] || DEFAULT_HEADING_STYLE_BY_KEY[k] || 'NORMAL_TEXT',
  }));
  function paragraphStyleFor(line: string): string {
    const match = headingTable.find(hm => hm.re.test(line));
    return match ? match.style : defaultStyle;
  }
  function stripHeadingMarkers(line: string): string {
    return line.replace(/^#{1,6}\s+/, '');
  }

  // Minimal fenced code handling: skip fence marker lines; treat content verbatim
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const original = lines[i];
    const fenceMatch = original.match(/^```/);
    if (fenceMatch) { inFence = !inFence; continue; }
    
    // Skip empty lines - Google Docs handles paragraph spacing via styles
    if (!inFence && original.trim() === '') continue;

    const namedStyleType = inFence ? 'CODEBLOCK' : paragraphStyleFor(original);
    let line = inFence ? original : stripHeadingMarkers(original);

    // Track inline code spans first, so later emphasis parsing skips them
    const codeRangesInLine: Array<{ start: number; end: number }> = [];
    if (!inFence) {
      let re = /`([^`]+)`/g;
      let m: RegExpExecArray | null;
      let offset = 0;
      while ((m = re.exec(line)) !== null) {
        const full = m[0];
        const inner = m[1];
        const startInLine = m.index - offset;
        const endInLine = startInLine + inner.length;
        // Record inline code range in final plain string coordinates
        textRanges.push({ start: cursor + startInLine, end: cursor + endInLine, codeMono: true });
        codeRangesInLine.push({ start: startInLine, end: endInLine });
        // Remove backticks from the line while keeping the inner text
        line = line.slice(0, m.index) + inner + line.slice(m.index + full.length);
        offset += full.length - inner.length;
        re.lastIndex = m.index + inner.length;
      }
    }

    const overlapsSkip = (s: number, e: number) => codeRangesInLine.some(r => Math.max(r.start, s) < Math.min(r.end, e));
    const applyInline = (re: RegExp, upd: (s: number, e: number) => void) => {
      let m: RegExpExecArray | null;
      let offset = 0;
      while ((m = re.exec(line)) !== null) {
        const full = m[0];
        const inner = m[1];
        const startInLine = m.index - offset;
        const endInLine = startInLine + inner.length;
        if (overlapsSkip(startInLine, endInLine)) { re.lastIndex = m.index + full.length; continue; }
        upd(cursor + startInLine, cursor + endInLine);
        line = line.slice(0, m.index) + inner + line.slice(m.index + full.length);
        offset += full.length - inner.length;
        re.lastIndex = m.index + inner.length;
      }
    };
    // Extract links before other inline formatting
    // First, handle image links to preserve them as-is
    // Pattern: ![alt text](:/resourceId) or ![alt text](:/resourceId "title")
    const imageRegex = /!\[([^\]]*)\]\(:[^)]+\)/g;
    const imagePositions: Array<{ start: number; end: number }> = [];
    let imgMatch: RegExpExecArray | null;
    while ((imgMatch = imageRegex.exec(line)) !== null) {
      imagePositions.push({ start: imgMatch.index, end: imgMatch.index + imgMatch[0].length });
    }
    
    // Process all inline elements in correct order
    // First, identify all elements and their positions
    const elements: Array<{
      type: 'link' | 'bold' | 'italic' | 'code';
      start: number;
      end: number;
      content?: string;
      url?: string;
      fullMatch: string;
    }> = [];
    
    // Find all links
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let linkMatch: RegExpExecArray | null;
    while ((linkMatch = linkRegex.exec(line)) !== null) {
      const fullMatch = linkMatch[0];
      const linkText = linkMatch[1];
      const linkUrl = linkMatch[2];
      const matchStart = linkMatch.index;
      const matchEnd = matchStart + fullMatch.length;
      
      // Skip image links
      const isImageLink = imagePositions.some(img => 
        (matchStart >= img.start && matchStart < img.end) || 
        (matchEnd > img.start && matchEnd <= img.end)
      );
      if (isImageLink) continue;
      
      // Skip internal resource links
      if (linkUrl.startsWith(':/')) continue;
      
      // Skip if in code
      if (overlapsSkip(matchStart, matchEnd - matchStart)) continue;
      
      elements.push({
        type: 'link',
        start: matchStart,
        end: matchEnd,
        content: linkText,
        url: linkUrl,
        fullMatch: fullMatch
      });
    }
    
    // Find bold patterns
    let boldMatch: RegExpExecArray | null;
    const boldRegex = /\*\*([^*]+)\*\*/g;
    while ((boldMatch = boldRegex.exec(line)) !== null) {
      if (!overlapsSkip(boldMatch.index, boldMatch.index + boldMatch[0].length)) {
        elements.push({
          type: 'bold',
          start: boldMatch.index,
          end: boldMatch.index + boldMatch[0].length,
          content: boldMatch[1],
          fullMatch: boldMatch[0]
        });
      }
    }
    
    // Find italic patterns (both * and _)
    const italicPatterns = [/\*([^*]+)\*/g, /_([^_]+)_/g];
    for (const italicRegex of italicPatterns) {
      let italicMatch: RegExpExecArray | null;
      while ((italicMatch = italicRegex.exec(line)) !== null) {
        const matchIndex = italicMatch.index;
        const matchLength = italicMatch[0].length;
        const matchContent = italicMatch[1];
        
        // Make sure this isn't part of bold
        const isBold = elements.some(el => 
          el.type === 'bold' && 
          matchIndex >= el.start && 
          matchIndex + matchLength <= el.end
        );
        if (!isBold && !overlapsSkip(matchIndex, matchIndex + matchLength)) {
          elements.push({
            type: 'italic',
            start: matchIndex,
            end: matchIndex + matchLength,
            content: matchContent,
            fullMatch: italicMatch[0]
          });
        }
      }
    }
    
    // Sort elements by position (for processing order)
    elements.sort((a, b) => a.start - b.start);
    
    // Process from right to left
    let processedLine = line;
    let totalOffset = 0;
    
    for (let i = elements.length - 1; i >= 0; i--) {
      const element = elements[i];
      
      // Calculate how much offset this element will create
      const elementOffset = element.fullMatch.length - element.content!.length;
      
      // Calculate position in final text
      let finalOffset = 0;
      for (let j = 0; j < i; j++) {
        const prevElement = elements[j];
        finalOffset -= prevElement.fullMatch.length - prevElement.content!.length;
      }
      
      const finalStart = element.start + finalOffset;
      const finalEnd = finalStart + element.content!.length;
      
      // Add to text ranges based on type
      switch (element.type) {
        case 'link':
          textRanges.push({
            start: cursor + finalStart,
            end: cursor + finalEnd,
            linkUrl: element.url
          });
          break;
        case 'bold':
          textRanges.push({
            start: cursor + finalStart,
            end: cursor + finalEnd,
            bold: true
          });
          break;
        case 'italic':
          textRanges.push({
            start: cursor + finalStart,
            end: cursor + finalEnd,
            italic: true
          });
          break;
      }
      
      // Replace in line
      processedLine = processedLine.substring(0, element.start) + element.content + processedLine.substring(element.end);
    }
    
    line = processedLine;

    const start = cursor;
    plain += line + '\n';
    const end = start + line.length;
    paraRanges.push({ start, end, style: namedStyleType });
    cursor = end + 1;
  }

  // Enforce first line as Title when configured
  if (mapping?.title?.useTitle && paraRanges.length > 0) {
    paraRanges[0].style = 'TITLE';
  }
  // Optional subtitle detection: pick the first non-empty, non-code paragraph
  // after the title that is fully italic according to inline ranges.
  if (mapping?.subtitle?.mode === 'italic' && paraRanges.length > 1) {
    for (let i = 1; i < paraRanges.length; i++) {
      const pr = paraRanges[i];
      if (pr.style === 'CODEBLOCK') continue;
      if (pr.end <= pr.start) continue; // empty line
      const fullItalic = textRanges.some(r => r.italic && r.start <= pr.start && r.end >= pr.end);
      if (fullItalic) { pr.style = 'SUBTITLE'; break; }
    }
  }

  return { plain, paraRanges, textRanges };
}

// Build Docs API requests to apply paragraph and text styles based on the
// ranges produced by convertMarkdownToPlainAndStyles. All visual heuristics
// (e.g., CODEBLOCK styling, monospace font) live here to keep command logic thin.
export function buildDocsStyleUpdateRequests(
  paraRanges: ParaRange[],
  textRanges: TextRange[],
  opts?: { installDir?: string },
): any[] {
  // Load mapping config to get monoFont preference (consolidates formatting logic here)
  const mapping = loadMappingConfig(opts?.installDir);
  const monoFont = mapping?.code?.monoFont || 'Roboto Mono';

  const paraReqs = paraRanges
    .filter(r => r.end >= r.start)
    .map(r => ({
      updateParagraphStyle: {
        range: { startIndex: r.start + 1, endIndex: r.end + 1 },
        paragraphStyle: r.style === 'CODEBLOCK'
          ? {
              shading: { backgroundColor: { color: { rgbColor: { red: 0.96, green: 0.96, blue: 0.96 } } } },
              borderLeft: {
                width: { magnitude: 1, unit: 'PT' },
                padding: { magnitude: 6, unit: 'PT' },
                color: { color: { rgbColor: { red: 0.8, green: 0.8, blue: 0.8 } } },
                dashStyle: 'SOLID',
              },
            }
          : { namedStyleType: r.style },
        fields: r.style === 'CODEBLOCK' ? 'shading,borderLeft' : 'namedStyleType',
      },
    }));

  const textReqs = textRanges
    .map(r => {
      const fieldList = [];
      const textStyle: any = {};
      
      if (r.bold !== undefined) {
        fieldList.push('bold');
        textStyle.bold = !!r.bold;
      }
      if (r.italic !== undefined) {
        fieldList.push('italic');
        textStyle.italic = !!r.italic;
      }
      if (r.linkUrl !== undefined) {
        fieldList.push('link');
        textStyle.link = { url: r.linkUrl };
      }
      
      const fields = fieldList.join(',');
      if (!fields) return null;
      
      return {
        updateTextStyle: {
          range: { startIndex: r.start + 1, endIndex: r.end + 1 },
          textStyle,
          fields,
        },
      };
    })
    // Drop requests that would have empty fields (e.g., pure codeMono spans handled separately)
    .filter(req => !!req && req.updateTextStyle.fields);

  // Enforce monospace font for CODEBLOCK paragraphs and inline code
  const codeInlineReqs = textRanges
    .filter(r => r.codeMono && r.end > r.start)
    .map(r => ({
      updateTextStyle: {
        range: { startIndex: r.start + 1, endIndex: r.end + 1 },
        textStyle: { weightedFontFamily: { fontFamily: monoFont } },
        fields: 'weightedFontFamily',
      },
    }));
  const codeMonoReqs = paraRanges
    .filter(r => r.style === 'CODEBLOCK' && r.end > r.start)
    .map(r => ({
      updateTextStyle: {
        range: { startIndex: r.start + 1, endIndex: r.end + 1 },
        textStyle: { weightedFontFamily: { fontFamily: monoFont } },
        fields: 'weightedFontFamily',
      },
    }));

  return [...paraReqs, ...textReqs, ...codeInlineReqs, ...codeMonoReqs];
}


