import { lookup } from 'node:dns/promises'
import { createServer, request as httpRequest, type ClientRequest, type IncomingMessage, type RequestOptions, type ServerResponse } from 'node:http'
import { connect as netConnect, isIP, type Socket } from 'node:net'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { resolvePublicDnsOverHttps } from './publicDnsOverHttps'
import { isPublicAddress, parsePublicUrl, resolveWithSyntheticFallback } from './publicHttp'
import { openProxyTunnel, systemProxyRoute, type ProxyRouteResolver } from './systemProxy'

type Address = { address: string; family: 4 | 6 }
type DialOptions = { host: string; family: 4 | 6; port: number; timeout: number }
export interface PublicBrowserProxyOptions {
  testLoopbackOrigin?: string
  /** Test seam: the production resolver still checks every system DNS answer. */
  resolve?: (hostname: string) => Promise<readonly Address[]>
  /** Test seam: production connects only to the numeric IP returned by resolve. */
  connect?: (options: DialOptions) => Socket
  /** Test seam: production follows the system proxy after the same public checks. */
  proxy?: ProxyRouteResolver
}
const HOP_HEADERS = new Set(['connection', 'proxy-connection', 'proxy-authorization', 'keep-alive',
  'transfer-encoding', 'te', 'trailer', 'upgrade'])

/** A run-owned, DNS-pinned egress for every Edge page request, redirect and subresource. */
export class PublicBrowserProxy {
  private readonly server = createServer((request, response) => { void this.forward(request, response) })
  private readonly sockets = new Set<Socket>()
  private readonly requests = new Set<ClientRequest>()
  private stopped = false
  private listening = false
  private deniedRequests = 0
  private allowedRequests = 0
  private readonly testLoopbackOrigin?: string
  private readonly resolve: (hostname: string) => Promise<readonly Address[]>
  private readonly connect: (options: DialOptions) => Socket
  private readonly proxy: ProxyRouteResolver

  constructor(options: PublicBrowserProxyOptions = {}) {
    this.testLoopbackOrigin = options.testLoopbackOrigin
    this.resolve = options.resolve ?? (hostname => resolveWithSyntheticFallback(hostname,
      async () => (await lookup(hostname, { all: true })).map(value => ({ address: value.address, family: value.family as 4 | 6 })),
      () => resolvePublicDnsOverHttps(hostname, AbortSignal.timeout(10_000))))
    this.connect = options.connect ?? netConnect
    this.proxy = options.proxy ?? systemProxyRoute
    this.server.on('connect', (request, socket, head) => { void this.tunnel(request, socket, head) })
    this.server.on('upgrade', (_request, socket) => {
      this.deniedRequests++
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
    })
    this.server.on('clientError', (_error, socket) => socket.destroy())
    this.server.on('connection', socket => this.track(socket))
  }

  private track(socket: Socket): void {
    this.sockets.add(socket)
    socket.once('close', () => this.sockets.delete(socket))
  }

  async start(): Promise<string> {
    if (this.listening || this.stopped) throw new Error('浏览器代理已启动或停止')
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(0, '127.0.0.1', () => { this.server.off('error', reject); resolve() })
    })
    this.listening = true
    if (this.stopped) {
      await new Promise<void>(resolve => this.server.close(() => resolve()))
      throw new Error('浏览器代理已停止')
    }
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
  }

  stats(): { deniedRequests: number; allowedRequests: number } {
    return { deniedRequests: this.deniedRequests, allowedRequests: this.allowedRequests }
  }

  private target(raw: string): URL {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password)
      throw new Error('浏览器代理只允许无内嵌凭据的 HTTP(S) 目标')
    if (this.testLoopbackOrigin && url.origin === this.testLoopbackOrigin) return url
    return parsePublicUrl(raw)
  }

  private async address(url: URL): Promise<Address> {
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    if (isIP(hostname)) {
      if (url.origin !== this.testLoopbackOrigin && !isPublicAddress(hostname)) throw new Error('私有地址禁止访问')
      return { address: hostname, family: isIP(hostname) as 4 | 6 }
    }
    const answers = await this.resolve(hostname)
    if (!answers.length || answers.some(value => value.family !== isIP(value.address) || !isPublicAddress(value.address)))
      throw new Error('域名解析到私有或保留地址')
    return answers[0]!
  }

  private async forward(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (this.stopped || !request.url || !/^https?:\/\//i.test(request.url)) {
      this.deniedRequests++
      response.writeHead(403).end(); return
    }
    try {
      const url = this.target(request.url)
      if (url.protocol !== 'http:') throw new Error('明文代理请求只允许 HTTP')
      const address = await this.address(url)
      if (this.stopped) throw new Error('浏览器代理已停止')
      this.allowedRequests++
      const headers = { ...request.headers }
      const listed = String(headers.connection ?? '').split(',').map(value => value.trim().toLowerCase())
      for (const name of [...HOP_HEADERS, ...listed]) delete headers[name]
      headers.host = url.host
      // Directly the socket is pinned to the checked address; through the system proxy the proxy reaches the checked host.
      const route = await this.proxy(url.href)
      let tunnel: Socket | undefined
      // A failing system proxy is a gateway error, not a policy denial.
      if (route.kind !== 'direct') try { tunnel = await openProxyTunnel(route, { host: url.hostname, port: Number(url.port) || 80 }, { timeoutMs: 15_000 }) }
      catch { if (!response.headersSent) response.writeHead(502); response.end(); return }
      if (tunnel) this.track(tunnel)
      if (this.stopped) { tunnel?.destroy(); throw new Error('浏览器代理已停止') }
      const options: RequestOptions = { method: request.method, headers, timeout: 15_000 }
      if (tunnel) Object.assign(options, { createConnection: () => tunnel, defaultPort: 80 })
      else Object.assign(options, { agent: false, lookup: ((_hostname, lookupOptions, callback) => lookupOptions.all
        ? callback(null, [{ address: address.address, family: address.family }])
        : callback(null, address.address, address.family)) satisfies NonNullable<RequestOptions['lookup']> })
      const outbound = httpRequest(url, options, upstream => {
        upstream.on('error', () => response.destroy())
        if (this.stopped) { upstream.destroy(); response.destroy(); return }
        const responseHeaders = { ...upstream.headers }
        const responseListed = String(responseHeaders.connection ?? '').split(',').map(value => value.trim().toLowerCase())
        for (const name of [...HOP_HEADERS, ...responseListed]) delete responseHeaders[name]
        response.writeHead(upstream.statusCode ?? 502, responseHeaders)
        upstream.pipe(response)
      })
      this.requests.add(outbound)
      outbound.once('close', () => this.requests.delete(outbound))
      outbound.once('socket', socket => { this.track(socket); if (this.stopped) socket.destroy() })
      outbound.on('timeout', () => outbound.destroy(new Error('浏览器请求超时')))
      outbound.on('error', () => {
        if (response.destroyed) return
        if (!response.headersSent) response.writeHead(502)
        response.end()
      })
      request.on('aborted', () => outbound.destroy())
      request.on('error', () => outbound.destroy())
      response.on('error', () => outbound.destroy())
      request.pipe(outbound)
    } catch {
      this.deniedRequests++
      if (!response.headersSent) response.writeHead(403)
      response.end()
    }
  }

  private async tunnel(request: IncomingMessage, client: Duplex, head: Buffer): Promise<void> {
    if (this.stopped || !request.url) { this.deniedRequests++; client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return }
    try {
      if (!/^(?:\[[0-9a-f:.]+\]|[a-z0-9._-]+):([1-9][0-9]{0,4})$/i.test(request.url))
        throw new Error('CONNECT 目标必须是显式 host:port')
      const url = this.target(`https://${request.url}/`), address = await this.address(url)
      if (this.stopped) throw new Error('浏览器代理已停止')
      this.allowedRequests++
      const port = Number(url.port || 443)
      if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('连接端口无效')
      const route = await this.proxy(url.href)
      let upstream: Socket
      if (route.kind === 'direct') upstream = this.connect({ host: address.address, family: address.family, port, timeout: 15_000 })
      else try { upstream = await openProxyTunnel(route, { host: url.hostname, port }, { timeoutMs: 15_000 }) }
      catch { client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); return }
      this.track(upstream)
      let connected = false
      const ready = () => {
        if (this.stopped || client.destroyed) { upstream.destroy(); return }
        connected = true
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length) upstream.write(head)
        client.pipe(upstream); upstream.pipe(client)
      }
      if (route.kind === 'direct') upstream.once('connect', ready)
      else ready()
      upstream.on('timeout', () => upstream.destroy())
      upstream.on('error', () => {
        if (!connected) client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n')
        else client.destroy()
      })
      client.on('error', () => upstream.destroy())
      client.once('close', () => upstream.destroy())
    } catch { this.deniedRequests++; client.end('HTTP/1.1 403 Forbidden\r\n\r\n') }
  }

  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    for (const request of this.requests) request.destroy()
    for (const socket of this.sockets) socket.destroy()
    if (this.listening) await new Promise<void>(resolve => this.server.close(() => resolve()))
  }
}
