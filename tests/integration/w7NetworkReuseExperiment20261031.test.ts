// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { runNetworkReuseExperiment } from '../helpers/w7NetworkReuseExperiment'

const servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
async function endpoint(mode: 'keepalive' | 'close' | 'redirect') {
  const received: Array<{ method: string | undefined; authorization: boolean; bodyBytes: number; path: string | undefined }> = []
  const server = createServer((request, response) => {
    const entry = { method: request.method, authorization: Boolean(request.headers.authorization), bodyBytes: 0, path: request.url }
    received.push(entry)
    request.on('data', (chunk: Buffer) => { entry.bodyBytes += chunk.length })
    request.on('end', () => {
      response.setHeader('x-sensitive-fixture', 'must-never-appear-in-report')
      if (mode === 'close') response.setHeader('connection', 'close')
      if (mode === 'redirect') { response.writeHead(302, { location: '/must-not-follow' }); response.end(); return }
      response.writeHead(204); response.end()
    })
  })
  servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('loopback-server-address-missing')
  return { url: `http://127.0.0.1:${address.port}/responses`, received }
}
describe('W7 bounded production-owner pool comparison', () => {
  it('calibrates actual socket detection with an explicit loopback-only keep-alive consumer', async () => {
    const target = await endpoint('keepalive')
    const result = await runNetworkReuseExperiment({ endpoint: target.url, routeResolver: async () => ({ kind: 'direct' }), loopbackForceHeadKeepAlive: true })
    expect(target.received).toEqual(Array.from({ length: 4 }, () => ({ method: 'HEAD', authorization: false, bodyBytes: 0, path: '/responses' })))
    expect(result.samples.map(sample => sample.arm)).toEqual(['fresh', 'pooled', 'pooled', 'fresh'])
    expect(result.samples.map(sample => sample.requestObjects)).toEqual([1, 1, 1, 1])
    expect(result.samples.map(sample => sample.sends)).toEqual([1, 1, 1, 1])
    expect(result.pooledSecondReusedSocket).toBe(true)
    expect(result.freshRequestsUsedDistinctSockets).toBe(true)
    expect(result.comparisonEligible, JSON.stringify(result.ineligibleReasons)).toBe(true)
    expect(result.routes).toHaveLength(3)
    expect(result.samples.every(sample => sample.timing.dnsMs === null && sample.timing.tcpMs === null && sample.timing.tlsMs === null)).toBe(true)
    expect(JSON.stringify(result)).not.toContain('must-never-appear-in-report')
    expect(JSON.stringify(result)).not.toContain('x-sensitive-fixture')
    expect(result.modelRequests).toBe(0)
    expect(result.headKeepAlivePolicy).toBe('explicit-reset-false-loopback-control')
  })
  it('preserves the production HEAD reset policy and reports its lack of socket reuse honestly', async () => {
    const target = await endpoint('keepalive')
    const result = await runNetworkReuseExperiment({ endpoint: target.url, routeResolver: async () => ({ kind: 'direct' }) })
    expect(target.received).toHaveLength(4)
    expect(result.samples.map(sample => sample.requestObjects)).toEqual([1, 1, 1, 1])
    expect(result.samples.map(sample => sample.sends)).toEqual([1, 1, 1, 1])
    expect(result.samples.map(sample => sample.socketReused)).toEqual([false, false, false, false])
    expect(result.headKeepAlivePolicy).toBe('production-default')
    expect(result.pooledSecondReusedSocket).toBe(false)
    expect(result.comparisonEligible).toBe(false)
    expect(result.ineligibleReasons).toContain('response-confirmed-connection-close')
    expect(result.ineligibleReasons).toContain('pooled-second-request-did-not-confirm-same-socket-reuse')
    expect(result.routes).toHaveLength(4)
    await expect(runNetworkReuseExperiment({ loopbackForceHeadKeepAlive: true })).rejects.toThrow('head-keepalive-override-is-only-for-loopback-detector-calibration')
  })
  it('reports server connection closure as ineligible without inventing reuse or adding warmup requests', async () => {
    const target = await endpoint('close')
    const result = await runNetworkReuseExperiment({ endpoint: target.url, routeResolver: async () => ({ kind: 'direct' }), loopbackForceHeadKeepAlive: true })
    expect(target.received).toHaveLength(4)
    expect(result.comparisonEligible).toBe(false)
    expect(result.ineligibleReasons).toContain('response-confirmed-connection-close')
    expect(result.pooledSecondReusedSocket).toBe(false)
    expect(result.routes).toHaveLength(4)
  })
  it('does not follow a redirect or expose response headers/content', async () => {
    const target = await endpoint('redirect')
    const result = await runNetworkReuseExperiment({ endpoint: target.url, routeResolver: async () => ({ kind: 'direct' }) })
    expect(target.received).toHaveLength(4)
    expect(target.received.every(request => request.path === '/responses')).toBe(true)
    expect(result.samples.every(sample => sample.httpStatus === 302 && sample.status === 'failed')).toBe(true)
    expect(result.comparisonEligible).toBe(false)
    expect(JSON.stringify(result)).not.toContain('must-never-appear-in-report')
  })
})
