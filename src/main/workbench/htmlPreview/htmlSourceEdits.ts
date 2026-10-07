import { inspectHtmlSource, flattenHtmlSourceNodes, sameHtmlSourceAddress, type HtmlSourceNode } from '../../../shared/html/htmlSourceStructure'
import { scanHtmlSource } from '../../../shared/html/htmlSourceScanner'
import type { HtmlSourceEditCommand } from '../../../shared/html/sourceEditCommands'
import { patchCompositionInlineStyle } from '../../../shared/composition/inlineStyle'
import { escapeHtmlAttribute, escapeHtmlText } from './htmlSourceLocator'

type Splice = { from: number; to: number; text: string }
export type HtmlSourceEditResult =
  | { ok: true; source: string; changed: boolean }
  | { ok: false; reason: 'source-changed' | 'not-editable'; message: string }

function applySplices(source: string, edits: Splice[]): string {
  const sorted = [...edits].sort((a, b) => b.from - a.from || b.to - a.to)
  for (let index = 0; index < sorted.length; index++) {
    const edit = sorted[index]!
    if (edit.from < 0 || edit.to > source.length || edit.from > edit.to
      || (index > 0 && edit.to > sorted[index - 1]!.from)) throw new Error('源码修改区间交叠')
    source = source.slice(0, edit.from) + edit.text + source.slice(edit.to)
  }
  return source
}

function attributeSplices(source: string, target: HtmlSourceNode, patch: Record<string, string | null>): Splice[] {
  const tag = scanHtmlSource(source).tokens.find(token => token.kind === 'start-tag' && token.span.start === target.address?.from)
  if (!tag) throw new Error('元素源码已变化')
  const edits: Splice[] = [], additions: string[] = []
  for (const [name, value] of Object.entries(patch)) {
    if (!/^[^\s"'>/=\x00]+$/.test(name)) throw new Error(`HTML 属性名无效：${name}`)
    const matches = tag.attributes?.filter(attribute => attribute.name === name.toLowerCase()) ?? []
    if (matches.length > 1) throw new Error(`属性 ${name} 在源文中重复，请使用源码编辑`)
    const attribute = matches[0]
    if (attribute) {
      let end = attribute.valueSpan?.end ?? attribute.span.end
      if (attribute.quote) end++
      if (value === null) {
        let from = attribute.span.start
        while (from > tag.span.start && /\s/.test(source[from - 1]!)) from--
        edits.push({ from, to: end, text: '' })
      } else if (attribute.valueSpan) {
        edits.push({ from: attribute.valueSpan.start, to: attribute.valueSpan.end,
          text: escapeHtmlAttribute(value, attribute.quote) })
      } else {
        edits.push({ from: attribute.span.end, to: attribute.span.end, text: `="${escapeHtmlAttribute(value, '"')}"` })
      }
    } else if (value !== null) additions.push(`${name}="${escapeHtmlAttribute(value, '"')}"`)
  }
  if (additions.length) {
    const insertion = source[tag.span.end - 2] === '/' ? tag.span.end - 2 : tag.span.end - 1
    edits.push({ from: insertion, to: insertion, text: ` ${additions.join(' ')}` })
  }
  return edits
}

function changeJson(value: unknown, path: readonly (string | number)[], replacement: unknown): unknown {
  if (path.length === 0) return replacement
  const [key, ...rest] = path
  if (Array.isArray(value)) {
    if (typeof key !== 'number' || key >= value.length) throw new Error('JSON 数组位置已不存在')
    const changed = [...value]; changed[key] = changeJson(value[key], rest, replacement); return changed
  }
  if (!value || typeof value !== 'object' || typeof key !== 'string' || !Object.hasOwn(value, key))
    throw new Error('JSON 数据属性已不存在')
  return Object.fromEntries(Object.entries(value).map(([name, child]) => [name,
    name === key ? changeJson(child, rest, replacement) : child]))
}

/** Produce a precise source patch; the caller retains the document's existing transaction and save owner. */
export function applyHtmlSourceEdit(source: string, command: HtmlSourceEditCommand): HtmlSourceEditResult {
  if (command.type === 'batch') {
    let updated = source
    const remaining = command.commands.map(leaf => structuredClone(leaf))
    for (let i = 0; i < remaining.length; i++) {
      const before = updated
      const result = applyHtmlSourceEdit(before, remaining[i]!)
      if (!result.ok) return result
      updated = result.source
      let from = 0, tail = 0
      while (from < before.length && from < updated.length && before[from] === updated[from]) from++
      while (tail < before.length - from && tail < updated.length - from && before[before.length - tail - 1] === updated[updated.length - tail - 1]) tail++
      const to = before.length - tail, delta = updated.length - before.length
      for (const leaf of remaining.slice(i + 1)) {
        for (const address of [leaf.target, ...('parent' in leaf ? [leaf.parent] : [])]) {
          if (address.from >= to) { address.from += delta; address.to += delta }
          else if (address.from <= from && address.to >= to) address.to += delta
          else if (address.to > from) return { ok: false, reason: 'source-changed', message: '同次操作的源码目标重叠，请重新选择。' }
        }
      }
    }
    return { ok: true, source: updated, changed: updated !== source }
  }
  const structure = inspectHtmlSource(source)
  const nodes = flattenHtmlSourceNodes(structure.roots)
  const target = nodes.find(node => sameHtmlSourceAddress(node.address, command.target))
  const fail = (message: string, reason: 'source-changed' | 'not-editable' = 'not-editable'): HtmlSourceEditResult => ({ ok: false, reason, message })
  let edits: Splice[] = []
  try {
    if (command.type === 'stylesheet') {
      const rule = structure.rules.find(rule => sameHtmlSourceAddress(rule.address, command.target))
      if (!rule) return fail('样式规则已变化', 'source-changed')
      edits = [{ from: rule.address.from, to: rule.address.to, text: patchCompositionInlineStyle(rule.declarations, command.patch) }]
    } else if (command.type === 'data') {
      const data = structure.data.find(data => sameHtmlSourceAddress(data.address, command.target))
      if (!data) return fail('该数据不能可靠定位，请使用源码编辑')
      const raw = source.slice(data.address.from, data.address.to)
      const newline = raw.includes('\r\n') ? '\r\n' : '\n'
      const indent = raw.match(/\n([\t ]+)\S/)?.[1]
      let updated = JSON.stringify(changeJson(data.value, command.path, command.value), null, indent)
      // Do not turn JSON strings into an executable closing script tag.
      updated = updated.replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
      if (newline === '\r\n') updated = updated.replace(/\n/g, newline)
      edits = [{ from: data.address.from, to: data.address.to, text: updated }]
    } else {
      if (!target?.address) return fail('源码目标已变化，请重新选择', 'source-changed')
      if (command.type === 'text') {
        if (target.kind !== 'text') return fail('请修改真实文字节点，程序结果请从源码修改')
        let value = escapeHtmlText(command.text)
        if (source.slice(target.address.from, target.address.to).includes('\r\n')
          || (source.includes('\r\n') && !/(^|[^\r])\n/.test(source))) value = value.replace(/\r?\n/g, '\r\n')
        edits = [{ from: target.address.from, to: target.address.to, text: value }]
      } else if (command.type === 'attributes' || command.type === 'style') {
        if (target.address.kind !== 'element') return fail('该节点没有 HTML 属性')
        const patch = command.type === 'style' ? { style: patchCompositionInlineStyle(target.attributes.style ?? '', command.patch) } : command.patch
        edits = attributeSplices(source, target, patch)
      } else if (command.type === 'remove') {
        if (['html', 'head', 'body'].includes(target.name)) return fail('文档根结构须保留，请使用源码编辑')
        edits = [{ from: target.address.from, to: target.address.to, text: '' }]
      } else if (command.type === 'move') {
        const parent = nodes.find(node => sameHtmlSourceAddress(node.address, command.parent))
        if (!parent?.contentSpan || parent.sourceOnly || parent.kind === 'source') return fail('目标容器没有可定位的静态内容区间')
        if (['html', 'head', 'body'].includes(target.name)) return fail('不能移动文档根结构')
        if (parent.address!.from >= target.address.from && parent.address!.to <= target.address.to) return fail('不能将节点移入自己的后代')
        const siblings = parent.children.filter(node => node.key !== target.key)
        if (command.index > siblings.length) return fail('移动位置超出容器范围')
        const insertion = siblings[command.index]?.address?.from ?? parent.contentSpan.to
        if (insertion >= target.address.from && insertion <= target.address.to) return { ok: true, source, changed: false }
        const original = source.slice(target.address.from, target.address.to)
        edits = [{ from: target.address.from, to: target.address.to, text: '' }, { from: insertion, to: insertion, text: original }]
      }
    }
    const updated = applySplices(source, edits)
    return { ok: true, source: updated, changed: updated !== source }
  } catch (error) { return fail(error instanceof Error ? error.message : String(error)) }
}
