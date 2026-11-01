/** Bounded, unauthenticated transport experiment. No model/client/credential owner
 * is called here. Both arms use the production Agent factory and route resolver.
 * Diagnostics subscribers only retain safe scalar facts, never headers or bodies.
 * Channel contracts: https://undici.nodejs.org/api/DiagnosticsChannel */
import assert from 'node:assert/strict'
import { channel } from 'node:diagnostics_channel'
import { performance } from 'node:perf_hooks'
import { setImmediate as nextTurn } from 'node:timers/promises'
import type { Agent, Dispatcher } from 'undici'
import { createSystemProxyAgent } from '../../src/main/workbench/network/systemProxyDispatcher'
import { systemProxyRoute, type ProxyRouteResolver } from '../../src/main/workbench/network/systemProxy'

export const NETWORK_REUSE_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses'
type Arm = 'fresh' | 'pooled'
type RouteKind = 'direct' | 'http' | 'socks5'
interface SafeError { name: string | null; code: string | null }
interface RouteFact { id: string; poolId: string; startedMs: number; finishedMs: number | null; kind: RouteKind | null; error: SafeError | null }
interface ConnectionFact {
  id: string; poolId: string | null; routeId: string | null; socketId: string | null
  startedMs: number; connectedMs: number | null; failedMs: number | null; error: SafeError | null
}
export interface NetworkReuseSample {
  index: number; arm: Arm; poolId: string; fetchInvocations: number; requestObjects: number; sends: number
  status: 'completed' | 'failed'; httpStatus: number | null; socketIds: string[]
  socketReused: boolean | null; routeKinds: RouteKind[]; returnedBody: boolean | null
  responseConnectionClose: boolean | null; error: SafeError | null
  timing: { totalMs: number | null; requestCreatedMs: number | null; firstSendMs: number | null
    responseHeadersMs: number | null; completionMs: number | null; connectionEstablishmentMs: number | null
    dnsMs: null; tcpMs: null; tlsMs: null }
}
export interface NetworkReuseReport {
  version: 'w7-network-reuse/v1'; endpoint: string; method: 'HEAD'; credentials: 'omit'; authorization: false
  bodyBytes: 0; redirect: 'error'; pipelineRetries: 'disabled-in-both-arms'; modelRequests: 0; requestBudget: 4; perRequestTimeoutMs: number
  headKeepAlivePolicy: 'production-default' | 'explicit-reset-false-loopback-control'
  order: readonly Arm[]; samples: NetworkReuseSample[]; routes: RouteFact[]; connections: ConnectionFact[]
  diagnostics: { subscriberErrors: number; unrelatedRequests: number; ambiguousConnectionLinks: number }
  cleanupCompleted: boolean; comparisonEligible: boolean; ineligibleReasons: string[]
  pooledSecondReusedSocket: boolean | null; freshRequestsUsedDistinctSockets: boolean | null
  limitations: string[]
}

const reference = (value: unknown): value is object => value !== null && (typeof value === 'object' || typeof value === 'function')
const record = (value: unknown): Record<string, unknown> | undefined => reference(value) ? value as Record<string, unknown> : undefined
const rounded = (value: number) => Math.round(value * 1000) / 1000
function safeError(value: unknown): SafeError {
  const item = record(value), cause = record(item?.cause)
  const code = [item?.code, cause?.code].find(candidate => typeof candidate === 'string'
    && /^(?:UND_ERR_[A-Z_]+|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ABORT_ERR|proxy-timeout|proxy-failed|proxy-refused|proxy-unsupported)$/.test(candidate))
  const name = ['AbortError', 'TimeoutError', 'TypeError', 'Error', 'ProxyError'].includes(String(item?.name)) ? String(item?.name) : null
  return { name, code: typeof code === 'string' ? code : null }
}

/** endpoint/resolver injection exists only for loopback integration tests. The
 * Electron entry locks the real experiment to NETWORK_REUSE_ENDPOINT. */
export async function runNetworkReuseExperiment(input: {
  endpoint?: string; perRequestTimeoutMs?: number; routeResolver?: ProxyRouteResolver
  /** Detector calibration only, never accepted for the real endpoint. */
  loopbackForceHeadKeepAlive?: true
  ensureReady?: () => unknown; checkpoint?: (report: NetworkReuseReport) => Promise<void>
} = {}): Promise<NetworkReuseReport> {
  const endpoint = new URL(input.endpoint ?? NETWORK_REUSE_ENDPOINT)
  assert(!endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash, 'transport-endpoint-must-not-carry-credentials-or-parameters')
  assert(endpoint.href === NETWORK_REUSE_ENDPOINT || endpoint.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(endpoint.hostname),
    'only-the-current-endpoint-or-a-loopback-test-server-is-permitted')
  assert(!input.loopbackForceHeadKeepAlive || endpoint.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(endpoint.hostname),
    'head-keepalive-override-is-only-for-loopback-detector-calibration')
  const timeoutMs = input.perRequestTimeoutMs ?? 15_000
  assert(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 15_000, 'invalid-network-request-time-budget')
  const started = performance.now(), elapsed = () => rounded(performance.now() - started)
  const report: NetworkReuseReport = {
    version: 'w7-network-reuse/v1', endpoint: endpoint.href, method: 'HEAD', credentials: 'omit', authorization: false,
    bodyBytes: 0, redirect: 'error', pipelineRetries: 'disabled-in-both-arms', modelRequests: 0, requestBudget: 4, perRequestTimeoutMs: timeoutMs,
    headKeepAlivePolicy: input.loopbackForceHeadKeepAlive ? 'explicit-reset-false-loopback-control' : 'production-default',
    order: ['fresh', 'pooled', 'pooled', 'fresh'], samples: [], routes: [], connections: [],
    diagnostics: { subscriberErrors: 0, unrelatedRequests: 0, ambiguousConnectionLinks: 0 }, cleanupCompleted: true,
    comparisonEligible: false, ineligibleReasons: ['not-completed'], pooledSecondReusedSocket: null,
    freshRequestsUsedDistinctSockets: null,
    limitations: [
      'Four unauthenticated HEAD requests measure this endpoint transport only; they are not model generation or creator delivery timings.',
      'Installed Undici 7.28 closes HEAD sockets by default for compatibility. The real endpoint retains this policy; it does not reveal POST/SSE reuse.',
      'The first request can include process, DNS, proxy and TLS warmup. A socket fact does not isolate each of those costs.',
      'BeforeConnect/connected is one aggregate stage; DNS, TCP and TLS are unknown unless separately observed.',
      'HEAD refusal, connection closure, differing routes/statuses, missing diagnostics or hidden resends make the comparison ineligible.',
      'This experiment cannot establish the cause of historical ECONNRESET failures or justify a general speedup claim.'
    ]
  }
  type TrackedConnection = { connector: object; fact: ConnectionFact; route?: RouteFact }
  type TrackedSocket = { id: string; sends: number; connection?: TrackedConnection }
  const connections: TrackedConnection[] = [], requests = new WeakMap<object, { sample: NetworkReuseSample; startedMs: number }>()
  const sockets = new WeakMap<object, TrackedSocket>(), pools = new Map<string, Agent>(), subscriptions: Array<() => void> = []
  let socketCount = 0, active: { sample: NetworkReuseSample; startedMs: number } | undefined
  const socketFact = (socket: object): TrackedSocket => {
    const old = sockets.get(socket)
    if (old) return old
    const value = { id: `socket-${++socketCount}`, sends: 0 }; sockets.set(socket, value); return value
  }
  const matchingParams = (raw: unknown) => {
    const params = record(raw)
    if (!params) return false
    try {
      const protocol = typeof params.protocol === 'string' ? params.protocol : endpoint.protocol
      const hostname = typeof params.hostname === 'string' ? params.hostname : typeof params.host === 'string' ? params.host : ''
      const origin = new URL(`${protocol}//${hostname.includes(':') && !hostname.startsWith('[') && !hostname.match(/:\d+$/) ? `[${hostname}]` : hostname}`)
      const port = params.port === undefined || params.port === '' ? origin.port || (protocol === 'https:' ? '443' : '80') : String(params.port)
      return origin.hostname === endpoint.hostname && port === (endpoint.port || (endpoint.protocol === 'https:' ? '443' : '80'))
    } catch { return false }
  }
  const subscribe = (name: string, receive: (message: Record<string, unknown>) => void) => {
    const target = channel(name)
    const listener = (message: unknown) => {
      try { const value = record(message); if (value) receive(value) } catch { report.diagnostics.subscriberErrors++ }
    }
    target.subscribe(listener); subscriptions.push(() => target.unsubscribe(listener))
  }
  subscribe('undici:request:create', message => {
    const request = record(message.request)
    if (!request || !active) return
    if (request.method !== 'HEAD' || String(request.origin) !== endpoint.origin || request.path !== endpoint.pathname) {
      report.diagnostics.unrelatedRequests++; return
    }
    requests.set(request, active); active.sample.requestObjects++
    active.sample.timing.requestCreatedMs ??= rounded(elapsed() - active.startedMs)
  })
  subscribe('undici:client:beforeConnect', message => {
    if (!reference(message.connector) || !matchingParams(message.connectParams)) return
    const fact: ConnectionFact = { id: `connection-${connections.length + 1}`, poolId: null, routeId: null,
      socketId: null, startedMs: elapsed(), connectedMs: null, failedMs: null, error: null }
    connections.push({ connector: message.connector, fact }); report.connections.push(fact)
  })
  const pendingConnection = (connector: unknown) => {
    const candidates = connections.filter(item => item.connector === connector && item.fact.connectedMs === null && item.fact.failedMs === null)
    if (candidates.length !== 1) { report.diagnostics.ambiguousConnectionLinks++; return }
    return candidates[0]
  }
  subscribe('undici:client:connected', message => {
    if (!matchingParams(message.connectParams) || !reference(message.socket)) return
    const connection = pendingConnection(message.connector), socket = socketFact(message.socket)
    if (connection) { connection.fact.connectedMs = elapsed(); connection.fact.socketId = socket.id; socket.connection = connection }
  })
  subscribe('undici:client:connectError', message => {
    if (!matchingParams(message.connectParams)) return
    const connection = pendingConnection(message.connector)
    if (connection) { connection.fact.failedMs = elapsed(); connection.fact.error = safeError(message.error) }
  })
  subscribe('undici:client:sendHeaders', message => {
    if (!reference(message.request) || !reference(message.socket)) return
    const tracked = requests.get(message.request)
    if (!tracked) return
    const { sample, startedMs } = tracked, socket = socketFact(message.socket), connection = socket.connection
    sample.sends++; sample.socketIds.push(socket.id)
    sample.socketReused = sample.sends === 1 ? socket.sends > 0 : null
    socket.sends++; sample.timing.firstSendMs ??= rounded(elapsed() - startedMs)
    if (connection?.route?.kind && !sample.routeKinds.includes(connection.route.kind)) sample.routeKinds.push(connection.route.kind)
    if (connection?.fact.connectedMs !== null && connection?.fact.connectedMs !== undefined && sample.socketReused === false)
      sample.timing.connectionEstablishmentMs = rounded(connection.fact.connectedMs - connection.fact.startedMs)
  })
  subscribe('undici:request:headers', message => {
    if (!reference(message.request)) return
    const tracked = requests.get(message.request), response = record(message.response)
    if (!tracked) return
    if (typeof response?.statusCode === 'number') tracked.sample.httpStatus = response.statusCode
    tracked.sample.timing.responseHeadersMs ??= rounded(elapsed() - tracked.startedMs)
  })
  subscribe('undici:request:trailers', message => {
    if (!reference(message.request)) return
    const tracked = requests.get(message.request)
    if (tracked) tracked.sample.timing.completionMs = rounded(elapsed() - tracked.startedMs)
  })
  subscribe('undici:request:error', message => {
    if (!reference(message.request)) return
    const tracked = requests.get(message.request)
    if (tracked) tracked.sample.error = safeError(message.error)
  })
  const makePool = (poolId: string) => {
    const agent = createSystemProxyAgent(async url => {
      const route: RouteFact = { id: `route-${report.routes.length + 1}`, poolId, startedMs: elapsed(), finishedMs: null, kind: null, error: null }
      report.routes.push(route)
      // beforeConnect is not a request event. Only link an unambiguous pending
      // connector here; the eventual request is linked by its actual socket.
      const candidates = connections.filter(item => !item.route && item.fact.connectedMs === null && item.fact.failedMs === null)
      if (candidates.length === 1) {
        candidates[0]!.route = route; candidates[0]!.fact.poolId = poolId; candidates[0]!.fact.routeId = route.id
      } else report.diagnostics.ambiguousConnectionLinks++
      try {
        const decision = await (input.routeResolver ?? systemProxyRoute)(url)
        route.kind = decision.kind; return decision
      } catch (error) { route.error = safeError(error); throw error }
      finally { route.finishedMs = elapsed() }
    })
    pools.set(poolId, agent); return agent
  }
  const destroy = async (agent: Agent) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const complete = await Promise.race([agent.destroy().then(() => true, () => false),
        new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 1000) })])
      if (!complete) report.cleanupCompleted = false
    } finally { clearTimeout(timer) }
  }
  // HEAD is normally idempotent. Both arms disable automatic pipeline replay so
  // the four explicit calls cannot quietly grow into a retry comparison.
  // Undici 7.28 client-h1 sets reset=true for HEAD by default. The real endpoint
  // keeps that behavior; reset:false exists solely to calibrate socket detection
  // against an explicit loopback keep-alive consumer, never to force a result.
  const onceOnly: Dispatcher.DispatcherComposeInterceptor = dispatch => (options, handler) =>
    dispatch({ ...options, idempotent: false, ...(input.loopbackForceHeadKeepAlive ? { reset: false } : {}) }, handler)
  try {
    for (const [index, arm] of report.order.entries()) {
      input.ensureReady?.()
      const poolId = arm === 'pooled' ? 'pooled-1' : `fresh-${index}`
      const agent = pools.get(poolId) ?? makePool(poolId), sample: NetworkReuseSample = {
        index, arm, poolId, fetchInvocations: 0, requestObjects: 0, sends: 0, status: 'failed', httpStatus: null,
        socketIds: [], socketReused: null, routeKinds: [], returnedBody: null, responseConnectionClose: null, error: null,
        timing: { totalMs: null, requestCreatedMs: null, firstSendMs: null, responseHeadersMs: null, completionMs: null,
          connectionEstablishmentMs: null, dnsMs: null, tcpMs: null, tlsMs: null }
      }
      report.samples.push(sample); active = { sample, startedMs: elapsed() }
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        sample.fetchInvocations++
        const init: RequestInit & { dispatcher: Dispatcher } = {
          method: 'HEAD', credentials: 'omit', redirect: 'error', signal: controller.signal, dispatcher: agent.compose(onceOnly)
        }
        const response = await fetch(endpoint.href, init)
        sample.httpStatus = response.status; sample.returnedBody = response.body !== null
        sample.responseConnectionClose = /(?:^|,)\s*close\s*(?:,|$)/i.test(response.headers.get('connection') ?? '')
        // Never consume a response body. HEAD should not have one; if it does,
        // cancellation is recorded and makes reuse comparison ineligible.
        if (response.body) await response.body.cancel()
        sample.status = 'completed'
      } catch (error) { sample.error ??= safeError(error) }
      finally {
        clearTimeout(timer); sample.timing.totalMs = rounded(elapsed() - active.startedMs); active = undefined
      }
      // Allow the same production pool to release a completed HEAD socket. This
      // identical event-loop turn is applied to both arms, without a warmup call.
      await nextTurn()
      if (arm === 'fresh') { await destroy(agent); pools.delete(poolId) }
      await input.checkpoint?.(structuredClone(report))
    }
  } finally {
    for (const agent of pools.values()) await destroy(agent)
    subscriptions.forEach(remove => remove())
  }
  const [firstFresh, firstPooled, secondPooled, lastFresh] = report.samples
  const oneSocket = (sample: NetworkReuseSample | undefined) => sample?.sends === 1 && sample.socketIds.length === 1 ? sample.socketIds[0]! : null
  const a = oneSocket(firstPooled), b = oneSocket(secondPooled), c = oneSocket(firstFresh), d = oneSocket(lastFresh)
  report.pooledSecondReusedSocket = a && b ? a === b && secondPooled!.socketReused === true : null
  report.freshRequestsUsedDistinctSockets = c && d && a ? new Set([c, d, a]).size === 3 : null
  const reasons: string[] = []
  if (report.samples.length !== 4 || report.samples.some(sample => sample.fetchInvocations !== 1)) reasons.push('request-budget-or-completion-mismatch')
  if (report.samples.some(sample => sample.status !== 'completed')) reasons.push('one-or-more-head-requests-failed')
  const statuses = new Set(report.samples.map(sample => sample.httpStatus))
  if (statuses.size !== 1 || report.samples.some(sample => sample.httpStatus === null || !(sample.httpStatus >= 200 && sample.httpStatus < 300 || sample.httpStatus === 401 || sample.httpStatus === 403)))
    reasons.push('head-statuses-do-not-form-the-same-supported-response-class')
  if (report.samples.some(sample => sample.returnedBody !== false)) reasons.push('head-body-absence-unconfirmed')
  if (report.samples.some(sample => sample.responseConnectionClose === true)) reasons.push('response-confirmed-connection-close')
  if (report.samples.some(sample => sample.requestObjects !== 1 || sample.sends !== 1)) reasons.push('missing-diagnostics-or-extra-request-send')
  if (report.samples.some(sample => sample.routeKinds.length !== 1) || new Set(report.samples.flatMap(sample => sample.routeKinds)).size !== 1)
    reasons.push('same-actual-route-kind-unconfirmed')
  if (report.pooledSecondReusedSocket !== true) reasons.push('pooled-second-request-did-not-confirm-same-socket-reuse')
  if (report.freshRequestsUsedDistinctSockets !== true) reasons.push('fresh-request-socket-isolation-unconfirmed')
  if (report.diagnostics.subscriberErrors || report.diagnostics.ambiguousConnectionLinks || report.diagnostics.unrelatedRequests)
    reasons.push('diagnostic-correlation-incomplete-or-process-not-isolated')
  if (!report.cleanupCompleted) reasons.push('owned-agent-cleanup-incomplete')
  report.ineligibleReasons = reasons; report.comparisonEligible = reasons.length === 0
  await input.checkpoint?.(structuredClone(report))
  return report
}
