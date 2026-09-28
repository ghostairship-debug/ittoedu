import path from 'node:path'

export const HTML_PREVIEW_ORIGIN = 'courseware-preview://app'
export const HTML_PREVIEW_AGENT_PATH = 'html-preview-agent.iife.js'

export type HtmlPreviewProtocolTarget =
  | { kind: 'file'; token: string; relativePath: string; hasQuery: boolean }
  | { kind: 'agent'; token: string }

function decodeSegment(raw: string): string | null {
  let value: string
  try { value = decodeURIComponent(raw) } catch { return null }
  if (!value || value === '.' || value === '..' || /[\0\\/:?]/u.test(value) || /%[0-9a-f]{2}/iu.test(value)) return null
  if (value.includes('\uFFFD')) return null
  return value
}

/** Parse the raw URL path before using URL, which normalizes dot segments. */
export function parseHtmlPreviewProtocolUrl(rawUrl: string): HtmlPreviewProtocolTarget | null {
  const match = /^courseware-preview:\/\/app(\/[^?#]*)(\?[^#]*)?(?:#.*)?$/i.exec(rawUrl)
  if (!match) return null
  const parts = match[1].split('/').slice(1)
  const token = parts.shift()
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) return null
  const kind = parts.shift()
  if (kind === '_agent' && parts.length === 1 && parts[0] === HTML_PREVIEW_AGENT_PATH && !match[2]) return { kind: 'agent', token }
  if (kind !== 'file' || parts.length === 0) return null
  const decoded = parts.map(decodeSegment)
  if (decoded.some(part => part === null)) return null
  return { kind: 'file', token, relativePath: (decoded as string[]).join('/'), hasQuery: Boolean(match[2]) }
}

export function htmlPreviewFileUrl(token: string, relativePath: string): string {
  const segments = relativePath.split(/[\\/]/u)
  if (!segments.length || segments.some(segment => !segment || segment === '.' || segment === '..' || /[\0\\/:?]/u.test(segment) || /%[0-9a-f]{2}/iu.test(segment))) {
    throw new Error('Invalid HTML preview file path')
  }
  return `${HTML_PREVIEW_ORIGIN}/${token}/file/${segments.map(encodeURIComponent).join('/')}`
}

export function isContainedPath(root: string, target: string): boolean {
  const difference = path.relative(root, target)
  return difference === '' || (difference !== '..' && !difference.startsWith(`..${path.sep}`) && !path.isAbsolute(difference))
}
