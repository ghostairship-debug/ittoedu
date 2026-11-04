import { XMLSerializer } from '@xmldom/xmldom'
import type { DocxObjectPropertyEdit } from '../../../shared/workbench/officeWordSheetObjects'
import { wordBody } from './docxContent'
import { children, descendants, NS, type OfficePackage } from './officePackage'
import { parseOfficeObjectXml } from './officeObjectXml'

type Target = DocxObjectPropertyEdit['target']
const groups = { paragraph: 'pPr', run: 'rPr', table: 'tblPr', row: 'trPr', cell: 'tcPr' } as const

// Existing Word properties outside the editable set still participate in schema order.
const propertyOrder = {
  pPr: 'pStyle keepNext keepLines pageBreakBefore framePr widowControl numPr suppressLineNumbers pBdr shd tabs suppressAutoHyphens kinsoku wordWrap overflowPunct topLinePunct autoSpaceDE autoSpaceDN bidi adjustRightInd snapToGrid spacing ind contextualSpacing mirrorIndents suppressOverlap jc textDirection textAlignment textboxTightWrap outlineLvl divId cnfStyle rPr sectPr pPrChange',
  rPr: 'rStyle rFonts b bCs i iCs caps smallCaps strike dstrike outline shadow emboss imprint noProof snapToGrid vanish webHidden color spacing w kern position sz szCs highlight u effect bdr shd fitText vertAlign rtl cs em lang eastAsianLayout specVanish oMath rPrChange',
  tblPr: 'tblStyle tblpPr tblOverlap bidiVisual tblStyleRowBandSize tblStyleColBandSize tblW jc tblCellSpacing tblInd tblBorders shd tblLayout tblCellMar tblLook tblCaption tblDescription tblPrChange',
  trPr: 'cnfStyle divId gridBefore gridAfter wBefore wAfter cantSplit trHeight tblHeader tblCellSpacing jc hidden ins del trPrChange',
  tcPr: 'cnfStyle tcW gridSpan hMerge vMerge tcBorders shd noWrap tcMar textDirection tcFitText vAlign hideMark headers cellIns cellDel cellMerge tcPrChange',
}
const sharedOrStructural = new Set('pStyle numPr divId rPr sectPr pPrChange rStyle fitText rPrChange tblStyle tblPrChange gridBefore gridAfter wBefore wAfter ins del trPrChange gridSpan hMerge vMerge headers cellIns cellDel cellMerge tcPrChange'.split(' '))
const nestedProperties: Readonly<Record<string, string>> = {
  pBdr: 'top left bottom right between bar', tabs: 'tab',
  tblBorders: 'top left start bottom right end insideH insideV', tcBorders: 'top left start bottom right end insideH insideV tl2br tr2bl',
  tblCellMar: 'top left start bottom right end', tcMar: 'top left start bottom right end',
}

export function locateDocxObject(pkg: OfficePackage, target: Target) {
  const { main, body } = wordBody(pkg)
  let object: Element | undefined
  if (target.kind === 'paragraph' || target.kind === 'run') {
    const paragraph = descendants(body, NS.word, 'p')[target.paragraph]
    object = target.kind === 'paragraph' ? paragraph : paragraph && descendants(paragraph, NS.word, 'r')[target.run]
  } else {
    const table = descendants(body, NS.word, 'tbl')[target.table]
    if (target.kind === 'table') object = table
    else {
      const row = table && children(table, NS.word, 'tr')[target.row]
      object = target.kind === 'row' ? row : row && children(row, NS.word, 'tc')[target.column]
    }
  }
  if (!object) throw new Error('Word 对象不存在，请重新检查原件位置。')
  const name = groups[target.kind]
  return { main, object, name, group: children(object, NS.word, name)[0] }
}

function validateWordProperty(node: Element, allowedChildren: string) {
  if (node.namespaceURI !== NS.word || Array.from(node.attributes).some(attribute =>
    attribute.namespaceURI !== NS.word && attribute.namespaceURI !== 'http://www.w3.org/2000/xmlns/' || attribute.localName === 'id')) {
    throw new Error('Word 局部属性不得引入其他命名空间或关联标识。')
  }
  const allowed = allowedChildren.split(' ')
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3 && !child.textContent?.trim()) continue
    if (child.nodeType !== 1 || !allowed.includes((child as Element).localName)) throw new Error(`不支持 ${node.localName} 中的属性子节点。`)
    validateWordProperty(child as Element, '')
  }
}

export function editDocxObject(pkg: OfficePackage, input: DocxObjectPropertyEdit) {
  const { main, object, name, group } = locateDocxObject(pkg, input.target)
  const order = propertyOrder[name].split(' '), seen = new Set<string>()
  const properties = input.properties.map(xml => {
    const node = parseOfficeObjectXml(xml, { w: NS.word })
    const property = node.localName
    if (!order.includes(property) || sharedOrStructural.has(property) || seen.has(property))
      throw new Error(`不支持修改 ${name} 的此项局部属性：${property}`)
    seen.add(property)
    validateWordProperty(node, nestedProperties[property] ?? '')
    return node
  })
  const document = object.ownerDocument
  const target = group ?? document.createElementNS(NS.word, `w:${name}`)
  if (!group) {
    const rowException = name === 'trPr' ? children(object, NS.word, 'tblPrEx')[0] : undefined
    object.insertBefore(target, rowException ? rowException.nextSibling : object.firstChild)
  }
  for (const property of properties) {
    const previous = children(target, NS.word, property.localName)
    const replacement = document.importNode(property, true)
    if (previous.length) {
      target.replaceChild(replacement, previous[0]!)
      for (const duplicate of previous.slice(1)) target.removeChild(duplicate)
    } else {
      const rank = order.indexOf(property.localName)
      const next = children(target, NS.word, '*').find(child => order.indexOf(child.localName) > rank)
      target.insertBefore(replacement, next ?? null)
    }
  }
  pkg.write(main)
}

export function inspectDocxObjectProperties(pkg: OfficePackage, target: Target): string[] {
  const { name, group } = locateDocxObject(pkg, target)
  const serializer = new XMLSerializer()
  return group ? children(group, NS.word, '*').filter(node => propertyOrder[name].split(' ').includes(node.localName) && !sharedOrStructural.has(node.localName))
    .map(node => serializer.serializeToString(node)) : []
}
