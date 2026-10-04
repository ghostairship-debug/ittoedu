import { connect as netConnect, isIP, type Socket } from 'node:net'

/** Where one outbound connection goes: directly, or through an HTTP CONNECT or SOCKS5 proxy. */
export type ProxyRoute = { kind: 'direct' } | { kind: 'http' | 'socks5'; host: string; port: number }
export type ProxyRouteResolver = (url: string) => Promise<ProxyRoute>

export class ProxyError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ProxyError' }
}

/**
 * A Chromium proxy list as returned by `session.resolveProxy` ("PROXY h:p; SOCKS5 h:p; DIRECT"):
 * the first entry this layer can use. PROXY/HTTP use CONNECT tunnels, SOCKS/SOCKS5 use SOCKS5 without authentication.
 */
export function parseProxyList(value: string): ProxyRoute {
  const unsupported: string[] = []
  for (const entry of value.split(';').map(item => item.trim()).filter(Boolean)) {
    const [scheme = '', server = ''] = entry.split(/\s+/, 2)
    const kind = scheme.toUpperCase()
    if (kind === 'DIRECT') return { kind: 'direct' }
    const endpoint = /^\[([0-9a-f:.]+)\]:(\d{1,5})$/i.exec(server) ?? /^([^\s:[\]]+):(\d{1,5})$/.exec(server)
    const port = Number(endpoint?.[2])
    if (endpoint && port >= 1 && port <= 65_535) {
      if (kind === 'PROXY' || kind === 'HTTP') return { kind: 'http', host: endpoint[1]!, port }
      if (kind === 'SOCKS' || kind === 'SOCKS5') return { kind: 'socks5', host: endpoint[1]!, port }
    }
    unsupported.push(entry)
  }
  if (!unsupported.length) return { kind: 'direct' }
  throw new ProxyError('proxy-unsupported', `系统代理设置“${unsupported.join('; ')}”的类型暂不支持；请在系统中使用 HTTP 或 SOCKS5 代理`)
}

let systemResolver: ProxyRouteResolver = async () => ({ kind: 'direct' })

/** Main installs the Electron session resolver once after the app is ready; before that, and in tests, connections are direct. */
export function setSystemProxyResolver(resolver: ProxyRouteResolver): void { systemResolver = resolver }

/** The system proxy (or PAC) decision for one URL. */
export const systemProxyRoute: ProxyRouteResolver = url => systemResolver(url)

const hostPort = (host: string, port: number) => `${isIP(host) === 6 ? `[${host}]` : host}:${port}`

function socksAddress(host: string): Buffer {
  const family = isIP(host)
  if (family === 4) return Buffer.from([1, ...host.split('.').map(Number)])
  if (family === 6) {
    const groups = host.split('::')
    const head = groups[0] ? groups[0].split(':') : [], tail = groups.length > 1 && groups[1] ? groups[1].split(':') : []
    const words = [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail]
    return Buffer.from([4, ...words.flatMap(word => { const value = Number.parseInt(word, 16); return [value >> 8, value & 255] })])
  }
  const name = Buffer.from(host, 'utf8')
  if (name.length > 255) throw new ProxyError('proxy-failed', '目标域名过长，SOCKS5 代理无法连接')
  return Buffer.concat([Buffer.from([3, name.length]), name])
}

/**
 * A TCP stream to `target` through the proxy. The proxy connects to the host name (it resolves it);
 * callers check the target against their own rules before asking. Nothing is read past the handshake.
 */
export function openProxyTunnel(route: Exclude<ProxyRoute, { kind: 'direct' }>, target: { host: string; port: number },
  options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Socket> {
  const host = target.host.replace(/^\[|\]$/g, '')
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(options.signal.reason instanceof Error ? options.signal.reason : new ProxyError('cancelled', '连接已取消')); return }
    const socket = netConnect({ host: route.host, port: route.port })
    let buffered = Buffer.alloc(0), stage: 'greeting' | 'reply' = 'greeting', settled = false
    const timer = options.timeoutMs ? setTimeout(() => fail(new ProxyError('proxy-timeout', `系统代理 ${hostPort(route.host, route.port)} 连接超时`)), options.timeoutMs) : undefined
    const cleanup = () => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      socket.off('readable', onReadable); socket.off('error', onError); socket.off('close', onClose)
    }
    function fail(error: Error) {
      if (settled) return
      settled = true; cleanup(); socket.destroy(); reject(error)
    }
    const succeed = () => {
      if (settled) return
      if (buffered.length) { fail(new ProxyError('proxy-failed', '系统代理在握手后发送了多余数据')); return }
      settled = true; cleanup(); resolve(socket)
    }
    const onAbort = () => fail(options.signal!.reason instanceof Error ? options.signal!.reason : new ProxyError('cancelled', '连接已取消'))
    const onError = (error: Error) => fail(new ProxyError('proxy-failed', `无法连接系统代理 ${hostPort(route.host, route.port)}：${error.message}`))
    const onClose = () => fail(new ProxyError('proxy-failed', `系统代理 ${hostPort(route.host, route.port)} 在建立连接前关闭了连接`))
    const take = (length: number) => { const head = buffered.subarray(0, length); buffered = buffered.subarray(length); return head }
    function onReadable() {
      for (let chunk: Buffer | null; (chunk = socket.read() as Buffer | null) !== null;) buffered = Buffer.concat([buffered, chunk])
      if (route.kind === 'http') {
        const end = buffered.indexOf('\r\n\r\n')
        if (end < 0) { if (buffered.length > 16_384) fail(new ProxyError('proxy-failed', '系统代理返回的响应头过长')); return }
        const status = /^HTTP\/1\.[01] (\d{3})/.exec(take(end + 4).toString('latin1'))?.[1]
        if (status !== '200') { fail(new ProxyError('proxy-refused', `系统代理拒绝连接 ${hostPort(host, target.port)}（${status ? `HTTP ${status}` : '响应无效'}）`)); return }
        succeed(); return
      }
      if (stage === 'greeting') {
        if (buffered.length < 2) return
        const [version, method] = take(2)
        if (version !== 5 || method !== 0) { fail(new ProxyError('proxy-unsupported', '系统 SOCKS5 代理要求认证，暂不支持')); return }
        stage = 'reply'
        socket.write(Buffer.concat([Buffer.from([5, 1, 0]), socksAddress(host), Buffer.from([target.port >> 8, target.port & 255])]))
      }
      if (buffered.length < 5) return
      const addressLength = buffered[3] === 1 ? 4 : buffered[3] === 4 ? 16 : buffered[3] === 3 ? 1 + buffered[4]! : -1
      if (buffered[0] !== 5 || addressLength < 0) { fail(new ProxyError('proxy-failed', '系统 SOCKS5 代理的响应无效')); return }
      if (buffered.length < 4 + addressLength + 2) return
      const reply = take(4 + addressLength + 2)
      if (reply[1] !== 0) { fail(new ProxyError('proxy-refused', `系统 SOCKS5 代理拒绝连接 ${hostPort(host, target.port)}（错误 ${reply[1]}）`)); return }
      succeed()
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    socket.on('error', onError)
    socket.on('close', onClose)
    socket.once('connect', () => {
      socket.on('readable', onReadable)
      socket.write(route.kind === 'http'
        ? `CONNECT ${hostPort(host, target.port)} HTTP/1.1\r\nHost: ${hostPort(host, target.port)}\r\n\r\n`
        : Buffer.from([5, 1, 0]))
    })
  })
}
