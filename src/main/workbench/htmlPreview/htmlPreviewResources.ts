import { promises as fs } from 'node:fs'
import path from 'node:path'
import { scanHtmlSource } from '../../../shared/html/htmlSourceScanner'
import { extractHtmlResources } from '../htmlImport/extractHtmlResources'
import { remoteHttpsOrigin } from '../htmlImport/remoteHtmlReferences'
import { isContainedPath } from './htmlPreviewProtocol'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.bmp': 'image/bmp', '.avif': 'image/avif',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg', '.mov': 'video/quicktime',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm',
}

export function htmlPreviewContentType(filename: string): string | null {
  return TYPES[path.extname(filename).toLowerCase()] ?? null
}

function mediaAuthorities(mediaUrls: readonly string[]): string[] {
  return [...new Set(mediaUrls.flatMap(value => {
    try {
      const url = new URL(value)
      const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1]
      return url.protocol === 'https:' && !url.username && !url.password && authority ? [authority] : []
    }
    catch { return [] }
  }))]
}

function normalizeFragment(value: string, authorities: readonly string[]): string {
  let normalized = value
  for (const authority of authorities) {
    const escaped = authority.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    normalized = normalized.replace(new RegExp(`(^|[^:])//(${escaped})(?=/|[?#]|$)`, 'gi'),
      (_full, prefix: string, host: string) => `${prefix}https://${host}`)
  }
  return normalized
}

/** The response is normalized; the canonical HTML/CSS bytes remain unchanged. */
export function normalizeHtmlPreviewMediaReferences(source: string, mediaUrls: readonly string[]): string {
  const authorities = mediaAuthorities(mediaUrls)
  if (!authorities.length || !source.includes('//')) return source
  const spans: Array<{ start: number; end: number }> = []
  for (const token of scanHtmlSource(source).tokens) {
    if (token.kind === 'start-tag') {
      for (const attribute of token.attributes ?? []) {
        if (attribute.valueSpan && ['src', 'srcset', 'poster', 'href', 'style'].includes(attribute.name)) spans.push(attribute.valueSpan)
      }
    } else if (token.kind === 'raw-text' && (token.rawKind === 'style' || token.rawKind === 'script')) spans.push(token.span)
  }
  let output = source
  for (const span of spans.reverse()) {
    const original = source.slice(span.start, span.end)
    const replacement = normalizeFragment(original, authorities)
    if (replacement !== original) output = output.slice(0, span.start) + replacement + output.slice(span.end)
  }
  return output
}

export function normalizeCssPreviewMediaReferences(source: string, mediaUrls: readonly string[]): string {
  return normalizeFragment(source, mediaAuthorities(mediaUrls))
}

/** The lexical check is followed by a fresh realpath on every resource read. */
export async function resolveHtmlPreviewResource(rootRealPath: string, relativePath: string): Promise<string | null> {
  const target = path.resolve(rootRealPath, ...relativePath.split('/'))
  if (!isContainedPath(rootRealPath, target)) return null
  try {
    const real = await fs.realpath(target)
    if (!isContainedPath(rootRealPath, real)) return null
    const stat = await fs.stat(real)
    return stat.isFile() ? real : null
  } catch { return null }
}

/** Reuse M17's passive sink classification, including CSS reached from local stylesheets. */
export async function collectHtmlPreviewMediaUrls(source: string, rootRealPath: string): Promise<string[]> {
  const files = new Map<string, Uint8Array>()
  let result = extractHtmlResources({ html: source, siblingFiles: files })
  for (;;) {
    let added = false
    for (const diagnostic of result.diagnostics) {
      if (diagnostic.code !== 'missing-relative-resource' || !diagnostic.reference || !/\.css$/i.test(diagnostic.reference)) continue
      const key = diagnostic.reference
      if (files.has(key)) continue
      const target = await resolveHtmlPreviewResource(rootRealPath, key)
      if (!target) continue
      try {
        files.set(key, new Uint8Array(await fs.readFile(target)))
        added = true
      } catch { /* A disappearing stylesheet cannot grant network access. */ }
    }
    if (!added) break
    result = extractHtmlResources({ html: source, siblingFiles: files })
  }
  return [...new Set(result.remoteReferences
    .filter(reference => reference.usage === 'image' || reference.usage === 'media')
    .filter(reference => remoteHttpsOrigin(reference) !== null)
    .map(reference => reference.url.startsWith('//') ? `https:${reference.url}` : reference.url))]
}
