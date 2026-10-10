import type { z } from 'zod'
import { documentTextStyleSchema, documentTextSlots, documentTextLength, walkDocument, type FlowTextContent } from '../../shared/document/content'
import { parseDocumentMarkdown } from '../../shared/document/markdown'
import { editMarkdownSource } from '../../shared/document/markdownSourceEdit'
import { documentSourceEdits } from '../../shared/document/sourceMerge'
import { createTextComponentData, formatTextComponentRange } from '../../components/text/data'
import { documentDigest } from '../documents/documentDigest'

export type TextStyle = z.infer<typeof documentTextStyleSchema>

/** Use the professional human editor's exact code-point/math-atom formatter. */
export function formatTextContent(content: FlowTextContent, from: number, to: number, style: TextStyle): FlowTextContent {
  return formatTextComponentRange(createTextComponentData(content), from, to, style).content
}

/** Source ranges select parsed visible atoms; unchanged source blocks remain byte-for-byte intact. */
export function formatMarkdownSource(source: string, ranges: readonly { from: number; to: number }[], style: TextStyle) {
  let serial = 0
  const options = { target: 'file' as const, createId: () => `format-${++serial}`,
    // Parsing only: stable image identities let the source owner preserve existing
    // image syntax. These temporary mappings never replace formal resources or load bytes.
    resolveImage: (href: string) => ({ assetId: `format-image-${documentDigest(href)}`,
      source: { kind: 'relative' as const, path: `images/${documentDigest(href)}` } }) }
  const before = parseDocumentMarkdown(source, options)
  if (before.status !== 'valid') throw new Error(before.diagnostics[0]?.message ?? '当前 Markdown 无法解析')
  const after = structuredClone(before.document)
  const selected: { blockId: string; key: string; from: number; to: number }[] = []
  walkDocument(after.content.blocks, block => {
    const map = before.sourceMap.blocks.find(value => value.blockId === block.id)
    for (const slot of documentTextSlots(block)) {
      const mapped = map?.slots.find(value => value.key === slot.key)
      if (!mapped) continue
      if (mapped.units.length !== documentTextLength(slot.content)) throw new Error('当前正文范围无法无损对应源文')
      const indexes = mapped.units.flatMap((unit, index) => !unit.barrier && ranges.some(range => unit.from >= range.from && unit.to <= range.to) ? [index] : [])
      const groups: { from: number; to: number }[] = []
      for (const index of indexes) {
        const tail = groups.at(-1)
        if (tail?.to === index) tail.to++
        else groups.push({ from: index, to: index + 1 })
      }
      for (const range of groups.reverse()) slot.content.inlines = formatTextContent(slot.content, range.from, range.to, style).inlines
      selected.push(...groups.map(range => ({ blockId: block.id, key: slot.key, ...range })))
    }
  })
  if (!selected.length) throw new Error('当前所选范围没有可格式化的正文')
  const nextSource = editMarkdownSource(source, before.document, after, before.sourceMap, options)
  const next = parseDocumentMarkdown(nextSource, { ...options, previous: { source, document: before.document, sourceMap: before.sourceMap } })
  if (next.status !== 'valid') throw new Error('格式修改无法保留当前 Markdown 正文')
  const selectedRanges = selected.map(range => {
    const units = next.sourceMap.blocks.find(block => block.blockId === range.blockId)?.slots.find(slot => slot.key === range.key)?.units
    if (!units?.[range.from] || !units[range.to - 1]) throw new Error('格式后的正文范围无法定位')
    return { from: units[range.from]!.from, to: units[range.to - 1]!.to }
  }).sort((a, b) => a.from - b.from)
  return { source: nextSource, selectedRanges, splices: [...documentSourceEdits(source, nextSource)].reverse().map(edit => ({ from: edit.from, to: edit.to, inserted: edit.text.length })) }
}
