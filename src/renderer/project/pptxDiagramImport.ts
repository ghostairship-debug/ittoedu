import { pptxReject, pptxRelationshipId, xmlAll, xmlChildren, xmlFirst, type PptxPackage } from './pptxPackage'

const drawing = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const diagram = 'http://schemas.microsoft.com/office/drawing/2008/diagram'
const presentation = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const child = (node: Element | undefined, name: string) => node && xmlChildren(node).find(value => value.localName === name)
const reject = (message: string): never => pptxReject('SmartArt', message)
const text = (node: Element | undefined) => node ? Array.from(node.getElementsByTagNameNS(drawing, 't')).map(value => value.textContent ?? '').join('') : ''

/** Project an Office drawing cache onto ordinary source shapes. The data model
 * validates completeness; it never becomes a second persisted diagram model.
 * See MS-ODRAWXML dataModelExt / diagramDrawing for the cache relationship.
 */
export function expandPptxDiagram(object: Element, pkg: PptxPackage, sourcePath: string) {
  if (object.localName !== 'graphicFrame') return undefined
  const refs = xmlFirst(object, 'relIds')
  if (!refs) return undefined
  const related = (path: string, id: string, kind: string) => {
    const relationship = pkg.relationships(path).find(value => value.id === id)
    if (!relationship || relationship.external || !relationship.type.endsWith(`/${kind}`)) return reject(`${kind} 关系缺失、类型错误或指向外部`)
    return relationship.target
  }
  const dataPath = related(sourcePath, pptxRelationshipId(refs, 'dm'), 'diagramData')
  const layoutPath = related(sourcePath, pptxRelationshipId(refs, 'lo'), 'diagramLayout')
  const layout = pkg.xml(layoutPath).documentElement.getAttribute('uniqueId') ?? ''
  const family = ({ process1: '线性流程', orgChart1: '组织层级', cycle2: '循环' } as Record<string, string>)[layout.replace('urn:microsoft.com/office/officeart/2005/8/layout/', '')]
  if (!family) return reject(`暂不支持布局 ${layout || '未知'}，首批支持基本流程、组织结构和基本循环`)
  const data = pkg.xml(dataPath)
  const extension = xmlFirst(data, 'dataModelExt')
  if (!extension) return reject('缺少可确定读取的绘制缓存')
  const cachePath = related(sourcePath, extension.getAttribute('relId') ?? '', 'diagramDrawing')
  const tree = xmlFirst(pkg.xml(cachePath), 'spTree')
  if (!tree) return reject('绘制缓存缺少对象树')
  const points = xmlAll(data, 'pt').filter(point => point.parentElement?.localName === 'ptLst')
  if (points.length > 500) return reject('图示节点超过首批导入范围')
  const pointById = new Map<string, Element>()
  for (const point of points) {
    const id = point.getAttribute('modelId') ?? ''
    if (!id || pointById.has(id)) return reject('图示节点身份缺失或重复')
    pointById.set(id, point)
  }
  const drawnText = new Map<string, string>()
  const drawnIds = new Set<string>()
  const shapes = xmlChildren(tree).filter(value => !['nvGrpSpPr', 'grpSpPr', 'extLst'].includes(value.localName))
  if (!shapes.length || shapes.length > 200 || shapes.some(shape => shape.localName !== 'sp')) return reject('首批只支持由普通形状组成的图示')
  for (const shape of shapes) {
    const modelId = shape.getAttribute('modelId') ?? ''
    if (drawnIds.has(modelId)) return reject('绘制缓存包含重复节点')
    drawnIds.add(modelId)
    const point = pointById.get(modelId)
    if (!point || point.getAttribute('type') !== 'pres') return reject('绘制缓存节点与数据模型不匹配')
    const id = child(point, 'prSet')?.getAttribute('presAssocID') ?? ''
    if (!pointById.has(id)) return reject('绘制缓存缺少语义节点关联')
    const value = text(child(shape, 'txBody'))
    if (value) drawnText.set(id, (drawnText.get(id) ?? '') + value)
  }
  for (const [id, point] of pointById) {
    if (point.getAttribute('type') === 'pres') continue
    if (text(child(point, 't')) !== (drawnText.get(id) ?? '')) return reject('绘制缓存与图示文字不一致，请在源软件更新图示后重试')
  }
  // Multiple presentation points can share one style index (e.g. a node and its
  // invisible layout box). At least one drawing must cover each declared index,
  // including textless arrows; comparing labels alone cannot detect lost edges.
  const styleGroups = new Map<string, { count: number; drawn: Set<number> }>()
  for (const [id, point] of pointById) {
    if (point.getAttribute('type') !== 'pres') continue
    const properties = child(point, 'prSet'), label = properties?.getAttribute('presStyleLbl')
    const count = Number(properties?.getAttribute('presStyleCnt') ?? 0)
    if (!label || count === 0) continue
    const index = Number(properties?.getAttribute('presStyleIdx'))
    if (!Number.isInteger(count) || count < 1 || count > 200 || !Number.isInteger(index) || index < 0 || index >= count) return reject('图示绘制索引无效')
    const group = styleGroups.get(label) ?? { count, drawn: new Set<number>() }
    if (group.count !== count) return reject('图示绘制数量不一致')
    if (drawnIds.has(id)) group.drawn.add(index)
    styleGroups.set(label, group)
  }
  if ([...styleGroups.values()].some(group => group.drawn.size !== group.count)) return reject('绘制缓存缺少节点或连接，请在源软件更新图示后重试')
  const doc = object.ownerDocument
  const make = (name: string, attrs: Record<string, string> = {}, ns = drawing) => {
    const element = doc.createElementNS(ns, `${ns === presentation ? 'p' : 'a'}:${name}`)
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value)
    return element
  }
  const clone = (source: Element): Element => {
    const ns = source.namespaceURI === diagram ? presentation : source.namespaceURI!
    const result = doc.createElementNS(ns, `${ns === presentation ? 'p' : source.prefix ?? 'a'}:${source.localName}`)
    for (const attr of Array.from(source.attributes)) result.setAttributeNS(attr.namespaceURI, attr.name, attr.value)
    for (const node of Array.from(source.childNodes)) result.appendChild(node.nodeType === 1 ? clone(node as Element) : node.cloneNode(true))
    return result
  }
  const frame = child(object, 'xfrm')
  const off = child(frame, 'off'), ext = child(frame, 'ext')
  if (!off || !ext) return reject('缺少图示位置和尺寸')
  const group = make('grpSp', {}, presentation)
  group.appendChild(make('nvGrpSpPr', {}, presentation))
  const groupProperties = make('grpSpPr', {}, presentation), transform = make('xfrm')
  for (const attr of Array.from(frame!.attributes)) transform.setAttribute(attr.name, attr.value)
  transform.append(clone(off), clone(ext), make('chOff', { x: '0', y: '0' }), make('chExt', { cx: ext.getAttribute('cx')!, cy: ext.getAttribute('cy')! }))
  groupProperties.appendChild(transform); group.appendChild(groupProperties)
  const label = xmlFirst(object, 'cNvPr')?.getAttribute('name') || family
  for (const [index, source] of shapes.entries()) {
    const shape = clone(source), geometry = child(shape, 'spPr'), xfrm = child(geometry, 'xfrm')
    const size = child(xfrm, 'ext')
    if (!geometry || !xfrm || !size) return reject('缓存形状缺少显式几何')
    // A cache path without w/h uses its shape's EMU coordinate system.
    for (const path of xmlAll(geometry, 'path')) {
      if (!path.hasAttribute('w')) path.setAttribute('w', size.getAttribute('cx')!)
      if (!path.hasAttribute('h')) path.setAttribute('h', size.getAttribute('cy')!)
    }
    for (const effect of xmlAll(shape, 'hueOff').concat(xmlAll(shape, 'satOff'), xmlAll(shape, 'alphaOff'))) {
      if (effect.getAttribute('val') === '0') effect.remove()
    }
    const title = `${label} ${index + 1}`
    xmlFirst(shape, 'cNvPr')?.setAttribute('name', title)
    const body = child(shape, 'txBody'), textFrame = child(shape, 'txXfrm')
    body?.remove(); textFrame?.remove()
    group.appendChild(shape)
    if (text(body)) {
      if (!textFrame) return reject('缓存文字缺少显式位置')
      const textShape = make('sp', {}, presentation), nv = make('nvSpPr', {}, presentation)
      nv.appendChild(make('cNvPr', { id: String(index + 1), name: `${label} ${text(body)}` }, presentation))
      const props = make('spPr', {}, presentation), tx = make('xfrm')
      for (const attr of Array.from(textFrame.attributes)) tx.setAttribute(attr.name, attr.value)
      for (const element of xmlChildren(textFrame)) tx.appendChild(clone(element))
      const bodyProperties = child(body, 'bodyPr'), textOff = child(tx, 'off'), textExt = child(tx, 'ext')
      if (!textOff || !textExt) return reject('缓存文字几何不完整')
      const inset = (key: string, fallback: number) => {
        const raw = bodyProperties?.getAttribute(key)
        const value = raw === null || raw === undefined ? fallback : Number(raw)
        if (!Number.isFinite(value) || value < 0) return reject('文字内边距无效')
        return value
      }
      const left = inset('lIns', 91440), right = inset('rIns', 91440), top = inset('tIns', 45720), bottom = inset('bIns', 45720)
      textOff.setAttribute('x', String(Number(textOff.getAttribute('x')) + left))
      textOff.setAttribute('y', String(Number(textOff.getAttribute('y')) + top))
      textExt.setAttribute('cx', String(Number(textExt.getAttribute('cx')) - left - right))
      textExt.setAttribute('cy', String(Number(textExt.getAttribute('cy')) - top - bottom))
      props.append(tx, make('prstGeom', { prst: 'rect' }), make('noFill'))
      const line = make('ln'); line.appendChild(make('noFill')); props.appendChild(line)
      const style = make('style', {}, presentation), font = child(child(shape, 'style'), 'fontRef')
      if (font) style.appendChild(clone(font))
      const fontColor = font && xmlChildren(font).find(value => value.localName.endsWith('Clr'))
      if (fontColor) for (const run of xmlAll(body!, 'r')) {
        let properties = child(run, 'rPr')
        const paragraphDefault = child(child(run.parentElement ?? undefined, 'pPr'), 'defRPr')
        if (!child(properties, 'solidFill') && !child(paragraphDefault, 'solidFill')) {
          if (!properties) { properties = make('rPr'); run.prepend(properties) }
          const fill = make('solidFill'); fill.appendChild(clone(fontColor)); properties.appendChild(fill)
        }
      }
      textShape.append(nv, props, style, body!)
      group.appendChild(textShape)
    }
  }
  return { object: group, path: cachePath, atomicGroup: `${sourcePath}:${xmlFirst(object, 'cNvPr')?.getAttribute('id') ?? cachePath}` }
}
