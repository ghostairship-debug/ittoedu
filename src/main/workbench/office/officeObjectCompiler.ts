import { officeObjectEditSchema, officeObjectSourceTargetSchema, type OfficeObjectEdit, type OfficeObjectSourceInspection, type OfficeObjectSourceTarget,
  type OfficeScopedObjectSourceInspection, type OfficeScopedObjectSourceTarget } from '../../../shared/workbench/officeObjectEdit'
import type { OfficeContentResult } from '../../../shared/workbench/officeFiles'
import { XMLSerializer } from '@xmldom/xmldom'
import { editDocxObject, inspectDocxObjectProperties, locateDocxObject } from './docxObjectCompiler'
import { editPptxObject, inspectPptxObjectSource } from './pptxObjectCompiler'
import { editXlsxObject, inspectXlsxObjectProperties } from './xlsxObjectCompiler'
import { children, descendants, NS, OfficePackage } from './officePackage'
import { address, cellAt, recalculateXlsx, sheets, updateDimension, xlsxStylePart } from './xlsxContent'
import { attachNativeDependencies, describeNativePart, inspectNativeDependencies, inspectPartRelationships, readNativePart, validateOfficePackageChanges } from './officeNativeDependencies'
import { prepareNativeObjectEdit, replaceNativeObjectNode } from './officeObjectXml'
import { objects } from './pptxContent'

export type OfficeObjectEditResult = OfficeContentResult

const wordNamespaces = { w: NS.word, a: NS.drawing, r: NS.officeRelationship }
const sheetNamespaces = { '': NS.sheet, x: NS.sheet, r: NS.officeRelationship }
const serializer = new XMLSerializer()

/** Compare calculation inputs, excluding styles and cached formula results. */
function xlsxCalculationInputs(pkg: OfficePackage): string {
  const main = pkg.main(), workbook = pkg.xml(main).documentElement
  const relevantWorkbookNodes = ['definedNames', 'externalReferences'].flatMap(name =>
    children(workbook, NS.sheet, name).map(node => serializer.serializeToString(node)))
  const strings = [...pkg.relationships(main).values()].find(part => part.endsWith('/sharedStrings.xml'))
  const shared = strings && pkg.parts[strings] ? serializer.serializeToString(pkg.xml(strings)) : ''
  const allSheets = sheets(pkg)
  // External-link and table definitions can change the meaning of formulas even
  // when no cell XML changes. Follow their internal relationships as well.
  const pending = [main, ...allSheets.map(sheet => sheet.part)].flatMap(owner => inspectPartRelationships(pkg, owner)
    .filter(relation => relation.part && /\/(externalLink|table)$/.test(relation.type)).map(relation => relation.part!))
  const visited = new Set<string>(), dependencies: Array<[string, string]> = []
  for (const part of pending) {
    if (visited.has(part) || !pkg.parts[part]) continue
    visited.add(part)
    const value = /\.(xml|rels)$/i.test(part) ? serializer.serializeToString(pkg.xml(part)) : pkg.partVersion(part)
    dependencies.push([part, value])
    for (const relation of inspectPartRelationships(pkg, part)) if (relation.part) pending.push(relation.part)
  }
  const grid = allSheets.map(sheet => ({ name: sheet.name, part: sheet.part, id: sheet.sheetId,
    cells: descendants(sheet.xml, NS.sheet, 'c').flatMap(cell => {
      const formula = children(cell, NS.sheet, 'f')[0]
      const values = formula ? [formula] : [...children(cell, NS.sheet, 'v'), ...children(cell, NS.sheet, 'is')]
      return values.length ? [{ ref: cell.getAttribute('r'), type: formula ? '' : cell.getAttribute('t'),
        values: values.map(node => serializer.serializeToString(node)) }] : []
    }) }))
  return JSON.stringify({ relevantWorkbookNodes, shared, dependencies, grid })
}

function locateXlsxCell(pkg: OfficePackage, target: Extract<OfficeScopedObjectSourceTarget, { format: 'xlsx' }>['target']) {
  const sheet = sheets(pkg).find(item => item.name === target.sheet)
  if (!sheet) throw new Error(`Excel 工作表不存在：${target.sheet}`)
  const location = address(target.cell)
  const data = descendants(sheet.xml, NS.sheet, 'sheetData')[0]
  const row = data && children(data, NS.sheet, 'row').find(node => Number(node.getAttribute('r')) === location.row)
  const cell = row && children(row, NS.sheet, 'c').find(node => node.getAttribute('r') === location.name)
  return { sheet, location, cell }
}

/** Compile against the observed working bytes. Publication stays with OfficeFileService. */
export function applyOfficeObjectEdit(bytes: Uint8Array, input: OfficeObjectEdit): OfficeObjectEditResult {
  const request = officeObjectEditSchema.parse(input)
  const pkg = new OfficePackage(bytes)
  const calculateInputs = request.format === 'xlsx' && 'native' in request ? xlsxCalculationInputs(pkg) : undefined
  if ('packagePart' in request) {
    const { part, partVersion } = request.packagePart
    if (pkg.partVersion(part) !== partVersion) throw new Error(`原生部件版本已改变，请重新检查：${part}`)
    const originalMain = pkg.main()
    const expectedNamespace = request.format === 'pptx' ? NS.slide : request.format === 'docx' ? NS.word : NS.sheet
    if (pkg.xml(originalMain).documentElement.namespaceURI !== expectedNamespace) throw new Error('当前 Office 包格式与修改请求不符')
    const root = pkg.xml(part).documentElement
    const { node, replacement } = prepareNativeObjectEdit(root, request.native, { ...wordNamespaces, ...sheetNamespaces, p: NS.slide })
    if (node === root && (!replacement || request.native.insert)) throw new Error('部件根须保留单个同类型原生 XML 元素')
    if (replaceNativeObjectNode(node, replacement, request.native.insert)) pkg.write(part)
    attachNativeDependencies(pkg, part, node, replacement, request.native.dependencies)
    if (pkg.main() !== originalMain || pkg.xml(originalMain).documentElement.namespaceURI !== expectedNamespace)
      throw new Error('原生部件修改改变了 Office 主文档身份或格式')
  } else if (request.format === 'pptx') editPptxObject(pkg, request)
  else if (!('native' in request)) {
    if (request.format === 'docx') editDocxObject(pkg, request)
    else editXlsxObject(pkg, request)
  } else if (request.format === 'docx') {
    const { main, object } = locateDocxObject(pkg, request.target)
    const { node, replacement } = prepareNativeObjectEdit(object, request.native, wordNamespaces)
    if (replaceNativeObjectNode(node, replacement, request.native.insert)) pkg.write(main)
    attachNativeDependencies(pkg, main, node, replacement, request.native.dependencies)
  } else {
    const { sheet, location, cell } = locateXlsxCell(pkg, request.target)
    if (!cell && !request.native.xml) return { format: request.format, bytes, changedParts: [], diagnostics: [] }
    if (!cell && request.native.path.length) throw new Error(`单元格还没有原生节点：${sheet.name}!${location.name}`)
    const root = cell ?? cellAt(sheet, location.name)
    const { node, replacement } = prepareNativeObjectEdit(root, request.native, sheetNamespaces)
    if (node === root && request.native.insert) throw new Error('新增单元格请用目标地址直接写入，不在已有地址旁插入重复单元格')
    if (node === root && replacement?.getAttribute('r') !== location.name && replacement)
      throw new Error(`单元格 XML 的地址须为 ${location.name}`)
    if (replaceNativeObjectNode(node, replacement, request.native.insert)) { updateDimension(sheet); pkg.write(sheet.part) }
    attachNativeDependencies(pkg, sheet.part, node, replacement, request.native.dependencies)
  }
  const calculation = calculateInputs !== undefined && calculateInputs !== xlsxCalculationInputs(pkg)
    ? recalculateXlsx(pkg) : undefined
  const output = pkg.save(), changedParts = [...pkg.changed]
  if (changedParts.length) validateOfficePackageChanges(bytes, output, changedParts)
  return { format: request.format, bytes: output, changedParts, diagnostics: calculation?.diagnostics ?? [],
    ...(calculation ? { calculation: calculation.calculation } : {}) }
}

export function inspectOfficeObjectSource(bytes: Uint8Array, input: OfficeScopedObjectSourceTarget): OfficeScopedObjectSourceInspection
export function inspectOfficeObjectSource(bytes: Uint8Array, input: OfficeObjectSourceTarget): OfficeObjectSourceInspection
export function inspectOfficeObjectSource(bytes: Uint8Array, input: OfficeObjectSourceTarget): OfficeObjectSourceInspection {
  const request = officeObjectSourceTargetSchema.parse(input)
  const pkg = new OfficePackage(bytes)
  if ('packagePart' in request) return { format: request.format, ...readNativePart(pkg, request.packagePart) }
  if ('packageParts' in request) return { format: request.format,
    packageParts: Object.keys(pkg.parts).filter(part => !part.endsWith('/')).map(part => describeNativePart(pkg, part)) }
  if (request.format === 'docx') {
    const { main, object } = locateDocxObject(pkg, request.target)
    return { format: request.format, target: request.target, properties: inspectDocxObjectProperties(pkg, request.target),
      xml: serializer.serializeToString(object), ...inspectNativeDependencies(pkg, main, object, request.dependency) }
  }
  if (request.format === 'xlsx') {
    const { sheet, cell } = locateXlsxCell(pkg, request.target)
    const style = xlsxStylePart(pkg) ? inspectXlsxObjectProperties(pkg, request.target) : {}
    return { format: request.format, target: request.target, style, ...(cell ? { xml: serializer.serializeToString(cell) } : {}),
      ...inspectNativeDependencies(pkg, sheet.part, cell, request.dependency) }
  }
  const source = inspectPptxObjectSource(pkg, request.target)
  const root = objects(pkg, source.target.part).find(object => object.shapeId === source.target.shapeId)?.node
  return { ...source, ...inspectNativeDependencies(pkg, source.target.part, root, request.dependency) }
}
