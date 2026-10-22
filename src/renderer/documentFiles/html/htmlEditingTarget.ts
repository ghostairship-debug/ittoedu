import type { HtmlSourceAddress } from '../../../shared/html/sourceEditCommands'
import type { HtmlSourceNode } from '../../../shared/html/htmlSourceStructure'
import type { HtmlSelectedTarget, HtmlTargetReport } from './htmlPreviewController'

/** This is a transient HTML author target, never a grant or a saved DOM identity. */
export interface HtmlEditingTarget {
  readonly revision: number
  readonly source?: HtmlSourceAddress
  readonly authorKey?: string
}
export interface HtmlSourceSelection {
  readonly revision: number
  readonly from: number
  readonly to: number
}

export function htmlTargetFromPreview(target: HtmlSelectedTarget, revision: number): HtmlEditingTarget {
  const authorKey = target.report.authoring?.authorKey
  if (target.resolved.status !== 'editable' || target.resolved.locator.authoring) return { revision, ...(authorKey ? { authorKey } : {}) }
  const locator = target.resolved.locator
  const span = target.report.kind === 'text' ? locator.valueSpan : locator.elementSpan
  return { revision, ...(authorKey ? { authorKey } : {}), ...(span ? { source: {
    kind: target.report.kind === 'text' ? 'text' as const : 'element' as const, from: span.start, to: span.end,
  } } : {}) }
}

export function htmlTargetNode(target: HtmlEditingTarget | null | undefined, nodes: readonly HtmlSourceNode[], revision: number): HtmlSourceNode | undefined {
  if (!target || target.revision !== revision) return
  const authors = target.authorKey ? nodes.filter(node => node.attributes['data-cw-author-key'] === target.authorKey) : []
  if (authors.length === 1) return authors[0]
  const address = target.source
  if (!address) return
  return nodes.filter(node => node.address && node.address.from <= address.from && node.address.to >= address.to)
    .sort((a, b) => a.address!.to - a.address!.from - (b.address!.to - b.address!.from))[0]
}

/** Browser paths count all element siblings, including preserved script/style nodes. */
export function htmlNodePath(roots: readonly HtmlSourceNode[], key: string): HtmlTargetReport['domPath'] | undefined {
  const visit = (nodes: readonly HtmlSourceNode[], path: HtmlTargetReport['domPath']): HtmlTargetReport['domPath'] | undefined => {
    let index = 0
    for (const node of nodes) {
      const next = node.kind === 'text' ? path : [...path, { name: node.name, index: index++ }]
      if (node.key === key) return next
      const found = visit(node.children, next)
      if (found) return found
    }
  }
  return visit(roots, [])
}
