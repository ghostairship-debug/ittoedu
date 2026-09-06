import { pptxReject, xmlAll, xmlChildren, xmlFirst, type PptxPackage } from './pptxPackage'

const child = (node: Element | undefined, name: string) => node && xmlChildren(node).find(n => n.localName === name)
export const relatedPptxPart = (pkg: PptxPackage, path: string, kind: string) => pkg.relationships(path).find(r => !r.external && r.type.endsWith(`/${kind}`))?.target
const drawing = 'http://schemas.openxmlformats.org/drawingml/2006/main'

/** Merge inherited property fragments, never inherited text or source identities. */
function merge(base: Element | undefined, local: Element | undefined): Element | undefined {
  if (!base) return local?.cloneNode(true) as Element | undefined
  const result = base.cloneNode(true) as Element
  if (!local) return result
  for (const attr of Array.from(local.attributes)) result.setAttributeNS(attr.namespaceURI, attr.name, attr.value)
  for (const element of xmlChildren(local)) {
    if (['buNone', 'buChar', 'buAutoNum', 'buBlip'].includes(element.localName)) {
      for (const old of xmlChildren(result).filter(n => ['buNone', 'buChar', 'buAutoNum', 'buBlip'].includes(n.localName))) old.remove()
    }
    // DrawingML fill alternatives are a choice, not additive properties.
    if (['solidFill', 'noFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill'].includes(element.localName)) {
      for (const old of xmlChildren(result).filter(n => /Fill$/.test(n.localName))) old.remove()
    }
    const old = child(result, element.localName)
    const next = merge(old, element)!
    if (old) old.replaceWith(next); else result.appendChild(next)
  }
  return result
}

export interface PptxSourceObject { object: Element; path: string; sharedKey?: string }
export function pptxPageObjects(pkg: PptxPackage, path: string): PptxSourceObject[] {
  const slide = pkg.xml(path)
  const layoutPath = relatedPptxPart(pkg, path, 'slideLayout')
  const masterPath = layoutPath && relatedPptxPart(pkg, layoutPath, 'slideMaster')
  const layout = layoutPath ? pkg.xml(layoutPath) : undefined
  const master = masterPath ? pkg.xml(masterPath) : undefined
  const objects = (doc: Document | undefined) => {
    const tree = doc && xmlFirst(doc, 'spTree')
    return tree ? xmlChildren(tree).filter(n => !['nvGrpSpPr', 'grpSpPr', 'extLst'].includes(n.localName)) : []
  }
  const layouts = objects(layout), masters = objects(master)
  const hidden = (doc: Document | undefined) => ['0', 'false'].includes(doc?.documentElement.getAttribute('showMasterSp') ?? '')
  const themePath = (masterPath && relatedPptxPart(pkg, masterPath, 'theme')) || relatedPptxPart(pkg, 'ppt/presentation.xml', 'theme')
  const theme = themePath ? pkg.xml(themePath) : undefined
  const result: PptxSourceObject[] = []
  const resolve = (source: Element, sourcePath: string, sharedKey?: string): PptxSourceObject => {
    const object = source.cloneNode(true) as Element
    if (object.localName === 'grpSp') {
      for (const element of xmlChildren(object)) {
        if (['nvGrpSpPr', 'grpSpPr', 'extLst'].includes(element.localName)) continue
        element.replaceWith(resolve(element, sourcePath).object)
      }
      return { object, path: sourcePath, ...(sharedKey ? { sharedKey } : {}) }
    }
    const ph = xmlFirst(object, 'ph')
    const layoutPh = ph && layouts.find(n => xmlFirst(n, 'ph')?.getAttribute('idx') === ph.getAttribute('idx'))
    const type = ph ? ph.getAttribute('type') ?? xmlFirst(layoutPh ?? object, 'ph')?.getAttribute('type') ?? 'body' : 'other'
    const masterPh = ph && masters.find(n => !!xmlFirst(n, 'ph') && (xmlFirst(n, 'ph')?.getAttribute('type') ?? 'body') === (type === 'ctrTitle' ? 'title' : type))
    const chain = [masterPh, layoutPh, object].filter((n): n is Element => !!n)
    for (const name of ['spPr', 'style']) {
      let effective: Element | undefined
      for (const ancestor of chain) effective = merge(effective, child(ancestor, name))
      const local = child(object, name)
      if (effective) { if (local) local.replaceWith(effective); else object.appendChild(effective) }
    }
    const spPr = child(object, 'spPr'), style = child(object, 'style')
    const referencedStyle = (refName: string, listName: string): Element | undefined => {
      const ref = child(style, refName)
      const index = Number(ref?.getAttribute('idx') ?? 0)
      if (!ref || !theme || index < 1) return undefined
      const list = xmlFirst(theme, listName)
      const selected = list && xmlChildren(list)[index - 1]
      if (!selected) return undefined
      const result = selected.cloneNode(true) as Element
      for (const placeholder of xmlAll(result, 'schemeClr').filter(n => n.getAttribute('val') === 'phClr')) {
        const sourceColor = xmlChildren(ref).find(n => n.localName.endsWith('Clr'))
        if (sourceColor) {
          const replacement = sourceColor.cloneNode(true) as Element
          for (const effect of xmlChildren(placeholder)) replacement.appendChild(effect.cloneNode(true))
          placeholder.replaceWith(replacement)
        }
      }
      return result
    }
    if (spPr && style) {
      if (!xmlChildren(spPr).some(n => /Fill$/.test(n.localName))) {
        const fill = referencedStyle('fillRef', 'fillStyleLst')
        if (fill) spPr.appendChild(fill)
      }
      const inheritedLine = referencedStyle('lnRef', 'lnStyleLst'), line = child(spPr, 'ln')
      if (inheritedLine) { const effective = merge(inheritedLine, line)!; if (line) line.replaceWith(effective); else spPr.appendChild(effective) }
    }
    const body = child(object, 'txBody')
    if (body) {
      let bodyPr: Element | undefined
      for (const ancestor of chain) bodyPr = merge(bodyPr, child(child(ancestor, 'txBody'), 'bodyPr'))
      if (bodyPr) { const old = child(body, 'bodyPr'); if (old) old.replaceWith(bodyPr); else body.prepend(bodyPr) }
      const masterStyles = master && xmlFirst(master, type === 'title' || type === 'ctrTitle' ? 'titleStyle' : type === 'body' ? 'bodyStyle' : 'otherStyle')
      for (const paragraph of xmlChildren(body).filter(n => n.localName === 'p')) {
        const localP = child(paragraph, 'pPr'), level = Number(localP?.getAttribute('lvl') ?? 0) + 1
        let pPr = merge(child(xmlFirst(pkg.xml('ppt/presentation.xml'), 'defaultTextStyle'), `lvl${level}pPr`), child(masterStyles, `lvl${level}pPr`))
        for (const ancestor of chain) {
          const ancestorBody = child(ancestor, 'txBody')
          pPr = merge(pPr, child(child(ancestorBody, 'lstStyle'), `lvl${level}pPr`))
          if (ancestor !== object) pPr = merge(pPr, child(ancestorBody && xmlFirst(ancestorBody, 'p'), 'pPr'))
        }
        pPr = merge(pPr, localP)
        if (pPr) {
          const resolved = paragraph.ownerDocument.createElementNS(drawing, 'a:pPr')
          for (const attr of Array.from(pPr.attributes)) resolved.setAttribute(attr.name, attr.value)
          for (const n of xmlChildren(pPr)) resolved.appendChild(n.cloneNode(true))
          if (localP) localP.replaceWith(resolved); else paragraph.prepend(resolved)
          pPr = resolved
        }
        for (const run of xmlChildren(paragraph).filter(n => n.localName === 'r')) {
          const old = child(run, 'rPr'), effective = merge(child(pPr, 'defRPr'), old)
          const props = run.ownerDocument.createElementNS(drawing, 'a:rPr')
          if (effective) {
            for (const attr of Array.from(effective.attributes)) props.setAttribute(attr.name, attr.value)
            for (const n of xmlChildren(effective)) props.appendChild(n.cloneNode(true))
          }
          if (!props.hasAttribute('sz')) props.setAttribute('sz', '1800')
          if (!child(props, 'solidFill')) {
            const fontColor = child(style, 'fontRef')
            const sourceColor = fontColor && xmlChildren(fontColor).find(n => n.localName.endsWith('Clr'))
            if (sourceColor) { const fill = props.ownerDocument.createElementNS(drawing, 'a:solidFill'); fill.appendChild(sourceColor.cloneNode(true)); props.appendChild(fill) }
          }
          for (const face of ['latin', 'ea', 'cs']) {
            const font = child(props, face), name = font?.getAttribute('typeface')
            if (name?.startsWith('+')) {
              const fontSet = theme && xmlFirst(theme, name.startsWith('+mj') ? 'majorFont' : 'minorFont')
              const value = child(fontSet, face)?.getAttribute('typeface') || child(fontSet, 'latin')?.getAttribute('typeface')
              if (value) font!.setAttribute('typeface', value)
            }
          }
          if (old) old.replaceWith(props); else run.prepend(props)
        }
      }
    }
    // Instance marker has served its purpose; it is not persistent import metadata.
    for (const placeholder of xmlAll(object, 'ph')) placeholder.remove()
    return { object, path: sourcePath, ...(sharedKey ? { sharedKey } : {}) }
  }
  if (!hidden(slide)) {
    if (!hidden(layout)) masters.filter(n => !xmlFirst(n, 'ph')).forEach((n, i) => result.push(resolve(n, masterPath!, `${masterPath}:${i}`)))
    layouts.filter(n => !xmlFirst(n, 'ph')).forEach((n, i) => result.push(resolve(n, layoutPath!, `${layoutPath}:${i}`)))
  }
  for (const object of objects(slide)) result.push(resolve(object, path))
  return result
}

/** Expand ordinary nested groups in source order. Non-affine geometry remains a reported fallback. */
export function expandPptxGroup(source: PptxSourceObject): PptxSourceObject[] {
  if (source.object.localName !== 'grpSp') return [source]
  const transform = child(child(source.object, 'grpSpPr'), 'xfrm')
  const read = (name: string, attr: string) => Number(child(transform, name)?.getAttribute(attr))
  const sx = read('ext', 'cx') / read('chExt', 'cx'), sy = read('ext', 'cy') / read('chExt', 'cy')
  if (![sx, sy].every(n => Number.isFinite(n) && n > 0) || Number(transform?.getAttribute('rot')) || ['flipH', 'flipV'].some(k => ['1', 'true'].includes(transform?.getAttribute(k) ?? ''))) pptxReject('分组变换', '此旋转或翻转分组暂未支持，可在源软件取消组合后重试')
  const output: PptxSourceObject[] = []
  for (const [index, element] of xmlChildren(source.object).entries()) {
    if (['nvGrpSpPr', 'grpSpPr', 'extLst'].includes(element.localName)) continue
    for (const entry of expandPptxGroup({ ...source, object: element, sharedKey: source.sharedKey && `${source.sharedKey}/${index}` })) {
      const object = entry.object.cloneNode(true) as Element, xfrm = xmlFirst(object, 'xfrm')
      const off = xfrm && child(xfrm, 'off'), ext = xfrm && child(xfrm, 'ext')
      if (!off || !ext) pptxReject('分组几何', '分组内对象缺少位置')
      off.setAttribute('x', String(read('off', 'x') + (Number(off.getAttribute('x')) - read('chOff', 'x')) * sx))
      off.setAttribute('y', String(read('off', 'y') + (Number(off.getAttribute('y')) - read('chOff', 'y')) * sy))
      ext.setAttribute('cx', String(Number(ext.getAttribute('cx')) * sx)); ext.setAttribute('cy', String(Number(ext.getAttribute('cy')) * sy))
      // chExt describes child coordinate units, not typography units. Effective
      // font sizes (hundredths of a point) and stroke widths (EMU) stay absolute;
      // the importer applies the page-to-canvas scale once to both.
      output.push({ ...entry, object })
    }
  }
  return output
}
