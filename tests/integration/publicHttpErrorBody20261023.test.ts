// @vitest-environment node
import { EventEmitter } from 'node:events'
import { beforeEach, expect, it, vi } from 'vitest'
import { fetchPublicResource } from '../../src/main/workbench/network/publicHttp'

const wire = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('node:http', async original => ({ ...await original<typeof import('node:http')>(), request: wire.request }))
vi.mock('node:https', async original => ({ ...await original<typeof import('node:https')>(), request: wire.request }))

beforeEach(() => { wire.request.mockReset() })

it('rejects an HTTP error at the headers and closes a body that never ends', async () => {
  const destroy = vi.fn()
  const response = Object.assign(new EventEmitter(), {
    statusCode: 429,
    headers: { 'content-type': 'text/html', 'content-length': String(100 * 1024 * 1024) },
    destroy,
  })
  wire.request.mockImplementation((_url: URL, _options: unknown, callback: (response: EventEmitter) => void) =>
    Object.assign(new EventEmitter(), { end() { callback(response) } }))

  await expect(fetchPublicResource('https://example.com/rate-limited', {
    resolve: async () => [{ address: '93.184.216.34', family: 4 as const }],
    proxy: async () => ({ kind: 'direct' }),
    maxBytes: 1024,
  })).rejects.toMatchObject({ code: 'http-error', status: 429 })

  // No end event is delivered: neither a hanging body nor the content-length
  // limit should hide the actual HTTP failure or keep downloading its body.
  expect(destroy).toHaveBeenCalledOnce()
  expect(response.listenerCount('data')).toBe(0)
})
