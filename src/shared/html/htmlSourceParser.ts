import { defaultTreeAdapter, parse } from 'parse5'

// Keep parse5's document semantics while releasing its tokenizer's long
// per-character string chains at the existing tree boundary.
export const htmlSourceTreeAdapter: typeof defaultTreeAdapter = {
  ...defaultTreeAdapter,
  insertText(parent, text) { defaultTreeAdapter.insertText(parent, structuredClone(text)) },
  insertTextBefore(parent, text, reference) { defaultTreeAdapter.insertTextBefore(parent, structuredClone(text), reference) },
}

export function parseHtmlSourceDocument(source: string) {
  return parse(source, { sourceCodeLocationInfo: true, treeAdapter: htmlSourceTreeAdapter })
}
