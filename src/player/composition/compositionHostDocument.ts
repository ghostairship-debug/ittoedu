import { assetReferencePath, resolveCssAssetReferences } from '../../shared/composition/projectReferences'
import {
  STATE_HIDDEN_ATTRIBUTE,
  STATE_NODE_ATTRIBUTE,
  STEP_HIDDEN_ATTRIBUTE,
  STEP_NODE_ATTRIBUTE,
} from '../../shared/composition/stateNodes'

/** Marks host-owned nodes of a rendered composition document; content reconciliation keeps them. */
export const HOST_NODE_ATTRIBUTE = 'data-guoling-host'
export const PENDING_ATTRIBUTE = 'data-guoling-pending'

const URL_ATTRIBUTES = new Set(['src', 'href', 'poster', 'xlink:href', 'data'])

/**
 * Host style of a rendered composition: the course theme, then node states.
 * Playback hides both in-page steps and explicit node states with a fade;
 * a static capture shows every step and hides explicit node states; the
 * editing view shows everything.
 */
export function compositionHostStyleText(theme: string | undefined, mode: 'authoring' | 'playback' | 'capture'): string {
  const step = `[${STEP_NODE_ATTRIBUTE}],[${STATE_NODE_ATTRIBUTE}]`
  const hidden = `[${STEP_HIDDEN_ATTRIBUTE}],[${STATE_HIDDEN_ATTRIBUTE}]`
  const states = mode === 'playback'
    ? `${step}{transition:opacity .4s ease,visibility 0s linear 0s}`
      + `${hidden}{opacity:0!important;visibility:hidden!important;pointer-events:none!important;transition:opacity .4s ease,visibility 0s linear .4s}`
      + `@media (prefers-reduced-motion:reduce){${step},${hidden}{transition:none!important}}`
    : mode === 'capture' ? `[${STATE_HIDDEN_ATTRIBUTE}]{visibility:hidden!important}` : ''
  return `${theme ?? ''}\n${states}\nimg[${PENDING_ATTRIBUTE}]{object-fit:contain}`
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, char => `&#${char.charCodeAt(0)};`)
}

function clip(value: string, max: number): string {
  const characters = [...value.trim()]
  return characters.length <= max ? characters.join('') : `${characters.slice(0, max - 1).join('')}…`
}

/** Image shown in place of an asset slot that nothing fills yet. */
export function pendingImageUrl(description: string | undefined): string {
  const label = escapeXml(clip(description || '待填图片', 28))
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">'
    + '<rect x="2" y="2" width="316" height="176" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-width="2" stroke-dasharray="8 6"/>'
    + '<text x="160" y="80" text-anchor="middle" font-family="system-ui,Microsoft YaHei,sans-serif" font-size="13" fill="#94a3b8">待填图片</text>'
    + `<text x="160" y="106" text-anchor="middle" font-family="system-ui,Microsoft YaHei,sans-serif" font-size="15" fill="#475569">${label}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** Document shown in a component frame that no component fills yet, or whose component is a draft. */
export function placeholderDocument(title: string, detail: string): string {
  return '<!doctype html><html><head><style>html,body{margin:0;height:100%}'
    + 'body{box-sizing:border-box;display:flex;align-items:center;justify-content:center;padding:12px;text-align:center;'
    + 'font:14px/1.5 system-ui,"Microsoft YaHei",sans-serif;color:#475569;background:#f8fafc;border:2px dashed #94a3b8;border-radius:10px}'
    + 'small{display:block;color:#94a3b8;font-size:12px}</style></head>'
    + `<body><div><small>${escapeXml(title)}</small>${escapeXml(clip(detail, 120))}</div></body></html>`
}

/** Same placeholder as an element, for leaves that render inside an existing document. */
export function placeholderElement(document: Document, title: string, detail: string): HTMLElement {
  const box = document.createElement('div')
  box.setAttribute(PENDING_ATTRIBUTE, 'component')
  box.style.cssText = 'box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:100%;height:100%;padding:12px;'
    + 'text-align:center;font:14px/1.5 system-ui,"Microsoft YaHei",sans-serif;color:#475569;background:#f8fafc;border:2px dashed #94a3b8;border-radius:10px;'
  const label = document.createElement('div')
  const small = document.createElement('small')
  small.style.cssText = 'display:block;color:#94a3b8;font-size:12px;'
  small.textContent = title
  label.append(small, clip(detail, 160))
  box.append(label)
  return box
}

/** Resolves bound asset slots and software resource keys in one attribute value. */
export function resolveCompositionAttribute(
  name: string,
  value: string,
  assets: Readonly<Record<string, { assetId: string }>>,
  resolveAsset: (assetId: string) => string | undefined,
): string {
  const lower = name.toLowerCase()
  const slot = (reference: string) => {
    const path = assetReferencePath(reference)
    const assetId = path ? assets[path]?.assetId : undefined
    return assetId ? resolveAsset(assetId) : undefined
  }
  if (URL_ATTRIBUTES.has(lower)) return slot(value) ?? value
  if (lower === 'srcset') return value.split(',').map(candidate => {
    const [reference = '', ...rest] = candidate.trim().split(/\s+/)
    const url = slot(reference)
    return url ? [url, ...rest].join(' ') : candidate.trim()
  }).join(', ')
  if (lower === 'style') return resolveCssAssetReferences(value, assets, resolveAsset)
  return value
}

/** Puts the course theme first in an HTML document, below its own styles in the cascade. */
export function themedHtmlDocument(html: string, theme: string): string {
  if (!theme.trim()) return html
  const style = `<style ${HOST_NODE_ATTRIBUTE}>${theme.replace(/<\/style/gi, '<\\/style')}</style>`
  const head = /<head(?:\s[^>]*)?>/i.exec(html)
  if (head) return `${html.slice(0, head.index + head[0].length)}${style}${html.slice(head.index + head[0].length)}`
  const root = /<html(?:\s[^>]*)?>/i.exec(html)
  if (root) return `${html.slice(0, root.index + root[0].length)}<head>${style}</head>${html.slice(root.index + root[0].length)}`
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  return doctype ? `${doctype[0]}${style}${html.slice(doctype[0].length)}` : `${style}${html}`
}

/** HTML-document Runtimes created under `root` render with the course theme as well. */
export function themeHtmlDocumentRuntimes(root: Element, theme: string): void {
  if (!theme.trim()) return
  for (const frame of root.querySelectorAll<HTMLIFrameElement>('iframe[data-html-document-runtime="true"]')) {
    if (frame.hasAttribute(HOST_NODE_ATTRIBUTE)) continue
    frame.setAttribute(HOST_NODE_ATTRIBUTE, 'themed')
    frame.srcdoc = themedHtmlDocument(frame.srcdoc, theme)
  }
}

/** Design-token variables on a host element, for content rendered in the host document (controller, components). */
export function applyThemeVariables(element: HTMLElement, variables: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(variables)) element.style.setProperty(name, value)
}
