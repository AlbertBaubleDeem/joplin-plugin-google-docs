/**
 * Full roundtrip integration test: Push markdown to Google Docs, pull it back, compare.
 * 
 * Uses the plugin's actual converter functions and provider logic — the same
 * code paths that pushNote and pullNote execute.
 * 
 * Run with: npx tsx src/tests/roundtrip-integration.ts
 * 
 * Requires: Valid OAuth tokens in google-api-tests/.token.json (run: npm run auth)
 * 
 * Artifacts saved to: src/tests/artifacts/
 *   - original.md          — the markdown before push
 *   - pulled.md            — the markdown after pull
 *   - roundtrip-diff.txt   — line-by-line comparison
 */

import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';

// Plugin converters — same imports used by pushNote / pullNote
import {
  convertMarkdownToPlainAndStyles,
  buildDocsStyleUpdateRequests,
  buildListBulletRequests,
  convertDocumentToMarkdown,
} from '../converters';
import { buildConversionDocFromTabs } from '../structure';

// ─── Auth setup (reuse google-api-tests tokens) ─────────────────────────────

const testsDir = path.dirname(__filename);
const artifactsDir = path.join(testsDir, 'artifacts');
const apiTestsDir = path.join(testsDir, '../../../google-api-tests');

const tokensPath = path.join(apiTestsDir, '.token.json');
const envPath = path.join(apiTestsDir, '.env');

function loadEnv(filePath: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) vars[m[1].trim()] = m[2].trim();
  }
  return vars;
}

const env = loadEnv(envPath);
const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));

const auth = new google.auth.OAuth2(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_REDIRECT_URI,
);
auth.setCredentials(tokens);

const docs = google.docs({ version: 'v1', auth });
const drive = google.drive({ version: 'v3', auth });

// ─── Test markdown ───────────────────────────────────────────────────────────

const testMarkdown = `# Comprehensive Roundtrip Test

This document tests all major formatting features supported by the Joplin Google Docs plugin.

## Basic Formatting

This paragraph contains **bold text**, *italic text*, and ***bold italic*** together.
Here's some \`inline code\` in a sentence.

## Links

### External Links
Visit [Google](https://www.google.com) for search.
Check out [GitHub](https://github.com) for code.

### Joplin Internal Links
Reference to [another note](:/abc123def456) in Joplin.
Link to [resource file](:/image789resource) attachment.

## Images

### External Image
![External cat](https://placekitten.com/200/200)

### Joplin Internal Image
![My screenshot](:/88a9c8449f054280ad2c402f451b5373)

## Unordered Lists

### Simple Unordered List
- First item
- Second item
- Third item with longer text that might wrap

### Nested Unordered List
- Level 1 item A
	- Level 2 item A1
	- Level 2 item A2
		- Level 3 deeply nested
	- Level 2 item A3
- Level 1 item B
- Level 1 item C
	- Level 2 under C

## Ordered Lists

### Simple Ordered List
1. First numbered item
2. Second numbered item
3. Third numbered item

### Nested Ordered List
1. Main point one
	1. Sub-point 1.1
	2. Sub-point 1.2
		1. Deep sub-point 1.2.1
2. Main point two
3. Main point three
	1. Sub-point 3.1

## Mixed Content in Lists

### List with Image (same bullet)
- Item with text followed by image
![inline image](:/imageInListItem123)
- Next regular item
- Another item

### List Followed by Different Content

- List item one
- List item two
- List item three

## Heading After List

This paragraph comes right after the list above.

### Another Heading

More content here.

## Code Blocks

### Code without language
\`\`\`
function hello() {
    console.log("Hello world");
}
\`\`\`

### JavaScript Code
\`\`\`javascript
const greeting = (name) => {
    return \`Hello, \${name}!\`;
};
console.log(greeting("World"));
\`\`\`

### Python Code
\`\`\`python
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

print(fibonacci(10))
\`\`\`

### Consecutive Code Blocks
\`\`\`javascript
const a = 1;
\`\`\`
\`\`\`python
b = 2
\`\`\`
\`\`\`
plain code block
\`\`\`

### Consecutive Plain Code Blocks
\`\`\`
first plain block
\`\`\`
\`\`\`
second plain block
\`\`\`
\`\`\`
third plain block
\`\`\`

## Callout Blocks

<note>
This is a note callout with important information for the reader.
</note>

<info>
This is an info callout providing additional context.
</info>

<warning>
This is a warning callout about potential issues.
</warning>

<tip>
This is a tip callout with helpful suggestions.
</tip>

<question>
This is a question callout for the reader to consider.
</question>

<jarvis>
This is a jarvis callout with AI-generated content.
</jarvis>

## Complex Mixed Section

Here's a paragraph before a complex nested structure.

1. First ordered item with **bold** and *italic*
	- Nested unordered under ordered
	- Another nested item
2. Second ordered item
	1. Nested ordered 2.1
	2. Nested ordered 2.2

Then some regular text between lists.

- Unordered after ordered
- With [a link](https://example.com) inside
- And some \`inline code\` too

## Final Section

### H3 Heading

#### H4 Heading

##### H5 Heading

###### H6 Heading

This is the final paragraph of the test document.
`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function diffLines(a: string, b: string): string[] {
  const linesA = a.split('\n');
  const linesB = b.split('\n');
  const maxLen = Math.max(linesA.length, linesB.length);
  const out: string[] = [];
  let matchCount = 0;

  for (let i = 0; i < maxLen; i++) {
    const la = linesA[i] ?? '';
    const lb = linesB[i] ?? '';
    if (la === lb) {
      matchCount++;
      out.push(`  ${i + 1}| ${la}`);
    } else {
      out.push(`- ${i + 1}| ${la}`);
      out.push(`+ ${i + 1}| ${lb}`);
    }
  }

  const similarity = ((matchCount / maxLen) * 100).toFixed(1);
  out.unshift(`Similarity: ${similarity}% (${matchCount}/${maxLen} lines match)\n`);
  return out;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(70));
  console.log('ROUNDTRIP INTEGRATION TEST');
  console.log('Push markdown -> Google Docs -> Pull back -> Compare');
  console.log('='.repeat(70));

  // Ensure artifacts directory exists
  fs.mkdirSync(artifactsDir, { recursive: true });

  // Save original markdown
  const originalPath = path.join(artifactsDir, 'original.md');
  fs.writeFileSync(originalPath, testMarkdown);
  console.log(`\nSaved original markdown: ${originalPath}`);

  // ── PUSH (same flow as pushNote.ts) ──────────────────────────────────────

  console.log('\n── PUSH ──────────────────────────────────────────────');

  // Step 1: Convert markdown to plain text + style ranges
  console.log('1. convertMarkdownToPlainAndStyles...');
  const { plain, paraRanges, textRanges, listRanges, tableRanges } = convertMarkdownToPlainAndStyles(testMarkdown);
  console.log(`   plain: ${plain.length} chars, paraRanges: ${paraRanges.length}, textRanges: ${textRanges.length}, listRanges: ${listRanges.length}, tableRanges: ${tableRanges?.length ?? 0}`);

  // Step 2: Create a new Google Doc via Drive
  console.log('2. Creating Google Doc...');
  const createRes = await drive.files.create({
    requestBody: {
      name: `Roundtrip Integration Test - ${new Date().toISOString()}`,
      mimeType: 'application/vnd.google-apps.document',
    },
  });
  const documentId = createRes.data.id!;
  console.log(`   Document ID: ${documentId}`);
  const docUrl = `https://docs.google.com/document/d/${documentId}/edit`;
  console.log(`   URL: ${docUrl}`);

  // Step 3: Insert plain text with optimistic concurrency
  console.log('3. Inserting plain text...');
  const docRes = await docs.documents.get({ documentId });
  const revisionId = docRes.data.revisionId;

  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [{ insertText: { location: { index: 1 }, text: plain } }],
      writeControl: { requiredRevisionId: revisionId },
    },
  });

  // Step 4: Apply paragraph and text styles
  console.log('4. Applying paragraph & text styles...');
  const styleReqs = buildDocsStyleUpdateRequests(paraRanges, textRanges, {});
  if (styleReqs.length) {
    await docs.documents.batchUpdate({
      documentId,
      requestBody: { requests: styleReqs },
    });
    console.log(`   Applied ${styleReqs.length} style requests`);
  }

  // Step 5: Apply list bullets separately (same as pushNote)
  console.log('5. Applying list bullets (separate batch)...');
  if (listRanges.length) {
    const bulletReqs = buildListBulletRequests(listRanges);
    if (bulletReqs.length) {
      await docs.documents.batchUpdate({
        documentId,
        requestBody: { requests: bulletReqs },
      });
      console.log(`   Applied ${bulletReqs.length} list bullet requests`);
    }
  }

  console.log('\n   Push complete.');

  // ── PULL (same flow as pullNote.ts) ──────────────────────────────────────

  console.log('\n── PULL ──────────────────────────────────────────────');

  // Step 6: Fetch document using buildConversionDocFromTabs (same as pullNote)
  console.log('6. Fetching document via buildConversionDocFromTabs...');
  const { convertDoc, tabCount, usedTabTitle } = await buildConversionDocFromTabs(docs, documentId);
  console.log(`   tabCount: ${tabCount}, usedTabTitle: "${usedTabTitle}"`);

  // Step 7: Convert document back to markdown (same as pullNote)
  console.log('7. convertDocumentToMarkdown...');
  const pulledMarkdown = convertDocumentToMarkdown(convertDoc);
  console.log(`   Pulled markdown: ${pulledMarkdown.length} chars`);

  // Save pulled markdown
  const pulledPath = path.join(artifactsDir, 'pulled.md');
  fs.writeFileSync(pulledPath, pulledMarkdown);
  console.log(`   Saved pulled markdown: ${pulledPath}`);

  // ── COMPARE ──────────────────────────────────────────────────────────────

  console.log('\n── COMPARE ───────────────────────────────────────────');

  const diff = diffLines(testMarkdown.trim(), pulledMarkdown.trim());
  const diffText = diff.join('\n');

  // Save diff
  const diffPath = path.join(artifactsDir, 'roundtrip-diff.txt');
  fs.writeFileSync(diffPath, diffText);
  console.log(`Saved diff: ${diffPath}\n`);

  // Print the similarity line and any differences (lines starting with + or -)
  console.log(diff[0]); // Similarity line
  const changes = diff.filter(l => l.startsWith('- ') || l.startsWith('+ '));
  if (changes.length === 0) {
    console.log('PERFECT ROUNDTRIP - no differences!');
  } else if (changes.length <= 40) {
    console.log(`${changes.length / 2} lines differ:\n`);
    for (const line of changes) {
      console.log(line);
    }
  } else {
    console.log(`${changes.length / 2} lines differ (showing first 20):\n`);
    for (const line of changes.slice(0, 40)) {
      console.log(line);
    }
    console.log('... (see full diff in artifacts/roundtrip-diff.txt)');
  }

  // ── SUMMARY ──────────────────────────────────────────────────────────────

  console.log('\n' + '='.repeat(70));
  console.log('ARTIFACTS');
  console.log('='.repeat(70));
  console.log(`  Original:  ${originalPath}`);
  console.log(`  Pulled:    ${pulledPath}`);
  console.log(`  Diff:      ${diffPath}`);
  console.log(`  Google Doc: ${docUrl}`);
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('Error:', err.message || err);
  if (err.response?.data) {
    console.error('API Error:', JSON.stringify(err.response.data, null, 2));
  }
  process.exit(1);
});
