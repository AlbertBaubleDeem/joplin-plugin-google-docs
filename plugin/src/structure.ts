// Structural binding strategies for Google Docs ↔ Joplin
// - Single-document (no tabs): bind to a single note
// - Multi-tab (future): bind to a notebook with one note per tab

export type DocLike = {
  title?: string; // Google Doc file name (Docs API documents.get returns .title)
  body?: { content?: any[] };
  documentId?: string;
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

export interface BindingStrategy {
  analyze(doc: DocLike): StructureAnalysis;
  decide(doc: DocLike, analysis: StructureAnalysis): StructuralDecision;
}

export function extractTabs(doc: DocLike): TabInfo[] {
  const tabs: TabInfo[] = [];
  const seen = new Set<string>();
  // Only use explicit tabs metadata when present. Do not infer from body yet.
  const anyDoc: any = doc as any;
  const explicit = anyDoc?.tabs || anyDoc?.documentTabs || anyDoc?.tabList;
  if (Array.isArray(explicit)) {
    explicit.forEach((t: any, idx: number) => {
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
      const p = (c as any)?.paragraph;
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



// --- Tabs-aware content selection (shared by pull/push) ---

export type TabSelectionResult = {
  convertDoc: DocLike; // normalized doc with body.content ready for conversion
  tabCount: number;
  usedTabTitle?: string;
};

// Given a Google Docs API client, fetch the document with includeTabsContent=true,
// pick the desired tab (by tabId when provided, otherwise the first tab), and
// return a normalized DocLike with body.content pointing to that tab's content.
// Falls back to a plain fetch when tabs are not available.
export async function buildConversionDocFromTabs(docsClient: any, documentId: string, opts?: { tabId?: string }): Promise<TabSelectionResult> {
  let tabCount = 0;
  let usedTabTitle = '';
  try {
    const tabsDoc = await docsClient.documents.get({ documentId, includeTabsContent: true });
    const tabs = Array.isArray(tabsDoc?.data?.tabs) ? tabsDoc.data.tabs : [];
    tabCount = tabs.length;
    if (tabCount > 0) {
      let picked: any = null;
      if (opts?.tabId) {
        picked = tabs.find((t: any) => (t?.tabProperties?.tabId === opts.tabId) || (t?.id === opts.tabId));
      }
      if (!picked) picked = tabs[0];
      const contentArr = Array.isArray(picked?.documentTab?.body?.content) ? picked.documentTab.body.content
        : Array.isArray(picked?.document?.body?.content) ? picked.document.body.content
        : Array.isArray(picked?.body?.content) ? picked.body.content
        : Array.isArray(picked?.tab?.body?.content) ? picked.tab.body.content
        : [];
      usedTabTitle = picked?.tabProperties?.title || picked?.name || picked?.title || '';
      return { convertDoc: { title: tabsDoc?.data?.title, body: { content: contentArr } }, tabCount, usedTabTitle };
    }
  } catch (_) {
    // ignore and fallback
  }
  // Fallback to classic document body
  const plain = await docsClient.documents.get({ documentId });
  const convertDoc: DocLike = { title: plain?.data?.title, body: { content: plain?.data?.body?.content || [] } };
  return { convertDoc, tabCount, usedTabTitle };
}


