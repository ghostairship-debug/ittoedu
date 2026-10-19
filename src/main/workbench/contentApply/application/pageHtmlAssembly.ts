import { IDENTITY_MATRIX, multiplyMatrices } from '../../../../core/components/geometry'
import type { HtmlAssembly, HtmlAssemblyObject } from '../../../../core/contentApply/assembly/htmlAssembly'
import type { ComponentBackground, ComponentBackgroundPaint, ComponentBackgroundProperty } from '../../../../shared/contracts/component-platform'
import type { ContentApplyDiagnostic } from './types'
import { documentColorChannels } from '../../../../shared/document/color'
import { cssUrlReferences } from '../../../../shared/composition/projectReferences'
import { retainedMeasurementScopeHtml } from '../measurement/prepareMeasurementDocument'

export interface HtmlPageTarget {
  width: number
  height: number
  /** A new/explicitly redone page may adopt paint; an insert preserves existing page paint. */
  adoptBackground: boolean
}

const clear = (value: string | undefined) => !value || ['none', 'transparent', 'rgba(0, 0, 0, 0)'].includes(value)
const close = (a: number, b: number) => Math.abs(a - b) < 0.5

function pageSized(object: HtmlAssemblyObject, page: HtmlPageTarget): boolean {
  return close(object.frame.width, page.width) && close(object.frame.height, page.height)
    && object.frame.transform.every((value, index) => index < 4
      ? Math.abs(value - IDENTITY_MATRIX[index]!) < 1e-7 : close(value, IDENTITY_MATRIX[index]!))
}

function ordinaryShell(object: HtmlAssemblyObject): boolean {
  const style = object.style
  return object.kind === 'group' && !object.retainedSource && !object.program && !object.sourceRegions.length
    && !Object.keys(object.pseudoElements).length
    && ['box-shadow', 'filter', 'backdrop-filter', 'clip-path', 'mask-image', '-webkit-mask-image', 'mix-blend-mode', 'animation-name'].every(name => clear(style[name]) || style[name] === 'normal')
    && Number(style.opacity ?? 1) === 1
    && ['top', 'right', 'bottom', 'left'].every(side => ['none', 'hidden'].includes(style[`border-${side}-style`] ?? 'none') || !(parseFloat(style[`border-${side}-width`] ?? '0') > 0))
    && !(parseFloat(style['border-radius'] ?? '0') > 0)
    && (['none', 'hidden'].includes(style['outline-style'] ?? 'none') || !(parseFloat(style['outline-width'] ?? '0') > 0))
}

function backgroundOf(object: HtmlAssemblyObject, bindings: Readonly<Record<string, string>>): ComponentBackground | undefined {
  const style = object.style
  // These page shells have no border. Border/padding boxes therefore share the
  // paint rectangle, while content-box/text need geometry or text owned by source.
  if (['background-origin', 'background-clip'].some(name => (style[name] ?? (name === 'background-origin' ? 'padding-box' : 'border-box'))
    .split(',').some(value => !['border-box', 'padding-box'].includes(value.trim())))) return undefined
  const color = clear(style['background-color']) ? undefined : style['background-color']
  const image = style['background-image']
  if (clear(image)) return color ? { mode: 'own', color, assetId: null } : undefined
  const match = /^url\(["']?(.+?)["']?\)$/.exec(image!.trim())
  const assetId = match && bindings[match[1]!]
  // The formal background consumes one admitted image with its real fit semantics.
  const size = style['background-size'] ?? 'auto'
  const position = style['background-position'] ?? '0% 0%'
  const repeat = style['background-repeat'] ?? 'repeat'
  if (assetId && ['cover', 'contain', '100% 100%'].includes(size)
    && ['50% 50%', 'center center', 'center'].includes(position) && repeat === 'no-repeat') {
    return { mode: 'own', ...(color ? { color } : {}), assetId, fit: size === '100% 100%' ? 'fill' : size as 'cover' | 'contain' }
  }
  const references = cssUrlReferences(image!)
  // The resource owner has already admitted actual bytes. Keep unresolved image
  // input repairable rather than promoting temporary/missing URLs to page paint.
  if (references.some(reference => !bindings[reference.reference]) || /(?:-webkit-)?image-set\s*\(/i.test(image!)) return undefined
  const names: ComponentBackgroundProperty[] = ['background-color', 'background-image', 'background-size', 'background-position',
    'background-repeat', 'background-origin', 'background-clip', 'background-attachment', 'background-blend-mode']
  const declarations = Object.fromEntries(names.flatMap(name => style[name] ? [[name, style[name]!]] : []))
  return { mode: 'own', paint: { layers: [{ style: declarations,
    resourceBindings: Object.fromEntries(references.map(reference => [reference.reference, bindings[reference.reference]!])) }] } }
}

function hasBackground(object: HtmlAssemblyObject): boolean {
  return !clear(object.style['background-color']) || !clear(object.style['background-image'])
}

function combineBackground(back: ComponentBackground | undefined, front: ComponentBackground): ComponentBackground | undefined {
  if (!back) return front
  if (back.paint || front.paint || back.assetId && (front.assetId || front.color && (documentColorChannels(front.color)?.alpha ?? 1) < 1)) {
    const layersOf = (background: ComponentBackground): ComponentBackgroundPaint['layers'] => {
      if (background.paint) return background.paint.layers
      const token = 'cw-resource:background-image'
      return [{ style: { ...(background.color ? { 'background-color': background.color } : {}),
        ...(background.assetId ? { 'background-image': `url("${token}")`, 'background-size': background.fit === 'fill' ? '100% 100%' : background.fit ?? 'cover',
          'background-position': 'center', 'background-repeat': 'no-repeat' } : {}) },
      resourceBindings: background.assetId ? { [token]: background.assetId } : {} }]
    }
    return { mode: 'own', paint: { layers: [...layersOf(back), ...layersOf(front)] } }
  }
  const top = front.color ? documentColorChannels(front.color) : undefined
  if (!top || top.alpha === 1 || !back?.color) return { ...back, ...front }
  const bottom = documentColorChannels(back.color)
  if (!bottom) return undefined
  const alpha = top.alpha + bottom.alpha * (1 - top.alpha)
  const channel = (a: number, b: number) => alpha ? Math.round((a * top.alpha + b * bottom.alpha * (1 - top.alpha)) / alpha * 1000) / 1000 : 0
  return { ...back, ...front, color: `rgba(${channel(top.red, bottom.red)}, ${channel(top.green, bottom.green)}, ${channel(top.blue, bottom.blue)}, ${alpha})` }
}

/** Drop only a measured page shell. Content remains owned by the real page, never by its paint. */
export function pageHtmlAssembly(assembly: HtmlAssembly, page: HtmlPageTarget,
  bindings: Readonly<Record<string, string>>, order: (object: HtmlAssemblyObject) => HtmlAssemblyObject[]): { roots: HtmlAssemblyObject[]; background?: ComponentBackground; diagnostics: ContentApplyDiagnostic[] } | undefined {
  if (!pageSized(assembly.root, page) || !ordinaryShell(assembly.root)) return undefined
  const diagnostics: ContentApplyDiagnostic[] = []
  let current = assembly.root, background: ComponentBackground | undefined
  let parentTransform = IDENTITY_MATRIX
  const retained = (object: HtmlAssemblyObject): HtmlAssemblyObject => ({ ...object, kind: 'web',
    frame: { ...object.frame, transform: multiplyMatrices(parentTransform, object.frame.transform) },
    retainedSource: { html: retainedMeasurementScopeHtml(assembly.source, object.sourcePath), reason: 'page-background-context' },
    content: undefined, style: {}, pseudoElements: {}, children: [], decorations: [], sourceRegions: [] })
  while (ordinaryShell(current) && pageSized(current, page)) {
    const paint = backgroundOf(current, bindings)
    if (hasBackground(current) && !paint) {
      diagnostics.push({ level: 'warning', code: 'html-page-background-source-retained',
        message: '此页面背景含当前背景属性无法等价承载的效果或未接纳图片；已保留原内容与布局，尚未转换成正式页面背景。',
        sourcePath: current.sourcePath, repairable: true })
      return { roots: [retained(current)],
        ...(background ? { background } : {}), diagnostics }
    }
    if (paint && page.adoptBackground) {
      const merged = combineBackground(background, paint)
      if (!merged) {
        diagnostics.push({ level: 'warning', code: 'html-page-background-source-retained', repairable: true,
          message: '多层背景图片或透明色叠图无法等价合入单一页面背景；已保留原内容与布局。', sourcePath: current.sourcePath })
        return { roots: [retained(current)],
          ...(background ? { background } : {}), diagnostics }
      }
      background = merged
    }
    if (paint && !page.adoptBackground) diagnostics.push({ level: 'info', code: 'html-page-background-preserved',
      message: '插入内容保留当前页面背景；输入的页面底色不再成为可拖动前景对象。', sourcePath: current.sourcePath })
    // A decoration with independent paint order still needs its actual container.
    if (current.sourceRegions.length) break
    if (!current.decorations.length && current.children.length === 1 && ordinaryShell(current.children[0]!) && pageSized(current.children[0]!, page)) {
      parentTransform = multiplyMatrices(parentTransform, current.frame.transform)
      current = current.children[0]!
      continue
    }
    diagnostics.push({ level: 'info', code: 'html-page-shell-adopted',
      message: '页面外壳已归页面背景与内容层，正文不挂在可拖动的背景对象下。', sourcePath: current.sourcePath })
    const decorations = current.decorations.map<HtmlAssemblyObject>(value => ({ kind: 'web', label: '装饰',
      sourcePath: value.sourcePath, frame: value.frame,
      style: value.content.kind === 'element' ? value.content.style : {},
      sourceStyle: value.content.kind === 'element' ? value.content.sourceStyle : undefined,
      content: value.content, pseudoElements: value.content.kind === 'element' ? value.content.pseudoElements : {},
      stacking: value.interleaves ? value.stacking : { zIndex: '-1', layoutOrder: '0' },
      children: [], decorations: [], sourceRegions: [] }))
    const children = order({ ...current, children: [...decorations, ...current.children], decorations: [] })
    const first = children[0]
    if (first && !first.children.length && !first.decorations.length && !first.sourceRegions.length && first.content?.kind === 'element'
      && !first.content.children.some(value => value.kind === 'text' && value.text.trim() || value.kind === 'element')
      && ordinaryShell({ ...first, kind: 'group' }) && pageSized(first, page)) {
      const paint = backgroundOf(first, bindings)
      const merged = paint && combineBackground(background, paint)
      if (paint && (!page.adoptBackground || merged)) {
        if (page.adoptBackground) background = merged
        children.shift()
      }
    }
    return { roots: children.map(child => ({ ...child,
      frame: { ...child.frame, transform: multiplyMatrices(multiplyMatrices(parentTransform, current.frame.transform), child.frame.transform) } })),
      ...(background ? { background } : {}), diagnostics }
  }
  // An inner effect/source scope remains a real content group; earlier empty shells can still disappear.
  if (current === assembly.root) return undefined
  return { roots: [{ ...current, frame: { ...current.frame, transform: multiplyMatrices(parentTransform, current.frame.transform) } }], ...(background ? { background } : {}), diagnostics }
}
