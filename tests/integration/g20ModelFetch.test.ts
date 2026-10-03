// @vitest-environment node
import { createServer, type Server } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { Agent, getGlobalDispatcher, setGlobalDispatcher, type Dispatcher } from 'undici'
import { afterEach, expect, it } from 'vitest'
import { fetchModelResponse, IMAGE_RESPONSE_IDLE_TIMEOUT_MS, modelFetch, responseIdleTimeoutCode } from '../../src/main/workbench/providers/modelFetch'

const original = getGlobalDispatcher(), agents: Agent[] = [], servers: Server[] = []
afterEach(async () => {
  setGlobalDispatcher(original)
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })))
  await Promise.all(agents.splice(0).map(agent => agent.close()))
})
async function listen(server: Server): Promise<string> {
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('address')
  return `http://127.0.0.1:${address.port}`
}

it.each([
  { idleTimeoutMs: undefined, expectedIdleMs: 300_000 },
  { idleTimeoutMs: IMAGE_RESPONSE_IDLE_TIMEOUT_MS, expectedIdleMs: 900_000 },
])('uses the existing dispatcher and the selected $expectedIdleMs ms response idle wait for real HTTP', async ({ idleTimeoutMs, expectedIdleMs }) => {
  const agent = new Agent({ headersTimeout: 1, bodyTimeout: 1 }); agents.push(agent)
  const sent: Dispatcher.DispatchOptions[] = []
  setGlobalDispatcher(agent.compose(dispatch => (options, handler) => { sent.push(options); return dispatch(options, handler) }))
  const url = await listen(createServer((_request, response) => { void (async () => {
    await delay(20)
    response.writeHead(200, { 'content-type': 'text/plain' }); response.write('long ')
    await delay(20); response.end('generation')
  })() }))
  const response = await modelFetch(fetch, idleTimeoutMs)(url)
  expect(await response.text()).toBe('long generation')
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatchObject({ headersTimeout: expectedIdleMs, bodyTimeout: expectedIdleMs })
})

it('detects a real HTTP request that never returns response headers', async () => {
  const url = await listen(createServer(() => undefined))
  const error = await modelFetch(undefined, 25)(url).catch(error => error)
  expect(responseIdleTimeoutCode(error)).toBe('response-headers-idle')
})

it('aborts a real request waiting for response headers before the idle failure wait', async () => {
  let entered!: () => void
  const reached = new Promise<void>(resolve => { entered = resolve })
  const url = await listen(createServer(() => entered()))
  const controller = new AbortController(), pending = fetchModelResponse(url, { signal: controller.signal })
  await reached; controller.abort()
  await expect(pending).rejects.toBeDefined()
})
