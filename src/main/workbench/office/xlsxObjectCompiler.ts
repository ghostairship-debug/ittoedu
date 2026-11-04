import { XMLSerializer } from '@xmldom/xmldom'
import type { XlsxObjectPropertyEdit } from '../../../shared/workbench/officeWordSheetObjects'
import { children, descendants, NS, type OfficePackage } from './officePackage'
import { parseOfficeObjectXml } from './officeObjectXml'
import { address, cellAt, sheets, updateDimension, xlsxStylePart } from './xlsxContent'

const attributes = {
  alignment: 'horizontal vertical textRotation wrapText indent relativeIndent justifyLastLine shrinkToFit readingOrder',
  protection: 'locked hidden',
  font: '', name: 'val', charset: 'val', family: 'val', b: 'val', i: 'val', strike: 'val', outline: 'val', shadow: 'val',
  condense: 'val', extend: 'val', sz: 'val', u: 'val', vertAlign: 'val', scheme: 'val',
  fill: '', patternFill: 'patternType', gradientFill: 'type degree left right top bottom', stop: 'position',
  border: 'diagonalUp diagonalDown outline', start: 'style', end: 'style', left: 'style', right: 'style', top: 'style', bottom: 'style',
  diagonal: 'style', vertical: 'style', horizontal: 'style',
  color: 'auto indexed rgb theme tint', fgColor: 'auto indexed rgb theme tint', bgColor: 'auto indexed rgb theme tint',
} as const
type StyleElement = keyof typeof attributes

const styleChildren: Partial<Record<StyleElement, string>> = {
  font: 'name charset family b i strike outline shadow condense extend color sz u vertAlign scheme',
  fill: 'patternFill gradientFill', patternFill: 'fgColor bgColor', gradientFill: 'stop', stop: 'color',
  border: 'start end left right top bottom diagonal vertical horizontal',
  start: 'color', end: 'color', left: 'color', right: 'color', top: 'color', bottom: 'color',
  diagonal: 'color', vertical: 'color', horizontal: 'color',
}
const styleLists = { font: ['fonts', 'fontId', 'applyFont'], fill: ['fills', 'fillId', 'applyFill'], border: ['borders', 'borderId', 'applyBorder'] } as const

function checkStyleElement(node: Element, name: StyleElement) {
  if (node.localName !== name || node.namespaceURI !== NS.sheet) throw new Error(`Excel 单元格样式需要 ${name} 元素。`)
  const allowedAttributes = attributes[name].split(' '), allowedChildren = styleChildren[name]?.split(' ') ?? []
  for (const attribute of Array.from(node.attributes)) {
    if (attribute.namespaceURI === 'http://www.w3.org/2000/xmlns/') continue
    if (attribute.namespaceURI || !allowedAttributes.includes(attribute.name)) throw new Error(`不支持 ${name} 的属性：${attribute.name}`)
  }
  const seen = new Set<string>()
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3 && !child.textContent?.trim()) continue
    const childName = (child as Element).localName as StyleElement
    if (child.nodeType !== 1 || !allowedChildren.includes(childName) || (name !== 'gradientFill' && seen.has(childName)))
      throw new Error(`不支持 ${name} 中的样式子节点。`)
    checkStyleElement(child as Element, childName)
    seen.add(childName)
  }
  if (name === 'fill' && seen.size !== 1) throw new Error('请提供一个完整的填充方式。')
}

function setAttributes(target: Element, patch: Element) {
  for (const attribute of Array.from(patch.attributes)) if (!attribute.namespaceURI) target.setAttribute(attribute.name, attribute.value)
}

function setStyleChild(target: Element, patch: Element, orderedNames: string[]) {
  const next = target.ownerDocument.importNode(patch, true)
  const prior = children(target, NS.sheet, patch.localName)[0]
  if (prior) target.replaceChild(next, prior)
  else {
    const index = orderedNames.indexOf(patch.localName)
    const successor = children(target, NS.sheet, '*').find(child => orderedNames.indexOf(child.localName) > index)
    target.insertBefore(next, successor ?? null)
  }
}

function appendRecord(list: Element, record: Element): number {
  const count = children(list, NS.sheet, record.localName).length
  list.appendChild(record)
  list.setAttribute('count', String(count + 1))
  return count
}

function numberFormat(styleSheet: Element, code: string): string {
  let formats = children(styleSheet, NS.sheet, 'numFmts')[0]
  if (!formats) {
    formats = styleSheet.ownerDocument.createElementNS(NS.sheet, 'numFmts')
    styleSheet.insertBefore(formats, styleSheet.firstChild)
  }
  const records = children(formats, NS.sheet, 'numFmt')
  const existing = records.find(record => record.getAttribute('formatCode') === code)?.getAttribute('numFmtId')
  if (existing) return existing
  const used = new Set(records.map(record => Number(record.getAttribute('numFmtId'))))
  let id = 164
  while (used.has(id)) id++
  const entry = styleSheet.ownerDocument.createElementNS(NS.sheet, 'numFmt')
  entry.setAttribute('numFmtId', String(id))
  entry.setAttribute('formatCode', code)
  appendRecord(formats, entry)
  return String(id)
}

function resolve(pkg: OfficePackage, target: XlsxObjectPropertyEdit['target']) {
  const sheet = sheets(pkg).find(value => value.name === target.sheet)
  if (!sheet) throw new Error(`Excel 工作表不存在：${target.sheet}`)
  const point = address(target.cell)
  const stylePart = xlsxStylePart(pkg)
  if (!stylePart) throw new Error('此工作簿没有现有的 Excel 样式部件。')
  const styleSheet = pkg.xml(stylePart).documentElement
  const cellFormats = children(styleSheet, NS.sheet, 'cellXfs')[0]
  if (!cellFormats) throw new Error('此工作簿没有现有的单元格格式表。')
  const data = descendants(sheet.xml, NS.sheet, 'sheetData')[0]
  const row = data && children(data, NS.sheet, 'row').find(node => Number(node.getAttribute('r')) === point.row)
  const cell = row && children(row, NS.sheet, 'c').find(node => node.getAttribute('r') === point.name)
  const column = descendants(sheet.xml, NS.sheet, 'col').find(node => Number(node.getAttribute('min')) <= point.column && Number(node.getAttribute('max')) >= point.column)
  const inherited = row?.hasAttribute('s') ? row.getAttribute('s') : column?.getAttribute('style')
  const index = Number(cell?.getAttribute('s') || inherited || 0)
  const current = children(cellFormats, NS.sheet, 'xf')[index]
  if (!current) throw new Error('目标单元格的样式引用不存在。')
  return { sheet, cell, styleSheet, stylePart, cellFormats, current }
}

export function editXlsxObject(pkg: OfficePackage, input: XlsxObjectPropertyEdit) {
  const { sheet, cell, styleSheet, stylePart, cellFormats, current } = resolve(pkg, input.target)
  const document = styleSheet.ownerDocument
  const next = current.cloneNode(true) as Element
  for (const name of ['alignment', 'protection', 'font', 'fill', 'border'] as const) {
    const fragment = input.style[name]
    if (!fragment) continue
    const patch = parseOfficeObjectXml(fragment, { '': NS.sheet, x: NS.sheet })
    checkStyleElement(patch, name)
    if (name === 'alignment' || name === 'protection') {
      const existing = children(next, NS.sheet, name)[0]
      if (existing) setAttributes(existing, patch)
      else setStyleChild(next, patch, ['alignment', 'protection', 'extLst'])
      next.setAttribute(name === 'alignment' ? 'applyAlignment' : 'applyProtection', '1')
    } else {
      const [listName, id, apply] = styleLists[name]
      const list = children(styleSheet, NS.sheet, listName)[0]
      const shared = list && children(list, NS.sheet, name)[Number(next.getAttribute(id) ?? 0)]
      if (!list || !shared) throw new Error(`目标单元格缺少 ${name} 的样式定义。`)
      const local = name === 'fill' ? document.importNode(patch, true) as Element : shared.cloneNode(true) as Element
      if (name !== 'fill') {
        setAttributes(local, patch)
        for (const child of children(patch, NS.sheet, '*')) setStyleChild(local, child, styleChildren[name]!.split(' '))
      }
      next.setAttribute(id, String(appendRecord(list, local)))
      next.setAttribute(apply, '1')
    }
  }
  if (input.style.numberFormat !== undefined) {
    next.setAttribute('numFmtId', numberFormat(styleSheet, input.style.numberFormat))
    next.setAttribute('applyNumberFormat', '1')
  }
  const edited = cell ?? cellAt(sheet, input.target.cell)
  edited.setAttribute('s', String(appendRecord(cellFormats, next)))
  if (!cell) updateDimension(sheet)
  pkg.write(stylePart)
  pkg.write(sheet.part)
}

/** Style indices are allocated at compile time. Compare the edited properties, then
 * allocate against the latest stylesheet instead of merging those numeric indices. */
export function compareXlsxStyleEdit(base: OfficePackage, proposed: OfficePackage, latest: OfficePackage, input: XlsxObjectPropertyEdit) {
  const before = resolve(base, input.target), intended = resolve(proposed, input.target), current = resolve(latest, input.target)
  const changed: string[] = [], conflicts: string[] = []
  if (before.sheet.part !== current.sheet.part || before.cell && !current.cell)
    return { changed, conflicts: ['单元格身份'] }
  const compare = (old: string | undefined, requested: string | undefined, latest: string | undefined, property: string) => {
    if (latest !== requested) {
      if (latest !== old) conflicts.push(property)
      else changed.push(property)
    }
  }
  const serializer = new XMLSerializer()
  const select = (state: ReturnType<typeof resolve>, name: 'alignment' | 'protection' | 'font' | 'fill' | 'border') => {
    if (name === 'alignment' || name === 'protection') return children(state.current, NS.sheet, name)[0]
    const [list, attribute] = styleLists[name]
    const group = children(state.styleSheet, NS.sheet, list)[0]
    return group && children(group, NS.sheet, name)[Number(state.current.getAttribute(attribute) || 0)]
  }
  const numberFormat = (state: ReturnType<typeof resolve>) => {
    const id = state.current.getAttribute('numFmtId') ?? '0'
    return descendants(state.styleSheet, NS.sheet, 'numFmt').find(node => node.getAttribute('numFmtId') === id)?.getAttribute('formatCode') ?? id
  }
  if (input.style.numberFormat !== undefined) compare(numberFormat(before), numberFormat(intended), numberFormat(current), '数字格式')
  for (const name of ['alignment', 'protection', 'font', 'fill', 'border'] as const) {
    const fragment = input.style[name]
    if (!fragment) continue
    const old = select(before, name), requested = select(intended, name), latest = select(current, name)
    const xml = (node?: Element) => node && serializer.serializeToString(node)
    if (name === 'fill') {
      compare(xml(old), xml(requested), xml(latest), name)
      continue
    }
    const patch = parseOfficeObjectXml(fragment, { '': NS.sheet, x: NS.sheet })
    for (const attribute of Array.from(patch.attributes)) {
      if (attribute.namespaceURI === 'http://www.w3.org/2000/xmlns/') continue
      const value = (node?: Element) => node?.getAttributeNS(attribute.namespaceURI, attribute.localName) ?? ''
      compare(value(old), value(requested), value(latest), `${name}/@${attribute.name}`)
    }
    for (const child of children(patch, NS.sheet, '*')) {
      const value = (node?: Element) => xml(node && children(node, NS.sheet, child.localName)[0])
      compare(value(old), value(requested), value(latest), `${name}/${child.localName}`)
    }
  }
  return { changed, conflicts }
}

export function inspectXlsxObjectProperties(pkg: OfficePackage, target: XlsxObjectPropertyEdit['target']): XlsxObjectPropertyEdit['style'] {
  const { current, styleSheet } = resolve(pkg, target)
  const serializer = new XMLSerializer()
  const result: XlsxObjectPropertyEdit['style'] = {}
  const id = current.getAttribute('numFmtId')
  const code = descendants(styleSheet, NS.sheet, 'numFmt').find(value => value.getAttribute('numFmtId') === id)?.getAttribute('formatCode')
  if (code) result.numberFormat = code
  for (const name of ['alignment', 'protection'] as const) {
    const node = children(current, NS.sheet, name)[0]
    if (node) result[name] = serializer.serializeToString(node)
  }
  for (const name of ['font', 'fill', 'border'] as const) {
    const [list, attribute] = styleLists[name]
    const group = children(styleSheet, NS.sheet, list)[0]
    const node = group && children(group, NS.sheet, name)[Number(current.getAttribute(attribute) || 0)]
    if (node) result[name] = serializer.serializeToString(node)
  }
  return result
}
