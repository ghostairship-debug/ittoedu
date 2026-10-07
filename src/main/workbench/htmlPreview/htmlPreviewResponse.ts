import type { HtmlResourceSource } from '../htmlImport/types'

// Unprivileged, per-lease origin only. The main editor's CSP is unchanged.
const BASE_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
  `style-src 'self' 'unsafe-inline'`,
  `font-src 'self' data:`,
  `connect-src 'self'`,
  "frame-src 'self' blob:",
  "child-src 'self' blob:",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "sandbox allow-scripts allow-same-origin",
]

export function htmlPreviewContentSecurityPolicy(mediaOrigins: readonly string[], connectOrigins: readonly string[] = [], resourceSources: readonly HtmlResourceSource[] = []): string {
  const allowed = [...new Set(mediaOrigins)].filter(value => {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && url.origin === value && !url.username && !url.password
    } catch { return false }
  }).sort()
  const connections = [...new Set(connectOrigins)].filter(value => {
    try {
      const url = new URL(value)
      return ['https:', 'wss:'].includes(url.protocol) && url.origin === value && !url.username && !url.password
    } catch { return false }
  }).sort()
  const origins = (usage: HtmlResourceSource['usage']) => [...new Set(resourceSources.flatMap(source => {
    if (source.usage !== usage) return []
    try {
      const url = new URL(source.url)
      return url.protocol === 'https:' && !url.username && !url.password ? [url.origin] : []
    } catch { return [] }
  }))].sort()
  const sources = (base: string, remote: readonly string[]) => `${base}${remote.length ? ` ${[...new Set(remote)].sort().join(' ')}` : ''}`
  return [
    ...BASE_CSP.slice(0, 2),
    sources("style-src 'self' 'unsafe-inline'", origins('stylesheet')),
    sources("img-src 'self' data: blob:", [...allowed, ...origins('image')]),
    sources("media-src 'self' data: blob:", [...allowed, ...origins('media')]),
    ...BASE_CSP.slice(3).map(directive => directive === "font-src 'self' data:"
      ? sources(directive, origins('font')) : directive === "connect-src 'self'"
      ? `${directive}${connections.length ? ` ${connections.join(' ')}` : ''}` : directive),
  ].join('; ')
}

export function htmlPreviewResponse(
  body: Uint8Array | string | null,
  input: { status?: number; contentType?: string; mediaOrigins?: readonly string[]; connectOrigins?: readonly string[]; resourceSources?: readonly HtmlResourceSource[]; method?: string } = {},
): Response {
  const headers = new Headers({
    'Content-Security-Policy': htmlPreviewContentSecurityPolicy(input.mediaOrigins ?? [], input.connectOrigins, input.resourceSources),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Cross-Origin-Resource-Policy': 'same-origin',
  })
  if (input.contentType) headers.set('Content-Type', input.contentType)
  if (input.method === 'HEAD') body = null
  const responseBody = body instanceof Uint8Array ? Uint8Array.from(body).buffer : body
  return new Response(responseBody, { status: input.status ?? 200, headers })
}
