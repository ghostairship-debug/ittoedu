// @vitest-environment node
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fetchPublicResource } from '../../src/main/workbench/network/publicHttp'

const wire = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('node:http', async original => ({ ...await original<typeof import('node:http')>(), request: wire.request }))
vi.mock('node:https', async original => ({ ...await original<typeof import('node:https')>(), request: wire.request }))

let response: EventEmitter
beforeEach(() => { vi.useFakeTimers(); wire.request.mockReset() })
afterEach(() => { vi.useRealTimers() })
const resolve = async () => [{ address: '93.184.216.34', family: 4 as const }]

function respond(route: (url: URL) => { status: number; location?: string; contentLength?: number }): void {
  wire.request.mockImplementation((url: URL, options: { signal: AbortSignal }, callback: (response: EventEmitter) => void) => {
    const request = new EventEmitter() as EventEmitter & { end(): void }
    const selected = route(url)
    response = Object.assign(new EventEmitter(), { statusCode: selected.status,
      headers: { 'content-type': 'text/plain', ...(selected.location ? { location: selected.location } : {}),
        ...(selected.contentLength ? { 'content-length': String(selected.contentLength) } : {}) }, resume() {} })
    const current = response
    request.end = () => {
      options.signal.addEventListener('abort', () => request.emit('error', options.signal.reason), { once: true })
      request.emit('socket', new EventEmitter())
      callback(current)
    }
    return request
  })
}

it('continues an active download beyond former total deadlines and body caps', async () => {
  const bytes = Buffer.alloc(21 * 1024 * 1024, 65)
  respond(() => ({ status: 200, contentLength: bytes.length }))
  const pending = fetchPublicResource('https://example.com/article', { resolve })
  await vi.advanceTimersByTimeAsync(0)
  for (let step = 0; step < 5; step++) {
    await vi.advanceTimersByTimeAsync(10_000)
    response.emit('data', step === 4 ? bytes : Buffer.from('progress'))
  }
  response.emit('end')
  expect((await pending).bytes.length).toBe(bytes.length + 4 * 'progress'.length)
})

it('follows more than five redirects and stops an actual repeated URL', async () => {
  respond(url => Number(url.pathname.slice(1)) < 8
    ? { status: 302, location: `/${Number(url.pathname.slice(1)) + 1}` } : { status: 200 })
  const pending = fetchPublicResource('https://example.com/0', { resolve })
  await vi.advanceTimersByTimeAsync(0)
  response.emit('data', Buffer.from('source'))
  response.emit('end')
  expect(await pending).toMatchObject({ url: 'https://example.com/8', status: 200 })
  expect(wire.request).toHaveBeenCalledTimes(9)
  respond(() => ({ status: 302, location: '/loop' }))
  await expect(fetchPublicResource('https://example.com/loop', { resolve })).rejects.toMatchObject({ code: 'redirect-loop' })
})

it('continues after long response silence and honors caller cancellation including DNS waits', async () => {
  respond(() => ({ status: 200 }))
  const paused = fetchPublicResource('https://example.com/paused', { resolve })
  await vi.advanceTimersByTimeAsync(120_000)
  response.emit('data', Buffer.from('late complete response'))
  response.emit('end')
  expect(Buffer.from((await paused).bytes).toString('utf8')).toBe('late complete response')
  const stop = new AbortController()
  const cancelled = fetchPublicResource('https://example.com/cancelled', { resolve, signal: stop.signal })
  const cancelledResult = expect(cancelled).rejects.toMatchObject({ code: 'cancelled' })
  await vi.advanceTimersByTimeAsync(0)
  stop.abort()
  await cancelledResult
  const stopDns = new AbortController()
  const dns = fetchPublicResource('https://example.com/dns', { signal: stopDns.signal, resolve: () => new Promise(() => {}) })
  const dnsResult = expect(dns).rejects.toMatchObject({ code: 'cancelled' })
  stopDns.abort()
  await dnsResult
})

it('diagnoses five minutes of network inactivity while DNS, headers, and data refresh a rolling wait', async () => {
  const idleDns = fetchPublicResource('https://example.com/dns-stalled', { resolve: () => new Promise(() => {}) })
  const dnsResult = expect(idleDns).rejects.toMatchObject({ code: 'timeout', message: expect.stringContaining('没有网络活动') })
  await vi.advanceTimersByTimeAsync(300_000)
  await dnsResult
  expect(vi.getTimerCount()).toBe(0)

  wire.request.mockImplementationOnce((_url: URL, options: { signal: AbortSignal }) => {
    const request = Object.assign(new EventEmitter(), { end() {
      options.signal.addEventListener('abort', () => request.emit('error', options.signal.reason), { once: true })
    } })
    return request
  })
  let finishDns!: (value: Awaited<ReturnType<typeof resolve>>) => void
  const noHeaders = fetchPublicResource('https://example.com/headers-stalled', { resolve: () => new Promise(done => { finishDns = done }) })
  const headersResult = expect(noHeaders).rejects.toMatchObject({ code: 'timeout' })
  await vi.advanceTimersByTimeAsync(240_000)
  finishDns(await resolve())
  await vi.advanceTimersByTimeAsync(240_000)
  expect(vi.getTimerCount()).toBe(1)
  await vi.advanceTimersByTimeAsync(60_000)
  await headersResult
  expect(vi.getTimerCount()).toBe(0)

  respond(() => ({ status: 200 }))
  const returned = vi.fn()
  const active = fetchPublicResource('https://example.com/data-stalled', { resolve }).then(returned, failure => failure)
  await vi.advanceTimersByTimeAsync(0)
  // Continuous useful progress can last well past five minutes overall.
  for (let step = 0; step < 4; step++) {
    await vi.advanceTimersByTimeAsync(240_000)
    response.emit('data', Buffer.from('progress'))
    expect(returned).not.toHaveBeenCalled()
  }
  await vi.advanceTimersByTimeAsync(299_999)
  expect(returned).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(await active).toMatchObject({ code: 'timeout' })
  expect(vi.getTimerCount()).toBe(0)
})
