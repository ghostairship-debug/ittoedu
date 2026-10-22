import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { scanHtmlSource } from '../../../shared/html/htmlSourceScanner'
import { htmlResourceSources } from '../htmlImport/extractHtmlResources'
import { analyzeHtmlResources } from '../htmlImport/htmlResourceAnalysis'
import type { HtmlResourceSource } from '../htmlImport/types'
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

const resourceDigest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
type ResourceCollection = { sources: HtmlResourceSource[]; dependencies: ReadonlyMap<string, string> }

/** Follow the existing realpath-closed local CSS reads; never fetch remote stylesheets to guess their dependencies. */
async function collectResourceSources(source: string, rootRealPath: string): Promise<ResourceCollection> {
  const files = new Map<string, Uint8Array>()
  const dependencies = new Map<string, string>()
  let result = await analyzeHtmlResources({ html: source, siblingFiles: files })
  for (;;) {
    let added = false
    for (const diagnostic of result.diagnostics) {
      if (diagnostic.code !== 'missing-relative-resource' || !diagnostic.reference || !/\.css$/i.test(diagnostic.reference)) continue
      const key = diagnostic.reference
      if (files.has(key)) continue
      dependencies.set(key, 'missing')
      const target = await resolveHtmlPreviewResource(rootRealPath, key)
      if (!target) continue
      try {
        const bytes = new Uint8Array(await fs.readFile(target))
        files.set(key, bytes)
        dependencies.set(key, resourceDigest(bytes))
        added = true
      } catch { /* A disappearing stylesheet cannot grant network access. */ }
    }
    if (!added) break
    result = await analyzeHtmlResources({ html: source, siblingFiles: files })
  }
  return { sources: htmlResourceSources(result.remoteReferences), dependencies }
}

export async function collectHtmlPreviewResourceSources(source: string, rootRealPath: string): Promise<HtmlResourceSource[]> {
  return (await collectResourceSources(source, rootRealPath)).sources
}

/** One preview lease retains its source analysis while local stylesheets still follow disk changes. */
export function createHtmlPreviewResourceCollector(
  captured?: (source: string, rootRealPath: string) => Promise<ResourceCollection | undefined>,
): typeof collectHtmlPreviewResourceSources {
  let retained: { source: string; root: string; collection: ResourceCollection } | undefined
  let running: { source: string; root: string; promise: Promise<HtmlResourceSource[]> } | undefined
  return (source, root) => {
    if (running?.source === source && running.root === root) return running.promise
    const promise = Promise.resolve().then(async () => {
      const previous = retained?.source === source && retained.root === root ? retained.collection : undefined
      let unchanged = Boolean(previous)
      if (previous) for (const [relative, expected] of previous.dependencies) {
        const target = await resolveHtmlPreviewResource(root, relative)
        let actual = 'missing'
        try { if (target) actual = resourceDigest(await fs.readFile(target)) } catch { /* A removed stylesheet no longer grants its resources. */ }
        if (actual !== expected) { unchanged = false; break }
      }
      const collection = unchanged && previous ? previous : await captured?.(source, root) ?? await collectResourceSources(source, root)
      retained = { source, root, collection }
      return collection.sources.map(value => ({ ...value }))
    })
    running = { source, root, promise }
    void promise.finally(() => { if (running?.promise === promise) running = undefined }).catch(() => {})
    return promise
  }
}

/** Existing media-only callers keep the same grant scope. New consumers use the typed source declaration. */
export async function collectHtmlPreviewMediaUrls(source: string, rootRealPath: string): Promise<string[]> {
  return [...new Set((await collectHtmlPreviewResourceSources(source, rootRealPath))
    .filter(source => source.usage === 'image' || source.usage === 'media').map(source => source.url))]
}
