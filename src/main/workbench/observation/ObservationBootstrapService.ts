import { htmlPreviewResponse } from '../htmlPreview/htmlPreviewResponse'

/** One isolated renderer's existing component bootstrap leases, retired with that host. */
export class ObservationBootstrapService {
  readonly baseUrl: string
  private readonly basePath: string
  private readonly sources = new Map<string, string>()
  private closed = false

  constructor(private readonly options: { token: string; entryOrigin: string; connectOrigins(): readonly string[] }) {
    this.basePath = `/_observation/${options.token}/bootstrap/`
    this.baseUrl = `courseware-editor://app${this.basePath}`
  }

  async handle(url: URL, request: Request): Promise<Response | undefined> {
    if (url.protocol !== 'courseware-editor:' || url.hostname !== 'app' || !url.pathname.startsWith(this.basePath)) return undefined
    const headers = { 'Access-Control-Allow-Origin': this.options.entryOrigin,
      'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS', 'Vary': 'Origin' }
    const reply = (status: number, message?: string) => new Response(message ?? null, { status, headers })
    if (this.closed) return reply(410, 'Observation closed')
    if (url.search) return reply(400, 'Bootstrap content belongs in the request body')
    const method = request.method.toUpperCase()
    if (method === 'POST' || method === 'DELETE' || method === 'OPTIONS') {
      const origin = request.headers.get('Origin')
      if (origin && origin !== this.options.entryOrigin) return reply(403, 'Invalid observation origin')
      if (method === 'OPTIONS') return reply(204)
      if (method === 'DELETE') { this.sources.delete(url.pathname); return reply(204) }
      const html = await request.text()
      if (this.closed) return reply(410, 'Observation closed')
      this.sources.set(url.pathname, html)
      return reply(204)
    }
    if (method !== 'GET' && method !== 'HEAD') return reply(405, 'Method not allowed')
    const source = this.sources.get(url.pathname)
    return source === undefined ? reply(404, 'Missing bootstrap') : htmlPreviewResponse(source, {
      contentType: 'text/html; charset=utf-8', method, connectOrigins: [...this.options.connectOrigins()],
    })
  }

  clear(): void { this.sources.clear() }
  dispose(): void { this.closed = true; this.clear() }
}
