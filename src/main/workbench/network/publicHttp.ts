import { lookup } from 'node:dns/promises'
import { request as httpRequest, type RequestOptions } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP, type Socket } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import { resolvePublicDnsOverHttps } from './publicDnsOverHttps'
import { openProxyTunnel, systemProxyRoute, type ProxyRoute, type ProxyRouteResolver } from './systemProxy'

export class PublicHttpError extends Error {
  constructor(readonly code: string, message: string, readonly status?: number) { super(message); this.name = 'PublicHttpError' }
}

export interface PublicHttpResponse {
  url: string
  status: number
  contentType: string
  charset?: string
  bytes: Uint8Array
}

export interface PublicHttpOptions {
  signal?: AbortSignal
  resolve?: (hostname: string) => Promise<readonly { address: string; family: 4 | 6 }[]>
  /** 只可覆盖这三项，其余请求头固定不变。 */
  headers?: { Accept?: string; 'User-Agent'?: string; 'Accept-Language'?: string }
  /** 响应正文超过此字节数时中止读取。 */
  maxBytes?: number
  /** Test seam: production follows the system proxy for every hop. */
  proxy?: ProxyRouteResolver
}

type RequestSettings = { headers: Record<string, string>; maxBytes?: number }

function requestSettings(options: PublicHttpOptions): RequestSettings {
  const headers: Record<string, string> = { Accept: 'text/html, text/plain, application/pdf;q=0.5', 'Accept-Encoding': 'identity',
    'User-Agent': 'GuolingResearch/2.0' }
  for (const name of ['Accept', 'User-Agent', 'Accept-Language'] as const) {
    const value = options.headers?.[name]
    if (typeof value === 'string' && value.trim() && !/[\r\n]/.test(value)) headers[name] = value
  }
  return { headers, ...(options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {}) }
}

function ipv4Number(address: string): number {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return -1
  return ((parts[0]! * 2 ** 24) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!) >>> 0
}

const blockedV4: readonly [number, number][] = [
  [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8],
  [0xa9fe0000, 16], [0xac100000, 12], [0xc0000000, 24], [0xc0000200, 24],
  [0xc0a80000, 16], [0xc6120000, 15], [0xc6336400, 24], [0xcb007100, 24],
  [0xe0000000, 4], [0xf0000000, 4],
]

/** 2001:2::/48 is the IPv6 benchmarking range; like 198.18.0.0/15 it is handed out by fake-IP proxies. */
const benchmarkV6 = new BlockList()
benchmarkV6.addSubnet('2001:2::', 48, 'ipv6')

/** This intentionally rejects special-use and documentation ranges too. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) {
    const value = ipv4Number(address)
    return value >= 0 && !blockedV4.some(([network, bits]) => {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
      return ((value & mask) >>> 0) === ((network & mask) >>> 0)
    })
  }
  if (family !== 6) return false
  // IPv4-mapped IPv6 must be evaluated by its embedded address.
  const mapped = address.match(/^(?:::ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/i)
  if (mapped) return isPublicAddress(mapped[1]!)
  const normalized = address.replace(/^\[|\]$/g, '').toLowerCase()
  // 6to4/Teredo can tunnel to an otherwise forbidden IPv4 destination.
  if (normalized.startsWith('2002:') || normalized.startsWith('2001:0:') || normalized.startsWith('2001:db8:')) return false
  if (benchmarkV6.check(normalized, 'ipv6')) return false
  const first = Number.parseInt(normalized.slice(0, 4), 16)
  return Number.isFinite(first) && first >= 0x2000 && first <= 0x3fff
}

export function parsePublicUrl(raw: string): URL {
  let url: URL
  const input = raw.trim(), authority = input.split(/[/?#]/, 1)[0]!
  // A dotted domain is an address. Relative files, credentials and explicit non-HTTP schemes stay unchanged.
  const bareDomain = /^[^\s.\/:?#@\\]+(?:\.[^\s.\/:?#@\\]+)+\.?(?::\d+)?$/u.test(authority)
  try { url = new URL(bareDomain ? `https://${input}` : input) }
  catch { throw new PublicHttpError('invalid-url', '网页地址无效；请提供 HTTP(S) 地址或裸公网域名，相对素材路径请使用 file.*。') }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password)
    throw new PublicHttpError('invalid-url', '只可读取无内嵌凭据的 HTTP 或 HTTPS 网页')
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.test'))
    throw new PublicHttpError('private-target', '网页地址指向本机或私有网络')
  if (isIP(host) && !isPublicAddress(host)) throw new PublicHttpError('private-target', '网页地址指向本机或私有网络')
  url.hash = ''
  return url
}

function isSyntheticProxyAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 6) return benchmarkV6.check(address, 'ipv6')
  const value = family === 4 ? ipv4Number(address) : -1
  return value >= 0 && ((value & 0xfffe0000) >>> 0) === 0xc6120000
}

/** Only an all-synthetic answer (198.18.0.0/15 or 2001:2::/48, either family) falls back; never an actual private or mixed one. */
export async function resolveWithSyntheticFallback(hostname: string,
  systemResolve: () => Promise<readonly { address: string; family: 4 | 6 }[]>,
  publicResolve: () => Promise<readonly { address: string; family: 4 | 6 }[]>): Promise<readonly { address: string; family: 4 | 6 }[]> {
  const answers = await systemResolve()
  return answers.length && answers.every(answer => isSyntheticProxyAddress(answer.address))
    ? publicResolve() : answers
}

async function publicAddress(url: URL, resolver: NonNullable<PublicHttpOptions['resolve']>, signal: AbortSignal): Promise<{ address: string; family: 4 | 6 }> {
  signal.throwIfAborted()
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(hostname)) return { address: hostname, family: isIP(hostname) as 4 | 6 }
  let answers: readonly { address: string; family: 4 | 6 }[]
  let onAbort!: () => void
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try { answers = await Promise.race([resolver(hostname), cancelled]) }
  catch {
    if (signal.aborted) throw signal.reason
    throw new PublicHttpError('dns-failed', '网页域名解析失败')
  } finally { signal.removeEventListener('abort', onAbort) }
  if (!answers.length || answers.some(answer => !isPublicAddress(answer.address)))
    throw new PublicHttpError('private-target', '网页域名解析到本机、私有或保留地址')
  return answers[0]!
}

/** Through a proxy the checked host is reached by name; directly, the socket is pinned to the checked address. */
async function proxiedConnection(url: URL, route: ProxyRoute, signal: AbortSignal): Promise<Socket | undefined> {
  if (route.kind === 'direct') return undefined
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const tunnel = await openProxyTunnel(route, { host, port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80) }, { signal })
  return url.protocol === 'https:' ? tlsConnect({ socket: tunnel, host, ...(isIP(host) ? {} : { servername: host }), ALPNProtocols: ['http/1.1'] }) : tunnel
}

function oneRequest(url: URL, address: { address: string; family: 4 | 6 }, connection: Socket | undefined, signal: AbortSignal, activity: () => void, settings: RequestSettings): Promise<{ status: number; location?: string; contentType: string; charset?: string; bytes: Uint8Array }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? httpsRequest : httpRequest
    const requestOptions: RequestOptions = { method: 'GET', signal, headers: settings.headers }
    // Without an agent the default port must be named, or Host would carry ":80"/":443".
    if (connection) Object.assign(requestOptions, { createConnection: () => connection, defaultPort: url.protocol === 'https:' ? 443 : 80 })
    else requestOptions.lookup = (_host, options, callback) => options.all
      ? callback(null, [{ address: address.address, family: address.family }])
      : callback(null, address.address, address.family)
    const req = client(url, requestOptions, response => {
      activity()
      const status = response.statusCode ?? 0
      const location = typeof response.headers.location === 'string' ? response.headers.location : undefined
      const contentTypeHeader = String(response.headers['content-type'] ?? 'application/octet-stream')
      const contentType = contentTypeHeader.split(';', 1)[0]!.trim().toLowerCase()
      const charset = contentTypeHeader.match(/(?:^|;)\s*charset\s*=\s*["']?([^;"'\s]+)/i)?.[1]
      if (status >= 300 && status < 400) { response.resume(); resolve({ status, location, contentType, bytes: new Uint8Array() }); return }
      const maxBytes = settings.maxBytes
      const tooLarge = () => {
        const error = new PublicHttpError('too-large', `网络资源超过 ${Math.max(1, Math.round((maxBytes ?? 0) / 1024 / 1024))} MB 上限，已停止下载`)
        reject(error)
        // Without an argument destroy emits no 'error' event, which may have no listener yet.
        response.destroy()
      }
      if (maxBytes !== undefined && Number(response.headers['content-length']) > maxBytes) { tooLarge(); return }
      const chunks: Buffer[] = []
      let received = 0
      response.on('data', (chunk: Buffer) => {
        activity()
        received += chunk.length
        if (maxBytes !== undefined && received > maxBytes) { tooLarge(); return }
        chunks.push(chunk)
      })
      response.on('error', reject)
      response.on('end', () => resolve({ status, contentType, ...(charset ? { charset } : {}), bytes: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    req.end()
  })
}

/** DNS answers are checked for every hop and pinned to the socket; with a system proxy the proxy connects to the checked host. */
export async function fetchPublicResource(raw: string, options: PublicHttpOptions = {}): Promise<PublicHttpResponse> {
  const controller = new AbortController()
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  // Diagnose a stalled network operation; progress keeps a request alive regardless of total duration.
  const activity = () => {
    if (controller.signal.aborted) return
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => controller.abort(new PublicHttpError('timeout', '网页读取连续 5 分钟没有网络活动，请检查连接后重试')), 5 * 60_000)
  }
  activity()
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  if (options.signal?.aborted) controller.abort()
  try {
    let url = parsePublicUrl(raw)
    const resolver = options.resolve ?? (async (host: string) => resolveWithSyntheticFallback(host,
      async () => (await lookup(host, { all: true })).map(({ address, family }) => ({ address, family: family as 4 | 6 })),
      () => resolvePublicDnsOverHttps(host, controller.signal)))
    const visited = new Set<string>()
    const settings = requestSettings(options)
    for (;;) {
      if (controller.signal.aborted) throw new PublicHttpError('cancelled', '网页读取已取消')
      if (visited.has(url.href)) throw new PublicHttpError('redirect-loop', '网页出现重复跳转循环')
      visited.add(url.href)
      const address = await publicAddress(url, resolver, controller.signal)
      activity()
      const connection = await proxiedConnection(url, await (options.proxy ?? systemProxyRoute)(url.href), controller.signal)
      activity()
      const response = await oneRequest(url, address, connection, controller.signal, activity, settings)
      if (response.status >= 300 && response.status < 400) {
        if (!response.location) throw new PublicHttpError('invalid-redirect', '网页跳转缺少目标地址')
        url = parsePublicUrl(new URL(response.location, url).href)
        continue
      }
      if (response.status < 200 || response.status >= 300) throw new PublicHttpError('http-error', `网页返回 HTTP ${response.status}`, response.status)
      return { url: url.href, status: response.status, contentType: response.contentType, ...(response.charset ? { charset: response.charset } : {}), bytes: response.bytes }
    }
  } catch (cause) {
    if (controller.signal.aborted) throw controller.signal.reason instanceof PublicHttpError
      ? controller.signal.reason : new PublicHttpError('cancelled', '网页读取已取消')
    throw cause
  } finally { clearTimeout(idleTimer); options.signal?.removeEventListener('abort', onAbort) }
}
