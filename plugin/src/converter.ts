// Minimal Google Docs → Markdown converter (baseline)
// - Headings via namedStyleType (TITLE, HEADING_1..6)
// - Inline bold/italic from TextStyle
// - Paragraphs separated by blank lines

type TextStyle = { bold?: boolean; italic?: boolean };

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

export function convertDocumentToMarkdown(doc: any): string {
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
      const content = tr.content.replace(/\n+$/g, '');
      line += applyInline(content, tr.textStyle as TextStyle);
    }
    if (line.trim().length) out.push(prefix + line.trimEnd());
  }
  return out.join('\n\n');
}


