import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { scanHtmlSource } from '../../../shared/html/htmlSourceScanner'
import { escapeHtmlAttribute } from '../../../shared/html/htmlSourceEscaping'
import { mapSrcsetUrls } from '../../../shared/html/responsiveImage'
import type { HtmlFrameSources } from '../../../shared/html/htmlFrameAuthoring'
import { captureHtmlClosure } from '../htmlImport/readHtmlClosure'
import { readSourceResource } from '../documentSourceResources'
import { isContainedPath } from './htmlPreviewProtocol'

/** A saved opaque srcdoc cannot fetch file: CSS or images. Carry only its
 * referenced passive files through the existing authorized resource closure. */
export async function prepareHtmlFramePassiveResources(sources: HtmlFrameSources, root: string): Promise<HtmlFrameSources> {
  if (!Object.keys(sources).length) return sources
  const pending = new Map<string, Promise<string | undefined>>()
  const portable = (key: string, css: boolean) => {
    const identity = `${css ? 'css' : 'media'}:${key}`
    let work = pending.get(identity)
    if (!work) {
      work = (async () => {
        const result = await captureHtmlClosure({
          html: css ? `<link rel="stylesheet" href="${escapeHtmlAttribute(key, '"')}">` : `<img src="${escapeHtmlAttribute(key, '"')}">`,
          readRelative: async reference => {
            try { const resource = await readSourceResource(root, reference); return resource.kind === 'file' ? resource.bytes : undefined }
            catch { return undefined }
          },
        })
        const data = new Map(result.resources.map(resource => [resource.key,
          `data:${resource.mediaType};base64,${Buffer.from(resource.bytes).toString('base64')}`]))
        if (!css) {
          const resource = result.resources.find(resource => resource.origins.some(origin => origin.kind === 'relative' && origin.reference === key))
          return resource && /^(image|audio|video|font)\//.test(resource.mediaType) ? data.get(resource.key) : undefined
        }
        const token = scanHtmlSource(result.html).tokens.find(token => token.kind === 'raw-text' && token.rawKind === 'style')
        if (!token) return undefined
        let text = result.html.slice(token.span.start, token.span.end)
        for (const [id, value] of data) text = text.split(`cw-resource:${id}`).join(value)
        return `data:text/css;base64,${Buffer.from(text).toString('base64')}`
      })()
      pending.set(identity, work)
    }
    return work
  }
  const prepared: HtmlFrameSources = {}
  for (const [name, source] of Object.entries(sources)) {
    const tokens = scanHtmlSource(source.html).tokens
    let base = pathToFileURL(path.resolve(root, source.base))
    const authoredBase = tokens.find(token => token.kind === 'start-tag' && token.name === 'base')
      ?.attributes?.find(attribute => attribute.name === 'href')?.decodedValue
    try { if (authoredBase) base = new URL(authoredBase, base) } catch { /* Keep the original unresolved reference. */ }
    const wanted = new Map<string, boolean>()
    const add = (value: string, css = false) => {
      try {
        const url = new URL(value, base)
        if (url.protocol !== 'file:') return
        const filename = fileURLToPath(url)
        if (!isContainedPath(root, filename)) return
        const key = path.relative(root, filename).split(path.sep).join('/')
        wanted.set(key, css)
      } catch { /* Unresolved content remains authored; it grants no extra access. */ }
    }
    for (const token of tokens) if (token.kind === 'start-tag') {
      const attrs = Object.fromEntries((token.attributes ?? []).map(attribute => [attribute.name, attribute.decodedValue ?? '']))
      if (token.name === 'link' && attrs.rel?.toLowerCase().split(/\s+/).includes('stylesheet') && attrs.href) add(attrs.href, true)
      if (['img', 'source', 'audio', 'video'].includes(token.name ?? '')) {
        if (attrs.src) add(attrs.src)
        if (attrs.poster) add(attrs.poster)
        if (attrs.srcset) mapSrcsetUrls(attrs.srcset, value => { add(value); return undefined })
      }
    }
    const resources = { ...source.resources }
    for (const [key, css] of wanted) {
      if (resources[key]) continue
      const data = await portable(key, css); if (data) resources[key] = data
    }
    prepared[name] = { ...source, ...(Object.keys(resources).length ? { resources } : {}) }
  }
  return prepared
}
