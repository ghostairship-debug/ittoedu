import { parse, type DefaultTreeAdapterTypes } from 'parse5'

/** Uses the existing software HTML author key on each owned parser boundary. */
export const ownedDocumentKeyAttribute = 'data-cw-author-key'

/** Only the software's first-edit identity promotion; other scope remains exact. */
export function normalizeOwnedDocumentPath(path: string): string {
  return path.replace(/(^|\/)pending:\d+:([^/]+)/g, '$1key:$2')
}

function framesIn(source: string): DefaultTreeAdapterTypes.Element[] {
  const result: DefaultTreeAdapterTypes.Element[] = []
  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if ('tagName' in node && node.tagName === 'iframe') result.push(node)
    if ('childNodes' in node) node.childNodes.forEach(visit)
  }
  visit(parse(source, { sourceCodeLocationInfo: true }))
  return result
}

/**
 * Software iframe identity is author metadata, not executable Source. Compare
 * that one attribute separately so adding/undoing it does not restart programs.
 * Actual HTML, CSS and JavaScript remain part of this source identity.
 */
export function ownedDocumentExecutionSource(source: string): string {
  if (!/<iframe\b/i.test(source)) return source
  const edits: Array<{ start: number; end: number; value: string }> = []
  const quote = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  for (const frame of framesIn(source)) {
    const location = frame.sourceCodeLocation
    if (!location?.attrs) continue
    const identity = location.attrs[ownedDocumentKeyAttribute]
    if (identity) edits.push({ start: identity.startOffset - (source[identity.startOffset - 1] === ' ' ? 1 : 0), end: identity.endOffset, value: '' })
    const srcdoc = frame.attrs.find(attribute => attribute.name === 'srcdoc'), attribute = location.attrs.srcdoc
    if (srcdoc && attribute) edits.push({ start: attribute.startOffset, end: attribute.endOffset,
      value: `srcdoc="${quote(ownedDocumentExecutionSource(srcdoc.value))}"` })
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.value + source.slice(edit.end)
  return source
}

/**
 * First record edit promotes the observed software keys into the exact source
 * iframe chain. Only those start tags/srcdoc attributes change; author content
 * remains in its original parser documents and the caller owns the transaction.
 */
export function anchorOwnedDocumentAuthoring(source: string, observedPath: string): { html: string; documentPath: string } {
  const parts = observedPath.split('/'), stable: string[] = []
  const quote = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  const anchor = (html: string, depth: number): string => {
    const segment = parts[depth]!, pending = /^pending:(\d+):(.+)$/.exec(segment), anchored = /^key:(.+)$/.exec(segment)
    if (!pending && !anchored) throw new Error('子文档尚无软件身份，请重新选择文字')
    const key = decodeURIComponent((pending?.[2] ?? anchored?.[1])!), frames = framesIn(html)
    const matching = frames.filter(frame => frame.attrs.some(attribute => attribute.name === ownedDocumentKeyAttribute && attribute.value === key))
    const frame = pending ? frames[Number(pending[1])] : matching.length === 1 ? matching[0] : undefined
    const currentKey = frame?.attrs.find(attribute => attribute.name === ownedDocumentKeyAttribute)?.value
    if (!frame || matching.length > 1 || currentKey && currentKey !== key || matching.length === 1 && matching[0] !== frame)
      throw new Error('子文档身份已变化，作者修改已保留，请重新选择')
    const srcdoc = frame.attrs.find(attribute => attribute.name === 'srcdoc'), location = frame.sourceCodeLocation
    if (!location?.startTag || depth + 1 < parts.length && (!srcdoc || !location.attrs?.srcdoc)) throw new Error('原子文档源码已不存在，请重新选择')
    stable.push(`key:${encodeURIComponent(key)}`)
    const edits: Array<{ start: number; end: number; value: string }> = []
    if (!currentKey) {
      const end = location.startTag.endOffset, at = end - (html.slice(end - 2, end) === '/>' ? 2 : 1)
      edits.push({ start: at, end: at, value: ` ${ownedDocumentKeyAttribute}="${quote(key)}"` })
    }
    if (depth + 1 < parts.length) {
      const child = anchor(srcdoc!.value, depth + 1)
      if (child !== srcdoc!.value) edits.push({ start: location.attrs!.srcdoc!.startOffset, end: location.attrs!.srcdoc!.endOffset,
        value: `srcdoc="${quote(child)}"` })
    }
    for (const edit of edits.sort((a, b) => b.start - a.start)) html = html.slice(0, edit.start) + edit.value + html.slice(edit.end)
    return html
  }
  return { html: anchor(source, 0), documentPath: stable.join('/') }
}
