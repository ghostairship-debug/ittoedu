import { HTML_PREVIEW_ORIGIN } from './htmlPreviewProtocol'

const BASE_CSP = [
  "default-src 'none'",
  `script-src ${HTML_PREVIEW_ORIGIN} 'unsafe-inline'`,
  `style-src ${HTML_PREVIEW_ORIGIN} 'unsafe-inline'`,
  `font-src ${HTML_PREVIEW_ORIGIN} data:`,
  `connect-src ${HTML_PREVIEW_ORIGIN}`,
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
]

export function htmlPreviewContentSecurityPolicy(mediaOrigins: readonly string[]): string {
  const allowed = [...new Set(mediaOrigins)].filter(value => {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && url.origin === value && !url.username && !url.password
    } catch { return false }
  }).sort()
  const media = `${HTML_PREVIEW_ORIGIN} data: blob:${allowed.length ? ` ${allowed.join(' ')}` : ''}`
  return [
    ...BASE_CSP.slice(0, 3),
    `img-src ${media}`,
    `media-src ${media}`,
    ...BASE_CSP.slice(3),
  ].join('; ')
}

export function htmlPreviewResponse(
  body: Uint8Array | string | null,
  input: { status?: number; contentType?: string; mediaOrigins?: readonly string[]; method?: string } = {},
): Response {
  const headers = new Headers({
    'Content-Security-Policy': htmlPreviewContentSecurityPolicy(input.mediaOrigins ?? []),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  })
  if (input.contentType) headers.set('Content-Type', input.contentType)
  if (input.method === 'HEAD') body = null
  const responseBody = body instanceof Uint8Array ? Uint8Array.from(body).buffer : body
  return new Response(responseBody, { status: input.status ?? 200, headers })
}
