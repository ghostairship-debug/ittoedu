// @vitest-environment node
import { EventEmitter } from 'node:events'
import { beforeEach, expect, it, vi } from 'vitest'
import { fetchPublicResource, isPublicAddress, resolveWithSyntheticFallback } from '../../src/main/workbench/network/publicHttp'
import { publicAssetHttp } from '../../src/main/workbench/assetSources/publicAssetHttp'
import { AssetHttpError } from '../../src/main/workbench/assetSources/assetSourceTypes'

const wire = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('node:http', async original => ({ ...await original<typeof import('node:http')>(), request: wire.request }))
vi.mock('node:https', async original => ({ ...await original<typeof import('node:https')>(), request: wire.request }))

const resolve = async () => [{ address: '93.184.216.34', family: 4 as const }]
beforeEach(() => { wire.request.mockReset() })

/** One fake response: header-level status/type/length, then the given body chunks. */
function respond(status: number, contentType: string, chunks: readonly Buffer[], contentLength?: number) {
  const destroyed: unknown[] = []
  wire.request.mockImplementation((_url: URL, _options: { headers: Record<string, string> }, callback: (response: EventEmitter) => void) => {
    const request = new EventEmitter() as EventEmitter & { end(): void }
    const response = Object.assign(new EventEmitter(), { statusCode: status,
      headers: { 'content-type': contentType, ...(contentLength !== undefined ? { 'content-length': String(contentLength) } : {}) },
      resume() {}, destroy(error: unknown) { destroyed.push(error) } })
    request.end = () => {
      callback(response)
      queueMicrotask(() => {
        for (const chunk of chunks) { if (destroyed.length) return; response.emit('data', chunk) }
        if (!destroyed.length) response.emit('end')
      })
    }
    return request
  })
  return destroyed
}

it('overrides only Accept, User-Agent and Accept-Language and keeps every other request header fixed', async () => {
  respond(200, 'application/json', [Buffer.from('{}')])
  await fetchPublicResource('https://api.openverse.org/v1/images/?q=x', { resolve, headers: {
    Accept: 'application/json', 'User-Agent': 'GuolingWorkbench/0.0.1 (test)', 'Accept-Language': 'zh-CN',
    ...({ Authorization: 'Bearer secret', Cookie: 'a=b', Host: 'evil.example' } as object) } })
  expect(wire.request.mock.calls[0]![1].headers).toEqual({ Accept: 'application/json', 'Accept-Encoding': 'identity',
    'User-Agent': 'GuolingWorkbench/0.0.1 (test)', 'Accept-Language': 'zh-CN' })
  respond(200, 'text/html', [Buffer.from('<p>x</p>')])
  await fetchPublicResource('https://example.com/', { resolve, headers: { 'User-Agent': 'bad\r\nInjected: 1' } })
  expect(wire.request.mock.calls[1]![1].headers['User-Agent']).toBe('GuolingResearch/2.0')
})

it('stops a download over the byte limit, by declared length or while reading', async () => {
  const declared = respond(200, 'image/jpeg', [Buffer.alloc(10)], 5_000_000)
  await expect(fetchPublicResource('https://example.com/large.jpg', { resolve, maxBytes: 1_000_000 }))
    .rejects.toMatchObject({ code: 'too-large' })
  // Destroyed without an error argument: an 'error' event could crash Main before any listener exists.
  expect(declared).toEqual([undefined])
  const streamed = respond(200, 'image/jpeg', [Buffer.alloc(600_000), Buffer.alloc(600_000), Buffer.alloc(600_000)])
  await expect(fetchPublicResource('https://example.com/streamed.jpg', { resolve, maxBytes: 1_000_000 }))
    .rejects.toMatchObject({ code: 'too-large', message: expect.stringContaining('上限') })
  expect(streamed).toHaveLength(1)
  respond(200, 'image/jpeg', [Buffer.alloc(400_000), Buffer.alloc(400_000)])
  expect((await fetchPublicResource('https://example.com/ok.jpg', { resolve, maxBytes: 1_000_000 })).bytes.byteLength).toBe(800_000)
})

it('adapts the public HTTP layer for the image libraries with JSON parsing and HTTP status', async () => {
  const fetch = vi.fn(fetchPublicResource)
  const http = publicAssetHttp('GuolingWorkbench/9.9.9 (test)', (url, options) => fetch(url, { ...options, resolve }))
  respond(200, 'application/json', [Buffer.from('{"results":[]}')])
  expect(await http.getJson('https://api.openverse.org/v1/images/?q=x', { headers: { Accept: 'application/json' } })).toEqual({ results: [] })
  expect(wire.request.mock.calls[0]![1].headers).toMatchObject({ Accept: 'application/json', 'User-Agent': 'GuolingWorkbench/9.9.9 (test)' })
  respond(429, 'application/json', [Buffer.from('{"detail":"throttled"}')])
  await expect(http.getJson('https://api.openverse.org/v1/images/?q=x')).rejects.toEqual(expect.objectContaining({ status: 429 }))
  respond(429, 'application/json', [])
  await expect(http.getJson('https://api.openverse.org/v1/images/?q=x')).rejects.toBeInstanceOf(AssetHttpError)
  respond(200, 'text/html', [Buffer.from('<html>blocked</html>')])
  await expect(http.getJson('https://commons.wikimedia.org/w/api.php')).rejects.toThrow('不是 JSON')
  respond(200, 'image/png', [Buffer.from([137, 80, 78, 71])])
  expect(await http.getBytes('https://upload.wikimedia.org/x.png', { maxBytes: 100 })).toMatchObject({ contentType: 'image/png', url: 'https://upload.wikimedia.org/x.png' })
})

it('falls back to public DNS only when every answer is a fake-IP proxy address, in either family', async () => {
  // A real Clash fake-IP answer on the Owner machine (2026-10-04): both families from benchmarking ranges.
  for (const address of ['2001:2::1', '2001:0002:0000::20', '2001:2:0:0:0:0:0:ffff']) expect(isPublicAddress(address)).toBe(false)
  for (const address of ['2001:20::1', '2001:2:1::1']) expect(isPublicAddress(address)).toBe(true)
  const real = [{ address: '93.184.216.34', family: 4 as const }]
  const publicResolve = vi.fn(async () => real)
  const synthetic = [{ address: '198.18.0.7', family: 4 as const }, { address: '2001:2::20', family: 6 as const }]
  respond(200, 'application/json', [Buffer.from('{}')])
  await fetchPublicResource('https://api.openverse.org/v1/images/', { resolve: host => resolveWithSyntheticFallback(host, async () => synthetic, publicResolve) })
  expect(publicResolve).toHaveBeenCalledOnce()
  expect(await resolveWithSyntheticFallback('v6-only', async () => [{ address: '2001:2::21', family: 6 }], publicResolve)).toEqual(real)

  const mixed = [{ address: '198.18.0.7', family: 4 as const }, { address: '10.0.0.2', family: 4 as const }]
  await expect(fetchPublicResource('https://api.openverse.org/v1/images/', { resolve: host => resolveWithSyntheticFallback(host, async () => mixed, publicResolve) }))
    .rejects.toMatchObject({ code: 'private-target' })
  const mixedV6 = [{ address: '2001:2::20', family: 6 as const }, { address: '93.184.216.34', family: 4 as const }]
  expect(await resolveWithSyntheticFallback('mixed', async () => mixedV6, publicResolve)).toEqual(mixedV6)
  expect(publicResolve).toHaveBeenCalledTimes(2)
})
