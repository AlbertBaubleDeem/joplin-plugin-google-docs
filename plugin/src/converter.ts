// Minimal Google Docs → Markdown converter (baseline + mapping hooks, mapping-driven only)
// - Headings via namedStyleType (TITLE, HEADING_1..6)
// - Inline bold/italic from TextStyle
// - Monospace inline → backticks based on mapping
// - Monospace+shaded/bordered paragraphs → fenced code blocks
// - Subtitle italic per mapping
// - Paragraphs separated by blank lines
// - Remove PUA variable markers while keeping inner text

import * as fs from 'fs';
import * as path from 'path';

type TextStyle = { bold?: boolean; italic?: boolean; weightedFontFamily?: { fontFamily?: string } };

type MappingConfig = {
  title?: { useTitle?: boolean; source?: string };
  subtitle?: { mode?: 'italic' | 'none' };
  headings?: Record<string, string>;
  inline?: { bold?: any; italic?: any };
  code?: { inline?: { marker?: string }, block?: any };
};

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

function applyInline(md: string, style?: TextStyle): string {
  if (!style) return md;
  const isBold = !!style.bold;
  const isItalic = !!style.italic;
  if (isBold && isItalic) return `***${md}***`;
  if (isBold) return `**${md}**`;
  if (isItalic) return `*${md}*`;
  return md;
}

function headingPrefix(namedStyle?: string): string {
  switch (namedStyle) {
    case 'TITLE':
      return '# ';
    case 'SUBTITLE':
      return '';
    case 'HEADING_1':
      return '# ';
    case 'HEADING_2':
      return '## ';
    case 'HEADING_3':
      return '### ';
    case 'HEADING_4':
      return '#### ';
    case 'HEADING_5':
      return '##### ';
    case 'HEADING_6':
      return '###### ';
    default:
      return '';
  }
}

export function convertDocumentToMarkdown(doc: any, opts?: { installDir?: string }): string {
  const mapping = loadMappingConfig(opts?.installDir);
  const body = doc?.body?.content || [];
  const out: string[] = [];
  for (const c of body) {
    const p = c?.paragraph;
    if (!p?.elements?.length) continue;
    const prefix = headingPrefix(p.paragraphStyle?.namedStyleType);
    let line = '';
    for (const el of p.elements) {
      const tr = el?.textRun;
      if (!tr?.content) continue;
      // Remove Private Use Area chars inside runs (Docs variable markers)
      let content = tr.content.replace(/\n+$/g, '').replace(/[\uE000-\uF8FF]/g, '');
      const ff = tr?.textRun?.textStyle?.weightedFontFamily?.fontFamily || tr?.textStyle?.weightedFontFamily?.fontFamily;
      const isRunMono = typeof ff === 'string' && ff.toLowerCase().includes('mono');
      const inlineMarker = mapping.code?.inline?.marker;
      if (isRunMono && inlineMarker) {
        if (!(content.startsWith(inlineMarker) && content.endsWith(inlineMarker))) {
          content = `${inlineMarker}${content}${inlineMarker}`;
        }
      }
      line += applyInline(content, tr.textStyle as TextStyle);
    }
    if (line.trim().length) {
      // Heuristic: code block only if mapping contains code.block config
      const isMonospace = !!p.elements.find((el: any) => el?.textRun?.textStyle?.weightedFontFamily?.fontFamily?.toLowerCase?.().includes('mono'));
      const hasBlockStyle = !!(p.paragraphStyle?.shading || p.paragraphStyle?.borderLeft);
      const allowBlock = !!mapping.code?.block;
      if (allowBlock && !prefix && (isMonospace || hasBlockStyle)) {
        out.push('```');
        out.push(line.trimEnd());
        out.push('```');
      } else {
        let finalLine = prefix + line.trimEnd();
        if (p.paragraphStyle?.namedStyleType === 'SUBTITLE' && mapping.subtitle?.mode === 'italic') {
          const core = finalLine.replace(/^#+\s*/, '');
          finalLine = `*${core}*`;
        }
        out.push(finalLine);
      }
    }
  }
  return out.join('\n\n');
}


