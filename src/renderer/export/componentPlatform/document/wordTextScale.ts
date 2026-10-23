import type { FlowPrintNode } from '../../course/flowPrintPlan'
import type { FlowTextContent } from '../../../../shared/document/content'

/** Scale professional text before the writer rounds CSS pixels to half-points. */
export function scaleReadingNodeText(node: FlowPrintNode, scale: number): FlowPrintNode {
  if (Math.abs(scale - 1) < 1e-9) return node
  const content = (value: FlowTextContent): FlowTextContent => ({ ...value, inlines: value.inlines.map(inline =>
    inline.style?.fontSize === undefined ? inline : { ...inline, style: { ...inline.style, fontSize: inline.style.fontSize * scale } }) })
  switch (node.type) {
    case 'paragraph': case 'heading': return { ...node, content: content(node.content) }
    case 'quote': return { ...node, content: content(node.content), ...(node.citation ? { citation: content(node.citation) } : {}) }
    case 'list': return { ...node, items: node.items.map(item => ({ ...item, content: content(item.content) })) }
    case 'callout': return { ...node, body: content(node.body), ...(node.title ? { title: content(node.title) } : {}) }
    case 'section': return { ...node, title: content(node.title) }
    case 'formula': return { ...node, ...(node.style?.fontSize === undefined ? {} : { style: { ...node.style, fontSize: node.style.fontSize * scale } }) }
    default: return node
  }
}

/** Word table geometry and inherited text must consume the same authored scale.
 * Inherited paragraph/run sizes are read from the reused writer's own styles,
 * rather than guessed from a second set of heading or body defaults. Explicit
 * metrics were already scaled before serialization, avoiding double rounding. */
export function scaleWordInheritedText(xml: string, scale: number, styles: string): string {
  if (Math.abs(scale - 1) < 1e-9) return xml
  const defaultSize = Number(/<w:docDefaults>[\s\S]*?<w:sz\b[^>]*w:val="([\d.]+)"/.exec(styles)?.[1] ?? 22)
  const definitions = new Map<string, { size?: number; basedOn?: string }>()
  for (const match of styles.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g)) {
    const size = /<w:sz\b[^>]*w:val="([\d.]+)"/.exec(match[2]!)?.[1]
    definitions.set(match[1]!, { ...(size ? { size: Number(size) } : {}), basedOn: /<w:basedOn\b[^>]*w:val="([^"]+)"/.exec(match[2]!)?.[1] })
  }
  const inherited = (id: string | undefined, fallback: number, seen = new Set<string>()): number => {
    if (!id || seen.has(id)) return fallback
    seen.add(id)
    const style = definitions.get(id)
    return style?.size ?? inherited(style?.basedOn, fallback, seen)
  }
  return xml.replace(/<w:p>([\s\S]*?)<\/w:p>/g, (_paragraph, content: string) => {
    const paragraphSize = inherited(/<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(content)?.[1], defaultSize)
    const runs = content.replace(/<w:r>([\s\S]*?)<\/w:r>/g, (_run, body: string) => {
      if (!/<w:t\b/.test(body) || /<w:sz\b/.test(body)) return `<w:r>${body}</w:r>`
      const size = Math.max(1, Math.round(inherited(/<w:rStyle\b[^>]*w:val="([^"]+)"/.exec(body)?.[1], paragraphSize) * scale))
      const properties = `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`
      return `<w:r>${body.includes('<w:rPr>') ? body.replace('<w:rPr>', `<w:rPr>${properties}`) : `<w:rPr>${properties}</w:rPr>${body}`}</w:r>`
    })
    return `<w:p>${runs}</w:p>`
  })
}
