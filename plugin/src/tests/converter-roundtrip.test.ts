/**
 * Comprehensive Converter Roundtrip Tests
 * 
 * Tests that markdown → IR → markdown preserves content fidelity.
 * Also tests IR → plain text for correct range calculations.
 * 
 * Run with: npx tsx src/tests/converter-roundtrip.test.ts
 */

import { markdownToIR } from '../converters/md-to-ir';
import { irToMarkdown, normalizeMarkdown } from '../converters/ir-to-md';
import { irToPlainTextWithRanges, buildListBulletRequests } from '../converters/ir-to-docs';
import { convertMarkdownToPlainAndStyles } from '../converters';
import { loadConfig } from '../converters/config';
import { IRDocument, Paragraph, ListRange } from '../converters/types';

// =============================================================================
// TEST UTILITIES
// =============================================================================

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;
let skipped = 0;

interface TestResult {
  success: boolean;
  message?: string;
}

function test(name: string, fn: () => TestResult | void): void {
  try {
    const result = fn();
    if (result && !result.success) {
      console.log(`${RED}✗${RESET} ${name}`);
      if (result.message) console.log(`  ${result.message}`);
      failed++;
    } else {
      console.log(`${GREEN}✓${RESET} ${name}`);
      passed++;
    }
  } catch (e: any) {
    console.log(`${RED}✗${RESET} ${name}`);
    console.log(`  Error: ${e.message}`);
    failed++;
  }
}

function skip(name: string, reason?: string): void {
  console.log(`${YELLOW}○${RESET} ${name} (skipped${reason ? ': ' + reason : ''})`);
  skipped++;
}

function assertEqual(actual: any, expected: any): TestResult {
  const actualStr = typeof actual === 'string' ? actual : JSON.stringify(actual);
  const expectedStr = typeof expected === 'string' ? expected : JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    return { 
      success: false, 
      message: `Expected: ${expectedStr}\n  Actual: ${actualStr}` 
    };
  }
  return { success: true };
}

function assertContains(haystack: string, needle: string): TestResult {
  if (!haystack.includes(needle)) {
    return { 
      success: false, 
      message: `Expected to contain: "${needle}"\n  In: "${haystack.substring(0, 200)}..."` 
    };
  }
  return { success: true };
}

function assertIRContains(ir: IRDocument, type: string, textFragment?: string): TestResult {
  const found = type === 'table'
    ? ir.find(b => b.type === 'table')
    : ir.find(b => b.type !== 'table' && b.type === type && (!textFragment || (b as Paragraph).spans.some(s => s.text.includes(textFragment))));
  if (!found) {
    return {
      success: false,
      message: `Expected IR to contain type="${type}"${textFragment ? ` with "${textFragment}"` : ''}`
    };
  }
  return { success: true };
}

// =============================================================================
// BASIC FORMATTING TESTS
// =============================================================================

console.log('\n=== BASIC FORMATTING ===\n');

test('Bold text preserves through roundtrip', () => {
  const md = '# Title\n\nThis has **bold** text.';
  const ir = markdownToIR(md, loadConfig());
  const result = irToMarkdown(ir, loadConfig());
  return assertContains(result, '**bold**');
});

test('Italic text preserves through roundtrip', () => {
  const md = '# Title\n\nThis has *italic* text.';
  const ir = markdownToIR(md, loadConfig());
  const result = irToMarkdown(ir, loadConfig());
  return assertContains(result, '*italic*');
});

test('Bold+italic combined preserves through roundtrip', () => {
  const md = '# Title\n\nThis has ***bold italic*** text.';
  const ir = markdownToIR(md, loadConfig());
  const result = irToMarkdown(ir, loadConfig());
  // May be rendered as **_text_** or ***text*** - check for both styles
  const hasBoldItalic = result.includes('***bold italic***') || 
    (result.includes('**') && result.includes('*'));
  if (!hasBoldItalic) {
    return { success: false, message: `Expected bold+italic, got: ${result}` };
  }
  return { success: true };
});

test('Inline code preserves through roundtrip', () => {
  const md = '# Title\n\nThis has `inline code` here.';
  const ir = markdownToIR(md, loadConfig());
  const result = irToMarkdown(ir, loadConfig());
  return assertContains(result, '`inline code`');
});

// =============================================================================
// TABLE TESTS
// =============================================================================

console.log('\n=== TABLES ===\n');

test('GFM table parses to IR and roundtrips to markdown', () => {
  const md = '# Doc\n\n| A | B |\n| --- | --- |\n| 1 | 2 |';
  const ir = markdownToIR(md, loadConfig());
  const r = assertIRContains(ir, 'table');
  if (!r.success) return r;
  const result = irToMarkdown(ir, loadConfig());
  // Output is pretty-printed (column-aligned), e.g. | A   | B   | and | 1   | 2   |
  const hasHeader = result.includes('| A') && (result.includes('B |') || result.includes('B   |'));
  const hasDataRow = result.includes('| 1') && (result.includes('2 |') || result.includes('2   |'));
  if (!hasHeader || !hasDataRow) {
    return { success: false, message: `Expected table in output, got: ${result}` };
  }
  return { success: true };
});

test('convertMarkdownToPlainAndStyles returns tableRanges for GFM table', () => {
  const md = '# Doc\n\n| H1 | H2 |\n| --- | --- |\n| a | b |';
  const { plain, tableRanges } = convertMarkdownToPlainAndStyles(md, { processImages: false });
  if (!tableRanges || tableRanges.length !== 1) {
    return { success: false, message: `Expected 1 table range, got ${tableRanges?.length ?? 0}` };
  }
  const tr = tableRanges[0];
  if (tr.rowCount !== 2 || tr.columnCount !== 2) {
    return { success: false, message: `Expected 2x2 table, got ${tr.rowCount}x${tr.columnCount}` };
  }
  if (tr.headerRow[0]?.trim() !== 'H1' || tr.headerRow[1]?.trim() !== 'H2') {
    return { success: false, message: `Expected header [H1, H2], got [${tr.headerRow}]` };
  }
  if (tr.dataRows[0]?.[0]?.trim() !== 'a' || tr.dataRows[0]?.[1]?.trim() !== 'b') {
    return { success: false, message: `Expected first data row [a, b], got ${JSON.stringify(tr.dataRows[0])}` };
  }
  if (tr.position < 0 || tr.position >= plain.length) {
    return { success: false, message: `Table position ${tr.position} should be within plain length ${plain.length}` };
  }
  return { success: true };
});

// =============================================================================
// LINK TESTS
// =============================================================================

console.log('\n=== LINKS ===\n');

test('External URL link preserves through roundtrip', () => {
  const md = '# Title\n\nCheck out [Google](https://www.google.com) for search.';
  const ir = markdownToIR(md, loadConfig());
  const result = irToMarkdown(ir, loadConfig());
  return assertContains(result, '[Google](https://www.google.com)');
});

test('Multiple links in one paragraph', () => {
  const md = '# Title\n\nSee [link1](https://a.com) and [link2](https://b.com).';
  const ir = markdownToIR(md, loadConfig());
  const result = irToMarkdown(ir, loadConfig());
  const r1 = assertContains(result, '[link1](https://a.com)');
  const r2 = assertContains(result, '[link2](https://b.com)');
  if (!r1.success) return r1;
  return r2;
});

test('Joplin internal link (:/resourceId) preserves', () => {
  const md = '# Title\n\nSee [my note](:/abc123def456).';
  const ir = markdownToIR(md, loadConfig());
  const result = irToMarkdown(ir, loadConfig());
  // Internal links may be preserved as plain text since they don't work in Docs
  return assertContains(result, 'my note');
});

test('Link with bold text inside', () => {
  const md = '# Title\n\n[**bold link**](https://example.com)';
  const ir = markdownToIR(md, loadConfig());
  const result = irToMarkdown(ir, loadConfig());
  return assertContains(result, 'bold link');
});

// =============================================================================
// IMAGE TESTS
// =============================================================================

console.log('\n=== IMAGES ===\n');

test('Joplin image syntax preserves', () => {
  const md = '# Title\n\n![alt text](:/88a9c8449f054280ad2c402f451b5373)';
  const ir = markdownToIR(md, loadConfig());
  const result = irToMarkdown(ir, loadConfig());
  return assertContains(result, '![alt text](:/88a9c8449f054280ad2c402f451b5373)');
});

test('External image URL preserves', () => {
  const md = '# Title\n\n![logo](https://example.com/image.png)';
  const ir = markdownToIR(md, loadConfig());
  const result = irToMarkdown(ir, loadConfig());
  return assertContains(result, '![logo](https://example.com/image.png)');
});

test('Image after list item uses soft break (stays in same bullet)', () => {
  const md = '# Doc\n\n- List item text\n![image](:/abc123)';
  const ir = markdownToIR(md, loadConfig());
  const result = irToPlainTextWithRanges(ir);
  
  // The list range should include the image (soft break keeps it in same item)
  // Check that we have exactly one list range
  if (!result.listRanges || result.listRanges.length !== 1) {
    return { success: false, message: `Expected 1 list range, got ${result.listRanges?.length}` };
  }
  return { success: true };
});

// =============================================================================
// HEADING TESTS
// =============================================================================

console.log('\n=== HEADINGS ===\n');

test('H1 becomes title', () => {
  const md = '# Main Title';
  const ir = markdownToIR(md, loadConfig());
  return assertEqual(ir[0]?.type, 'title');
});

test('H2-H6 become headings with correct levels', () => {
  const md = '# Title\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6';
  const ir = markdownToIR(md, loadConfig());
  
  // Title + 5 headings
  if (ir.length < 6) {
    return { success: false, message: `Expected at least 6 paragraphs, got ${ir.length}` };
  }
  
  // Check heading levels (skip first which is title)
  const headings = ir.filter(p => p.type === 'heading');
  const levels = headings.map(h => h.level);
  const expected = [2, 3, 4, 5, 6];
  return assertEqual(levels, expected);
});

test('Headings preserve through roundtrip', () => {
  const md = '# Title\n\n## Section\n\n### Subsection';
  const ir = markdownToIR(md, loadConfig());
  const result = irToMarkdown(ir, loadConfig());
  const r1 = assertContains(result, '# Title');
  const r2 = assertContains(result, '## Section');
  const r3 = assertContains(result, '### Subsection');
  if (!r1.success) return r1;
  if (!r2.success) return r2;
  return r3;
});

// =============================================================================
// UNORDERED LIST TESTS
// =============================================================================

console.log('\n=== UNORDERED LISTS ===\n');

test('Simple unordered list', () => {
  const md = '# Doc\n\n- Item 1\n- Item 2\n- Item 3';
  const ir = markdownToIR(md, loadConfig());
  const listItems = ir.filter(p => p.type === 'list_item');
  if (listItems.length !== 3) {
    return { success: false, message: `Expected 3 list items, got ${listItems.length}` };
  }
  if (listItems[0].listType !== 'unordered') {
    return { success: false, message: `Expected unordered list, got ${listItems[0].listType}` };
  }
  return { success: true };
});

test('Unordered list with dash marker', () => {
  const md = '# Doc\n\n- Dash item';
  const ir = markdownToIR(md, loadConfig());
  const result = irToMarkdown(ir, loadConfig());
  return assertContains(result, '- Dash');
});

test('Unordered list with asterisk marker', () => {
  const md = '# Doc\n\n* Asterisk item';
  const ir = markdownToIR(md, loadConfig());
  const listItem = ir.find(p => p.type === 'list_item');
  if (!listItem || listItem.listType !== 'unordered') {
    return { success: false, message: 'Expected unordered list item' };
  }
  return { success: true };
});

test('Unordered list with plus marker', () => {
  const md = '# Doc\n\n+ Plus item';
  const ir = markdownToIR(md, loadConfig());
  const listItem = ir.find(p => p.type === 'list_item');
  if (!listItem || listItem.listType !== 'unordered') {
    return { success: false, message: 'Expected unordered list item' };
  }
  return { success: true };
});

// =============================================================================
// ORDERED LIST TESTS
// =============================================================================

console.log('\n=== ORDERED LISTS ===\n');

test('Simple ordered list', () => {
  const md = '# Doc\n\n1. First\n2. Second\n3. Third';
  const ir = markdownToIR(md, loadConfig());
  const listItems = ir.filter(p => p.type === 'list_item');
  if (listItems.length !== 3) {
    return { success: false, message: `Expected 3 list items, got ${listItems.length}` };
  }
  if (listItems[0].listType !== 'ordered') {
    return { success: false, message: `Expected ordered list, got ${listItems[0].listType}` };
  }
  return { success: true };
});

test('Ordered list preserves through roundtrip', () => {
  const md = '# Doc\n\n1. First item\n2. Second item';
  const ir = markdownToIR(md, loadConfig());
  const result = irToMarkdown(ir, loadConfig());
  const r1 = assertContains(result, '1.');
  const r2 = assertContains(result, '2.');
  if (!r1.success) return r1;
  return r2;
});

test('Ordered list generates correct bullet preset', () => {
  const md = '# Doc\n\n1. First\n2. Second';
  const ir = markdownToIR(md, loadConfig());
  const result = irToPlainTextWithRanges(ir);
  const reqs = buildListBulletRequests(result.listRanges || []);
  
  if (reqs.length === 0) {
    return { success: false, message: 'Expected list bullet requests' };
  }
  
  const preset = reqs[0].createParagraphBullets?.bulletPreset;
  if (preset !== 'NUMBERED_DECIMAL_NESTED') {
    return { success: false, message: `Expected NUMBERED_DECIMAL_NESTED, got ${preset}` };
  }
  return { success: true };
});

// =============================================================================
// NESTED LIST TESTS
// =============================================================================

console.log('\n=== NESTED LISTS ===\n');

test('Nested unordered list (2 levels)', () => {
  const md = '# Doc\n\n- Parent\n    - Child';
  const ir = markdownToIR(md, loadConfig());
  const listItems = ir.filter(p => p.type === 'list_item');
  
  if (listItems.length !== 2) {
    return { success: false, message: `Expected 2 list items, got ${listItems.length}` };
  }
  if (listItems[0].nestingLevel !== 0) {
    return { success: false, message: `Expected parent nesting 0, got ${listItems[0].nestingLevel}` };
  }
  if (listItems[1].nestingLevel !== 1) {
    return { success: false, message: `Expected child nesting 1, got ${listItems[1].nestingLevel}` };
  }
  return { success: true };
});

test('Nested unordered list (3 levels)', () => {
  const md = '# Doc\n\n- Level 0\n    - Level 1\n        - Level 2';
  const ir = markdownToIR(md, loadConfig());
  const listItems = ir.filter(p => p.type === 'list_item');
  
  if (listItems.length !== 3) {
    return { success: false, message: `Expected 3 list items, got ${listItems.length}` };
  }
  
  const levels = listItems.map(i => i.nestingLevel);
  return assertEqual(levels, [0, 1, 2]);
});

test('Nested ordered list', () => {
  const md = '# Doc\n\n1. Parent\n    1. Child\n    2. Child 2';
  const ir = markdownToIR(md, loadConfig());
  const listItems = ir.filter(p => p.type === 'list_item');
  
  if (listItems.length !== 3) {
    return { success: false, message: `Expected 3 list items, got ${listItems.length}` };
  }
  return { success: true };
});

test('Mixed nested lists (unordered parent, ordered child)', () => {
  const md = '# Doc\n\n- Unordered parent\n    1. Ordered child';
  const ir = markdownToIR(md, loadConfig());
  const listItems = ir.filter(p => p.type === 'list_item');
  
  if (listItems.length !== 2) {
    return { success: false, message: `Expected 2 list items, got ${listItems.length}` };
  }
  return { success: true };
});

test('Nested list plain text uses tabs for nesting', () => {
  const md = '# Doc\n\n- Parent\n    - Child';
  const ir = markdownToIR(md, loadConfig());
  const result = irToPlainTextWithRanges(ir);
  
  // Child item should have a tab character for nesting
  if (!result.plain.includes('\t')) {
    return { success: false, message: 'Expected tab character for nested list item' };
  }
  return { success: true };
});

// =============================================================================
// LIST BOUNDARY TESTS
// =============================================================================

console.log('\n=== LIST BOUNDARIES ===\n');

test('Content after list is not included in list', () => {
  const md = '# Doc\n\n- Item 1\n- Item 2\n\n## Heading After';
  const ir = markdownToIR(md, loadConfig());
  const result = irToPlainTextWithRanges(ir);
  
  // Find where heading starts
  const headingStart = result.plain.indexOf('Heading After');
  if (headingStart === -1) {
    return { success: false, message: 'Heading not found in plain text' };
  }
  
  // List range should end before heading
  const listRange = result.listRanges?.[0];
  if (!listRange) {
    return { success: false, message: 'No list range found' };
  }
  
  if (listRange.endIndex >= headingStart) {
    return { 
      success: false, 
      message: `List endIndex (${listRange.endIndex}) should be < heading start (${headingStart})` 
    };
  }
  return { success: true };
});

test('Paragraph after list is not a list item', () => {
  const md = '# Doc\n\n- Item 1\n- Item 2\n\nNormal paragraph.';
  const ir = markdownToIR(md, loadConfig());
  
  const lastPara = ir[ir.length - 1];
  if (lastPara.type === 'list_item') {
    return { success: false, message: 'Last paragraph should not be a list item' };
  }
  return { success: true };
});

// =============================================================================
// CODE BLOCK TESTS
// =============================================================================

console.log('\n=== CODE BLOCKS ===\n');

test('Code block with language preserves', () => {
  const md = '# Title\n\n```javascript\nconst x = 1;\n```';
  const ir = markdownToIR(md, loadConfig());
  const codeBlock = ir.find(p => p.type === 'code_block');
  
  if (!codeBlock) {
    return { success: false, message: 'Code block not found' };
  }
  if (codeBlock.language !== 'javascript') {
    return { success: false, message: `Expected language javascript, got ${codeBlock.language}` };
  }
  return { success: true };
});

test('Code block content preserves through roundtrip', () => {
  const md = '# Title\n\n```python\ndef hello():\n    print("world")\n```';
  const ir = markdownToIR(md, loadConfig());
  const result = irToMarkdown(ir, loadConfig());
  
  const r1 = assertContains(result, '```python');
  const r2 = assertContains(result, 'def hello():');
  const r3 = assertContains(result, 'print("world")');
  if (!r1.success) return r1;
  if (!r2.success) return r2;
  return r3;
});

test('Code block without language', () => {
  const md = '# Title\n\n```\nplain code\n```';
  const ir = markdownToIR(md, loadConfig());
  const codeBlock = ir.find(p => p.type === 'code_block');
  
  if (!codeBlock) {
    return { success: false, message: 'Code block not found' };
  }
  return { success: true };
});

test('Multiple code blocks', () => {
  const md = '# Title\n\n```js\ncode1\n```\n\n```py\ncode2\n```';
  const ir = markdownToIR(md, loadConfig());
  const codeBlocks = ir.filter(p => p.type === 'code_block');
  
  if (codeBlocks.length !== 2) {
    return { success: false, message: `Expected 2 code blocks, got ${codeBlocks.length}` };
  }
  return { success: true };
});

// =============================================================================
// CALLOUT TESTS
// =============================================================================

console.log('\n=== CALLOUTS ===\n');

test('Note callout parses correctly', () => {
  const md = '# Title\n\n<note>This is a note.</note>';
  const ir = markdownToIR(md, loadConfig());
  const callout = ir.find(p => p.type === 'callout');
  
  if (!callout) {
    return { success: false, message: 'Callout not found' };
  }
  if (callout.calloutType !== 'note') {
    return { success: false, message: `Expected calloutType note, got ${callout.calloutType}` };
  }
  return { success: true };
});

test('Info callout parses correctly', () => {
  const md = '# Title\n\n<info>Important information.</info>';
  const ir = markdownToIR(md, loadConfig());
  const callout = ir.find(p => p.type === 'callout');
  
  if (!callout || callout.calloutType !== 'info') {
    return { success: false, message: 'Info callout not found or wrong type' };
  }
  return { success: true };
});

test('Warning callout parses correctly', () => {
  const md = '# Title\n\n<warning>Be careful!</warning>';
  const ir = markdownToIR(md, loadConfig());
  const callout = ir.find(p => p.type === 'callout');
  
  if (!callout || callout.calloutType !== 'warning') {
    return { success: false, message: 'Warning callout not found or wrong type' };
  }
  return { success: true };
});

test('Question callout parses correctly', () => {
  const md = '# Title\n\n<question>What is this?</question>';
  const ir = markdownToIR(md, loadConfig());
  const callout = ir.find(p => p.type === 'callout');
  
  if (!callout || callout.calloutType !== 'question') {
    return { success: false, message: 'Question callout not found or wrong type' };
  }
  return { success: true };
});

test('Jarvis callout parses correctly', () => {
  const md = '# Title\n\n<jarvis>AI response here.</jarvis>';
  const ir = markdownToIR(md, loadConfig());
  const callout = ir.find(p => p.type === 'callout');
  
  if (!callout || callout.calloutType !== 'jarvis') {
    return { success: false, message: 'Jarvis callout not found or wrong type' };
  }
  return { success: true };
});

test('Callout content preserves through roundtrip', () => {
  const md = '# Title\n\n<note>This note has **bold** text.</note>';
  const ir = markdownToIR(md, loadConfig());
  const result = irToMarkdown(ir, loadConfig());
  
  return assertContains(result, 'note');
});

// =============================================================================
// COMPLEX DOCUMENT TEST
// =============================================================================

console.log('\n=== COMPLEX DOCUMENT ===\n');

test('Complex document with all features', () => {
  const md = `# Complete Test Document

*This is the subtitle*

This is a paragraph with **bold**, *italic*, and \`inline code\`.

## Links Section

Check out [Google](https://www.google.com) for searching.
Here's an internal link reference: [see note](:/abc123).

## Images

![Sample image](:/88a9c8449f054280ad2c402f451b5373)

## Lists

### Unordered List
- First item
- Second item with **bold**
- Third item
    - Nested item 1
    - Nested item 2
        - Deeply nested

### Ordered List
1. Step one
2. Step two
    1. Sub-step A
    2. Sub-step B
3. Step three

## Code Examples

\`\`\`javascript
function hello() {
    console.log("Hello, world!");
}
\`\`\`

\`\`\`python
def greet(name):
    return f"Hello, {name}!"
\`\`\`

## Callouts

<note>This is an important note to remember.</note>

<warning>Be careful with this operation!</warning>

<info>Additional information here.</info>

## Final Section

This is the end of the document.`;

  const ir = markdownToIR(md, loadConfig());
  const result = irToMarkdown(ir, loadConfig());
  
  // Check key features are preserved
  const checks = [
    assertContains(result, 'Complete Test Document'),
    assertContains(result, '**bold**'),
    assertContains(result, '*italic*'),
    assertContains(result, '`inline code`'),
    assertContains(result, '[Google](https://www.google.com)'),
    assertContains(result, '![Sample image]'),
    assertContains(result, 'Nested item'),
    assertContains(result, '```javascript'),
    assertContains(result, '```python'),
  ];
  
  for (const check of checks) {
    if (!check.success) return check;
  }
  
  return { success: true };
});

test('Complex document produces valid IR structure', () => {
  const md = `# Title

- List 1
- List 2
    - Nested

1. Ordered 1
2. Ordered 2

\`\`\`js
code
\`\`\`

<note>Callout</note>

Final paragraph.`;

  const ir = markdownToIR(md, loadConfig());
  
  // Should have: title, 3 list items (unordered), 2 list items (ordered), code block, callout, paragraph
  const types = ir.map(p => p.type);
  
  if (!types.includes('title')) {
    return { success: false, message: 'Missing title' };
  }
  if (!types.includes('list_item')) {
    return { success: false, message: 'Missing list items' };
  }
  if (!types.includes('code_block')) {
    return { success: false, message: 'Missing code block' };
  }
  if (!types.includes('callout')) {
    return { success: false, message: 'Missing callout' };
  }
  
  return { success: true };
});

test('Complex document list ranges are correctly separated', () => {
  const md = `# Title

- Unordered 1
- Unordered 2

Some text between.

1. Ordered 1
2. Ordered 2`;

  const ir = markdownToIR(md, loadConfig());
  const result = irToPlainTextWithRanges(ir);
  
  // Should have 2 separate list ranges (unordered and ordered)
  if (!result.listRanges || result.listRanges.length !== 2) {
    return { 
      success: false, 
      message: `Expected 2 list ranges, got ${result.listRanges?.length}` 
    };
  }
  
  // First should be unordered, second ordered
  if (result.listRanges[0].listType !== 'unordered') {
    return { success: false, message: 'First list should be unordered' };
  }
  if (result.listRanges[1].listType !== 'ordered') {
    return { success: false, message: 'Second list should be ordered' };
  }
  
  return { success: true };
});

// =============================================================================
// SUMMARY
// =============================================================================

console.log('\n' + '='.repeat(50));
console.log(`Results: ${GREEN}${passed} passed${RESET}, ${RED}${failed} failed${RESET}, ${YELLOW}${skipped} skipped${RESET}`);
console.log('='.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
