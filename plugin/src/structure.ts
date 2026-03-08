// Structural binding strategies for Google Docs ↔ Joplin
// - Single-document (no tabs): bind to a single note
// - Multi-tab (future): bind to a notebook with one note per tab

export type DocLike = {
  title?: string; // Google Doc file name (Docs API documents.get returns .title)
  body?: { content?: any[] };
  documentId?: string;
  /** Inline objects dictionary for image support (from documents.get) */
  inlineObjects?: Record<string, any>;
  /** Lists dictionary for list type detection (from documents.get) */
  lists?: Record<string, any>;
};

export type TabInfo = { tabId: string; name?: string; index: number };

export type StructureAnalysis = {
  hasTabs: boolean;
  tabCount: number;
  titleParaText?: string; // TITLE paragraph text if present
  tabs?: TabInfo[];
};

export type SingleDecision = {
  mode: 'single';
  noteTitle: string;
  heading1?: string;
};

export type MultiDecision = {
  mode: 'multi';
  notebookTitle: string;
  tabs: Array<{ tabId?: string; noteTitle: string; heading1?: string }>;
};

export type StructuralDecision = SingleDecision | MultiDecision;

// Note: The BindingStrategy classes below are no longer actively used
// but kept for potential future multi-tab support
export interface BindingStrategy {
  analyze(doc: DocLike): StructureAnalysis;
  decide(doc: DocLike, analysis: StructureAnalysis): StructuralDecision;
}

type RawTabEntry = {
  id?: string;
  tabId?: string;
  tab?: { id?: string };
  name?: string;
  title?: string;
};

export function extractTabs(doc: DocLike): TabInfo[] {
  const tabs: TabInfo[] = [];
  const seen = new Set<string>();
  // Google Docs API response may include tabs under different property names
  const extended = doc as DocLike & { tabs?: RawTabEntry[]; documentTabs?: RawTabEntry[]; tabList?: RawTabEntry[] };
  const explicit = extended.tabs || extended.documentTabs || extended.tabList;
  if (Array.isArray(explicit)) {
    explicit.forEach((t, idx) => {
      const id = String(t.id || t.tabId || t.tab?.id || idx);
      if (!seen.has(id)) { seen.add(id); tabs.push({ tabId: id, name: t.name || t.title, index: idx }); }
    });
  }
  return tabs;
}

export class SingleDocumentBindingStrategy implements BindingStrategy {
  analyze(doc: DocLike): StructureAnalysis {
    const content = doc?.body?.content || [];
    let titleParaText: string | undefined;
    const tabs = extractTabs(doc);
    for (const c of content) {
      const p = (c as { paragraph?: { elements?: { textRun?: { content?: string } }[]; paragraphStyle?: { namedStyleType?: string } } }).paragraph;
      if (!p?.elements?.length) continue;
      if (p?.paragraphStyle?.namedStyleType === 'TITLE') {
        let text = '';
        for (const el of p.elements) {
          const tr = el?.textRun;
          if (!tr?.content) continue;
          // Strip PUA (Docs variables) and convert vertical tab to newline
          text += tr.content.replace(/[\uE000-\uF8FF]/g, '').replace(/\u000B/g, '\n');
        }
        titleParaText = text.trim();
        break;
      }
    }
    // Determine single vs multi from detected tabs
    const multi = tabs.length > 1;
    return { hasTabs: multi, tabCount: Math.max(1, tabs.length || 1), titleParaText, tabs };
  }

  decide(doc: DocLike, analysis: StructureAnalysis): StructuralDecision {
    const fileName = (doc?.title || '').trim() || 'Untitled';
    const h1 = (analysis.titleParaText || '').trim();
    return { mode: 'single', noteTitle: fileName, heading1: h1 || undefined };
  }
}

export class MultiTabNotebookBindingStrategy implements BindingStrategy {
  analyze(doc: DocLike): StructureAnalysis {
    const tabs = extractTabs(doc);
    const multi = tabs.length > 1;
    return { hasTabs: multi, tabCount: Math.max(1, tabs.length || 1), tabs };
  }

  decide(doc: DocLike, _analysis: StructureAnalysis): StructuralDecision {
    const name = (doc?.title || '').trim() || 'Untitled';
    const tabs = extractTabs(doc);
    const decided = tabs.map((t, i) => ({ tabId: t.tabId, noteTitle: t.name || `${name} - Tab ${i + 1}` }));
    return { mode: 'multi', notebookTitle: name, tabs: decided };
  }
}

export class SyncStructureManager {
  private single: BindingStrategy;
  private multi: BindingStrategy;

  constructor(single?: BindingStrategy, multi?: BindingStrategy) {
    this.single = single || new SingleDocumentBindingStrategy();
    this.multi = multi || new MultiTabNotebookBindingStrategy();
  }

  run(doc: DocLike): StructuralDecision {
    // For now, run single-document strategy; switch when tab metadata is available
    const a = this.single.analyze(doc);
    if (!a.hasTabs) return this.single.decide(doc, a);
    const b = this.multi.analyze(doc);
    return this.multi.decide(doc, b);
  }
}



export type TabSelectionResult = {
  convertDoc: DocLike; // normalized doc with body.content ready for conversion
  tabCount: number;
  usedTabTitle?: string;
};

// Given a Google Docs API client, fetch the document with includeTabsContent=true,
// pick the desired tab (by tabId when provided, otherwise the first tab), and
// return a normalized DocLike with body.content pointing to that tab's content.
// Falls back to a plain fetch when tabs are not available.
// Always includes inlineObjects for image roundtrip support.
export async function buildConversionDocFromTabs(docsClient: any, documentId: string, opts?: { tabId?: string }): Promise<TabSelectionResult> {
  let tabCount = 0;
  let usedTabTitle = '';
  try {
    const tabsDoc = await docsClient.documents.get({ documentId, includeTabsContent: true });
    const tabs = Array.isArray(tabsDoc?.data?.tabs) ? tabsDoc.data.tabs : [];
    tabCount = tabs.length;
    if (tabCount > 0) {
      // Tab shape varies across API versions -- try multiple property paths
      type RawTab = Record<string, unknown>;
      const tabsTyped = tabs as RawTab[];
      let picked: RawTab | undefined;
      if (opts?.tabId) {
        picked = tabsTyped.find(t => {
          const props = t.tabProperties as { tabId?: string } | undefined;
          return props?.tabId === opts.tabId || t.id === opts.tabId;
        });
      }
      if (!picked) picked = tabsTyped[0];

      // Resolve body content from whichever nesting the API used
      const dt = picked.documentTab as { body?: { content?: unknown[] }; inlineObjects?: Record<string, unknown>; lists?: Record<string, unknown> } | undefined;
      const dc = picked.document as { body?: { content?: unknown[] }; inlineObjects?: Record<string, unknown>; lists?: Record<string, unknown> } | undefined;
      const pb = picked.body as { content?: unknown[] } | undefined;
      const pt = picked.tab as { body?: { content?: unknown[] } } | undefined;
      const contentArr = dt?.body?.content || dc?.body?.content || pb?.content || pt?.body?.content || [];

      // Merge inline objects and lists from both tab and document level (tab takes precedence)
      const tabInlineObjects = dt?.inlineObjects || dc?.inlineObjects || (picked.inlineObjects as Record<string, unknown>) || {};
      const docInlineObjects = tabsDoc?.data?.inlineObjects || {};
      const inlineObjects = { ...docInlineObjects, ...tabInlineObjects };

      const tabLists = dt?.lists || dc?.lists || (picked.lists as Record<string, unknown>) || {};
      const docLists = tabsDoc?.data?.lists || {};
      const lists = { ...docLists, ...tabLists };

      const props = picked.tabProperties as { title?: string } | undefined;
      usedTabTitle = props?.title || (picked.name as string) || (picked.title as string) || '';
      return { 
        convertDoc: { title: tabsDoc?.data?.title, body: { content: contentArr }, inlineObjects, lists }, 
        tabCount, 
        usedTabTitle 
      };
    }
  } catch (_) {
    // ignore and fallback
  }
  // Fallback to classic document body
  const plain = await docsClient.documents.get({ documentId });
  const inlineObjects = plain?.data?.inlineObjects || {};
  const lists = plain?.data?.lists || {};
  const convertDoc: DocLike = { 
    title: plain?.data?.title, 
    body: { content: plain?.data?.body?.content || [] },
    inlineObjects,
    lists,
  };
  return { convertDoc, tabCount, usedTabTitle };
}


