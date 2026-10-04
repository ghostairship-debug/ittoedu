// @vitest-environment node
import { createServer as createHttpServer, type Server } from 'node:http'
import { connect as netConnect, createServer as createNetServer, type AddressInfo, type Server as NetServer, type Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { fetchPublicResource } from '../../src/main/workbench/network/publicHttp'
import { openProxyTunnel, parseProxyList, type ProxyRoute } from '../../src/main/workbench/network/systemProxy'

const servers: (Server | NetServer)[] = []
const sockets = new Set<Socket>()
afterEach(async () => {
  for (const socket of sockets) socket.destroy()
  sockets.clear()
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
})
async function listen<T extends Server | NetServer>(server: T): Promise<T & { port: number }> {
  servers.push(server)
  server.on('connection', (socket: Socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return Object.assign(server, { port: (server.address() as AddressInfo).port })
}

/** The site every proxy below actually reaches, whatever host name it was asked for. */
async function site() {
  const seen: { host?: string; url?: string }[] = []
  const server = await listen(createHttpServer((request, response) => {
    seen.push({ host: request.headers.host, url: request.url })
    response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}')
  }))
  return { port: server.port, seen }
}
async function connectProxy(targetPort: number, refuse = false) {
  const requested: string[] = []
  const proxy = await listen(createHttpServer())
  proxy.on('connect', (request, client: Socket, head) => {
    requested.push(request.url ?? '')
    sockets.add(client)
    if (refuse) { client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return }
    const upstream = netConnect(targetPort, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      upstream.pipe(client); client.pipe(upstream)
    })
    sockets.add(upstream)
  })
  return { route: { kind: 'http', host: '127.0.0.1', port: proxy.port } as ProxyRoute, requested }
}
async function socksProxy(targetPort: number) {
  const requested: { type: number; host: string; port: number }[] = []
  const proxy = await listen(createNetServer(client => {
    let stage = 0, buffered = Buffer.alloc(0)
    client.on('data', chunk => {
      buffered = Buffer.concat([buffered, chunk])
      if (stage === 0 && buffered.length >= 3) { buffered = buffered.subarray(3); stage = 1; client.write(Buffer.from([5, 0])) }
      if (stage !== 1 || buffered.length < 5) return
      const type = buffered[3]!, length = type === 1 ? 4 : type === 4 ? 16 : 1 + buffered[4]!
      if (buffered.length < 4 + length + 2) return
      const address = buffered.subarray(4, 4 + length), port = buffered.readUInt16BE(4 + length)
      const host = type === 3 ? address.subarray(1).toString() : type === 1 ? [...address].join('.') : address.toString('hex')
      requested.push({ type, host, port })
      stage = 2
      client.removeAllListeners('data')
      const upstream = netConnect(targetPort, '127.0.0.1', () => {
        client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80]))
        upstream.pipe(client); client.pipe(upstream)
      })
      sockets.add(upstream)
    })
  }))
  return { route: { kind: 'socks5', host: '127.0.0.1', port: proxy.port } as ProxyRoute, requested }
}
const publicAnswer = async () => [{ address: '93.184.216.34', family: 4 as const }]

describe('system proxy for public HTTP', () => {
  it('reads Chromium proxy lists: the first usable entry wins, unsupported-only lists fail clearly', () => {
    expect(parseProxyList('DIRECT')).toEqual({ kind: 'direct' })
    expect(parseProxyList('')).toEqual({ kind: 'direct' })
    expect(parseProxyList('PROXY 127.0.0.1:7897')).toEqual({ kind: 'http', host: '127.0.0.1', port: 7897 })
    expect(parseProxyList('PROXY [::1]:8080; DIRECT')).toEqual({ kind: 'http', host: '::1', port: 8080 })
    expect(parseProxyList('SOCKS5 proxy.lan:1080')).toEqual({ kind: 'socks5', host: 'proxy.lan', port: 1080 })
    expect(parseProxyList('SOCKS 10.0.0.2:1080')).toEqual({ kind: 'socks5', host: '10.0.0.2', port: 1080 })
    expect(parseProxyList('HTTPS secure.proxy:443; PROXY 127.0.0.1:7897')).toEqual({ kind: 'http', host: '127.0.0.1', port: 7897 })
    expect(() => parseProxyList('HTTPS secure.proxy:443')).toThrow('暂不支持')
    expect(() => parseProxyList('PROXY nonsense')).toThrow('暂不支持')
  })

  it('tunnels each hop through an HTTP CONNECT proxy by host name after the public checks', async () => {
    const target = await site(), proxy = await connectProxy(target.port)
    const response = await fetchPublicResource('http://public.example/data?q=1', { resolve: publicAnswer, proxy: async () => proxy.route })
    expect(response).toMatchObject({ url: 'http://public.example/data?q=1', status: 200, contentType: 'application/json' })
    expect(Buffer.from(response.bytes).toString()).toBe('{"ok":true}')
    expect(proxy.requested).toEqual(['public.example:80'])
    expect(target.seen).toEqual([{ host: 'public.example', url: '/data?q=1' }])
  })

  it('keeps the public-address checks before any proxy is contacted', async () => {
    const target = await site(), proxy = await connectProxy(target.port)
    const via = { proxy: async () => proxy.route }
    await expect(fetchPublicResource('http://lan.example/', { ...via, resolve: async () => [{ address: '10.0.0.2', family: 4 }] }))
      .rejects.toMatchObject({ code: 'private-target' })
    await expect(fetchPublicResource('http://192.168.1.10/', via)).rejects.toMatchObject({ code: 'private-target' })
    await expect(fetchPublicResource('http://localhost/', via)).rejects.toMatchObject({ code: 'private-target' })
    expect(proxy.requested).toEqual([])
    expect(target.seen).toEqual([])
  })

  it('uses SOCKS5 without authentication, letting the proxy resolve names and sending literal addresses as such', async () => {
    const target = await site(), proxy = await socksProxy(target.port)
    const response = await fetchPublicResource('http://public.example:8080/socks', { resolve: publicAnswer, proxy: async () => proxy.route })
    expect(Buffer.from(response.bytes).toString()).toBe('{"ok":true}')
    expect(proxy.requested).toEqual([{ type: 3, host: 'public.example', port: 8080 }])
    expect(target.seen).toEqual([{ host: 'public.example:8080', url: '/socks' }])
    const v4 = await openProxyTunnel(proxy.route as Exclude<ProxyRoute, { kind: 'direct' }>, { host: '93.184.216.34', port: 443 })
    v4.destroy()
    const v6 = await openProxyTunnel(proxy.route as Exclude<ProxyRoute, { kind: 'direct' }>, { host: '[2606:4700::1111]', port: 443 })
    v6.destroy()
    expect(proxy.requested.slice(1)).toEqual([{ type: 1, host: '93.184.216.34', port: 443 },
      { type: 4, host: '26064700000000000000000000001111', port: 443 }])
  })

  it('reports a refusing or unreachable proxy, and a cancelled handshake, without falling back to a direct connection', async () => {
    const target = await site(), refusing = await connectProxy(target.port, true)
    await expect(fetchPublicResource('http://public.example/', { resolve: publicAnswer, proxy: async () => refusing.route }))
      .rejects.toThrow('系统代理拒绝连接 public.example:80（HTTP 403）')
    const closed = await listen(createNetServer())
    const port = closed.port
    await new Promise<void>(resolve => closed.close(() => resolve()))
    servers.splice(servers.indexOf(closed), 1)
    await expect(fetchPublicResource('http://public.example/', { resolve: publicAnswer, proxy: async () => ({ kind: 'http', host: '127.0.0.1', port }) }))
      .rejects.toThrow('无法连接系统代理 127.0.0.1')
    expect(target.seen).toEqual([])
    const silent = await listen(createNetServer(() => { /* never answers the handshake */ }))
    const stop = new AbortController()
    const pending = openProxyTunnel({ kind: 'socks5', host: '127.0.0.1', port: silent.port }, { host: 'public.example', port: 443 }, { signal: stop.signal })
    stop.abort(new Error('任务已停止'))
    await expect(pending).rejects.toThrow('任务已停止')
    await expect(openProxyTunnel({ kind: 'http', host: '127.0.0.1', port: silent.port }, { host: 'public.example', port: 443 }, { timeoutMs: 50 }))
      .rejects.toThrow('连接超时')
  })
})
