/** Resolve source Markdown images identically in the renderer and file owner. */
export function resolveFileDocumentImage(relativePath: string, href: string) {
  const parts = relativePath.split('/').slice(0, -1)
  for (const part of decodeURIComponent(href.split(/[?#]/)[0]!).split('/')) {
    if (part === '..') { if (!parts.length) throw new Error('图示引用越出课例目录'); parts.pop() }
    else if (part && part !== '.') parts.push(part)
  }
  return { assetId: `file-${encodeURIComponent(href).replace(/%/g, '-')}`, source: { kind: 'relative' as const, path: parts.join('/') } }
}
