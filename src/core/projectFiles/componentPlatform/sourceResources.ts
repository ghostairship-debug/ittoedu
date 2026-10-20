import type { ComponentAsset, ComponentInstance, CourseProjectV10 } from '../../../shared/contracts/component-platform'
import { assetReferencePath, cssUrlReferences } from '../../../shared/composition/projectReferences'
import { HTML_AUTHORING_DATA_ID } from '../../../shared/html/htmlAuthoringRecords'
import { scanHtmlSource } from '../../../shared/html/htmlSourceScanner'
import { mapSrcsetUrls } from '../../../shared/html/responsiveImage'

type ResourceResolver = (reference: string) => string | undefined

/** A source projection uses its own instance namespace, never another instance's aliases. */
function resourceResolver(assets: CourseProjectV10['assets'], instance: ComponentInstance): ResourceResolver {
  const data = instance.data
  const declared = data && typeof data === 'object' && !Array.isArray(data) ? data.resourceBindings : undefined
  const bindings = { ...(declared && typeof declared === 'object' && !Array.isArray(declared) ? declared : {}),
    ...instance.authoring?.resourceBindings }
  const paths = new Map(Object.values(assets).map(asset => [asset.path, asset]))
  return reference => {
    let asset: ComponentAsset | undefined
    if (Object.hasOwn(bindings, reference)) {
      const id = bindings[reference]
      asset = typeof id === 'string' ? assets[id] : undefined
    } else if (reference.startsWith('cw-resource:')) asset = assets[reference.slice('cw-resource:'.length)]
    else if (!/[?#]/.test(reference)) {
      const path = assetReferencePath(reference)
      asset = path ? paths.get(path) : undefined
    }
    return asset ? `cw-resource:${asset.id}` : undefined
  }
}

function projectCss(css: string, resolve: ResourceResolver): string {
  let result = css
  for (const reference of cssUrlReferences(css).reverse()) {
    const value = resolve(reference.reference)
    if (value !== undefined && value !== reference.reference)
      result = result.slice(0, reference.start) + `url(${JSON.stringify(value)})` + result.slice(reference.end)
  }
  return result
}

/** Only the existing software-owned image record values follow the same resource projection. */
function projectRecords(source: string, resolve: ResourceResolver): string {
  try {
    const value = JSON.parse(source)
    if (value?.version !== 1 || !value.records || typeof value.records !== 'object' || Array.isArray(value.records)) return source
    let changed = false
    for (const record of Object.values(value.records) as Array<{ kind?: string; binding?: { baseline?: unknown }; overrides?: { src?: unknown } }>) {
      if (record?.kind !== 'image') continue
      for (const [owner, key] of [[record.binding, 'baseline'], [record.overrides, 'src']] as const) {
        const previous = owner?.[key as keyof typeof owner]
        if (typeof previous !== 'string') continue
        const next = resolve(previous)
        if (next !== undefined && next !== previous) { (owner as Record<string, unknown>)[key] = next; changed = true }
      }
    }
    return changed ? JSON.stringify(value).replace(/</g, '\\u003c') : source
  } catch { return source }
}

/** Normalize known static resource positions without reserializing the author's HTML or scripts. */
export function projectHtmlSourceResources(html: string, project: CourseProjectV10, instance: ComponentInstance): string {
  const resolve = resourceResolver(project.assets, instance)
  const edits: Array<{ start: number; end: number; value: string }> = []
  let raw: 'style' | 'records' | undefined
  for (const token of scanHtmlSource(html).tokens) {
    if (token.kind === 'start-tag') {
      raw = token.name === 'style' ? 'style' : token.name === 'script'
        && token.attributes?.some(attribute => attribute.name === 'id' && attribute.decodedValue === HTML_AUTHORING_DATA_ID) ? 'records' : undefined
      for (const attribute of token.attributes ?? []) {
        if (!attribute.valueSpan || attribute.decodedValue === undefined) continue
        const prior = attribute.decodedValue
        const svgHref = ['image', 'feimage', 'use'].includes(token.name ?? '') && ['href', 'xlink:href'].includes(attribute.name)
        const next = attribute.name === 'style' ? projectCss(prior, resolve)
          : attribute.name === 'srcset' ? mapSrcsetUrls(prior, resolve)
            : ['src', 'poster'].includes(attribute.name) || svgHref ? resolve(prior) ?? prior : prior
        if (next === prior) continue
        const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        edits.push({ ...attribute.valueSpan, value: attribute.quote ? escape(next) : `"${escape(next)}"` })
      }
    } else if (token.kind === 'raw-text' && raw) {
      const source = html.slice(token.span.start, token.span.end)
      const value = raw === 'style' ? projectCss(source, resolve) : projectRecords(source, resolve)
      if (value !== source) edits.push({ ...token.span, value })
    } else if (token.kind === 'end-tag') raw = undefined
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) html = html.slice(0, edit.start) + edit.value + html.slice(edit.end)
  return html
}

export function projectCssSourceResources(css: string, project: CourseProjectV10, instance: ComponentInstance): string {
  return projectCss(css, resourceResolver(project.assets, instance))
}
