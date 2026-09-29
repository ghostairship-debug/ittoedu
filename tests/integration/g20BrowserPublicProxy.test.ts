import { createServer, request as httpRequest, type Server } from 'node:http'
import { connect as netConnect, createServer as createNetServer, type Socket } from 'node:net'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { ManagedBrowserMcpService } from '../../src/main/workbench/externalTools/ManagedBrowserMcpService'
import { PublicBrowserProxy } from '../../src/main/workbench/network/PublicBrowserProxy'

async function listen(server: Server): Promise<string> {
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('测试服务未启动')
  return `http://127.0.0.1:${address.port}`
}

function connectThroughProxy(proxyUrl: string, authority: string): Promise<{ status: number; socket: Socket }> {
  return new Promise((resolve, reject) => {
    const proxy = new URL(proxyUrl)
    const request = httpRequest({ hostname: proxy.hostname, port: Number(proxy.port),
      method: 'CONNECT', path: authority })
    request.once('connect', (response, socket) => resolve({ status: response.statusCode ?? 0, socket }))
    request.once('error', reject)
    request.end()
  })
}

it('rejects private and mixed DNS CONNECT targets plus HTTP Upgrade before dialing', async () => {
  let resolved = 0, dialed = 0
  const proxy = new PublicBrowserProxy({
    resolve: async hostname => {
      expect(hostname).toBe('mixed.example')
      resolved++
      return [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]
    },
    connect: () => { dialed++; throw new Error('rejected targets must not dial') },
  })
  const address = await proxy.start()
  try {
    const mixed = await connectThroughProxy(address, 'mixed.example:443')
    expect(mixed.status).toBe(403)
    mixed.socket.destroy()
    const literal = await connectThroughProxy(address, '127.0.0.1:443')
    expect(literal.status).toBe(403)
    literal.socket.destroy()
    const malformed = await connectThroughProxy(address, 'mixed.example:443/extra')
    expect(malformed.status).toBe(403)
    malformed.socket.destroy()
    const upgraded = await new Promise<string>((resolve, reject) => {
      const target = new URL(address)
      const socket = netConnect({ host: target.hostname, port: Number(target.port) })
      socket.once('connect', () => socket.write('GET http://mixed.example/ HTTP/1.1\r\nHost: mixed.example\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'))
      socket.once('data', chunk => { resolve(chunk.toString('utf8')); socket.destroy() })
      socket.once('error', reject)
    })
    expect(upgraded).toContain('403 Forbidden')
    expect(resolved).toBe(1)
    expect(dialed).toBe(0)
    expect(proxy.stats().deniedRequests).toBe(4)
  } finally { await proxy.stop() }
}, 15_000)

it('pins CONNECT to the approved numeric address and closes an active tunnel on stop', async () => {
  const echo = createNetServer(socket => socket.on('data', bytes => socket.write(bytes)))
  await new Promise<void>((resolve, reject) => { echo.once('error', reject); echo.listen(0, '127.0.0.1', resolve) })
  const endpoint = echo.address()
  if (!endpoint || typeof endpoint === 'string') throw new Error('echo listener unavailable')
  const dials: { host: string; family: number; port: number }[] = []
  const proxy = new PublicBrowserProxy({
    resolve: async hostname => { expect(hostname).toBe('safe.example'); return [{ address: '93.184.216.34', family: 4 }] },
    connect: options => {
      dials.push(options)
      return netConnect({ host: '127.0.0.1', port: endpoint.port })
    },
  })
  let browserSocket: Socket | undefined
  try {
    const address = await proxy.start()
    const tunnel = await connectThroughProxy(address, 'safe.example:443')
    expect(tunnel.status).toBe(200)
    browserSocket = tunnel.socket
    expect(dials).toEqual([{ host: '93.184.216.34', family: 4, port: 443, timeout: 15_000 }])
    const echoed = new Promise<string>((resolve, reject) => {
      tunnel.socket.once('data', chunk => resolve(chunk.toString('utf8')))
      tunnel.socket.once('error', reject)
    })
    tunnel.socket.write('pinned-tunnel')
    expect(await echoed).toBe('pinned-tunnel')
    const closed = new Promise<void>(resolve => tunnel.socket.once('close', () => resolve()))
    await proxy.stop()
    await closed
    expect(tunnel.socket.destroyed).toBe(true)
  } finally {
    browserSocket?.destroy()
    await proxy.stop()
    await new Promise<void>(resolve => echo.close(() => resolve()))
  }
}, 15_000)

it('blocks private redirect and subresource before either reaches its local server', async () => {
  const base = resolve('output/g20/b23')
  await fs.mkdir(base, { recursive: true })
  const fixture = await fs.mkdtemp(join(base, 'browser-egress-'))
  let privateHits = 0, permittedPixels = 0, privateOrigin = ''
  const privateServer = createServer((_request, response) => { privateHits++; response.writeHead(200).end('private-secret') })
  const publicServer = createServer((request, response) => {
    if (request.url === '/pixel') { permittedPixels++; response.writeHead(200, { 'Content-Type': 'image/png' }); response.end(Buffer.from('89504e470d0a1a0a', 'hex')) }
    else if (request.url === '/subresources') {
      response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end(`<html><body><h1>Public fixture</h1><img src="/pixel"><script src="${privateOrigin}/script.js"></script><img src="${privateOrigin}/pixel"></body></html>`)
    } else if (request.url === '/redirect') { response.writeHead(302, { Location: `${privateOrigin}/secret` }).end() }
    else response.writeHead(404).end()
  })
  privateOrigin = await listen(privateServer)
  const origin = await listen(publicServer)
  const service = new ManagedBrowserMcpService({ scratchRoot: join(fixture, 'browser'), testLoopbackOrigin: origin })
  const invoke = (operationId: string, name: string, args: Record<string, unknown>) => service.invoke({ runId: 'egress',
    operationId, name: `mcp.browser.${name}`, arguments: args })
  try {
    await service.beginRun('egress', { permission: 'read-only', allowPublicNavigation: true })
    expect(await invoke('sub', 'browser_navigate', { url: `${origin}/subresources` })).toMatchObject({ status: 'returned' })
    const snapshot = await invoke('snapshot', 'browser_snapshot', {})
    expect(JSON.stringify(snapshot)).toContain('Public fixture')
    expect(permittedPixels).toBeGreaterThan(0)
    expect(privateHits).toBe(0)
    const blockedSubresources = service.egressStats('egress').deniedRequests
    expect(blockedSubresources).toBeGreaterThan(0)
    await invoke('redirect', 'browser_navigate', { url: `${origin}/redirect` })
    expect(privateHits).toBe(0)
    expect(service.egressStats('egress').deniedRequests).toBeGreaterThan(blockedSubresources)
  } finally {
    await service.endRun('egress')
    await Promise.all([new Promise<void>(done => privateServer.close(() => done())),
      new Promise<void>(done => publicServer.close(() => done()))])
    await fs.rm(fixture, { recursive: true, force: true })
  }
}, 120_000)
