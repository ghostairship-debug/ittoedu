import { bindMarkdownIdentities, type MarkdownProjection } from '../../shared/document/markdownIdentity'
import { parseDocumentMarkdown, serializeDocumentMarkdown, type MarkdownDocument, type MarkdownOptions } from '../../shared/document/markdown'
import type { MarkdownSourceMap } from '../../shared/document/markdownSourceMap'

interface DeferredDocumentProjection extends MarkdownProjection {
  availableSourceMap(): MarkdownSourceMap
}
const emptyMap: MarkdownSourceMap = { blocks: [] }

/** A cache of the source representation of one immutable semantic document.
 * Reading the semantic document never manufactures a Markdown string or map. */
export function deferDocumentSource(document: MarkdownDocument, options: MarkdownOptions): MarkdownProjection {
  let source: string | undefined, sourceMap: MarkdownSourceMap | undefined
  const readSource = () => source ??= serializeDocumentMarkdown(document, options.target)
  const value: DeferredDocumentProjection = {
    document,
    get source() { return readSource() },
    get sourceMap() {
      if (!sourceMap) {
        const parsed = parseDocumentMarkdown(readSource(), options)
        if (parsed.status !== 'valid') throw new Error('修改无法完整对应源文，原输入仍保留。')
        bindMarkdownIdentities(parsed, document)
        sourceMap = parsed.sourceMap
      }
      return sourceMap
    },
    availableSourceMap: () => sourceMap ?? emptyMap,
  }
  return value
}

/** An absent map is explicit; never present an earlier document's map as current. */
export function availableDocumentSourceMap(projection: MarkdownProjection): MarkdownSourceMap {
  return 'availableSourceMap' in projection
    ? (projection as DeferredDocumentProjection).availableSourceMap() : projection.sourceMap
}
