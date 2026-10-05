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

export function htmlPreviewContentSecurityPolicy(mediaOrigins: readonly string[], connectOrigins: readonly string[] = []): string {
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
  const media = `'self' data: blob:${allowed.length ? ` ${allowed.join(' ')}` : ''}`
  return [
    ...BASE_CSP.slice(0, 3),
    `img-src ${media}`,
    `media-src ${media}`,
    ...BASE_CSP.slice(3).map(directive => directive === "connect-src 'self'"
      ? `${directive}${connections.length ? ` ${connections.join(' ')}` : ''}` : directive),
  ].join('; ')
}

export function htmlPreviewResponse(
  body: Uint8Array | string | null,
  input: { status?: number; contentType?: string; mediaOrigins?: readonly string[]; connectOrigins?: readonly string[]; method?: string } = {},
): Response {
  const headers = new Headers({
    'Content-Security-Policy': htmlPreviewContentSecurityPolicy(input.mediaOrigins ?? [], input.connectOrigins),
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
