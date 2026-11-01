import { createHash, randomUUID } from 'node:crypto'
import { ChatGPTResponsesProvider, CHATGPT_RESPONSES_BASE_URL } from '../../src/main/workbench/providers/ChatGPTResponsesProvider'
import type { ModelFailure, ModelProviderTiming, ModelRequest, ModelSelection, ModelUsage } from '../../src/shared/workbench/modelProvider'

export const AFFINITY_EXPERIMENT_VERSION = '20261031-v2-explicit-header-control'
export type AffinityArm = 'A' | 'B'
type Payload = Omit<ModelRequest, 'requestId'>
type CredentialResolver = ConstructorParameters<typeof ChatGPTResponsesProvider>[0]['credentialResolver']
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const number = (value: number | undefined): number | null => value !== undefined && Number.isFinite(value) ? value : null
const elapsed = (end: number | undefined, start: number | undefined): number | null =>
  end !== undefined && start !== undefined && end >= start ? end - start : null
const median = (values: Array<number | null>) => {
  const known = values.filter((value): value is number => value !== null).sort((a, b) => a - b)
  return known.length ? (known[Math.floor((known.length - 1) / 2)]! + known[Math.ceil((known.length - 1) / 2)]!) / 2 : null
}
function safeFailure(failure: ModelFailure) {
  return { outcome: failure.outcome, kind: failure.kind, code: failure.code,
    httpStatus: failure.httpStatus ?? null, transport: failure.transport ?? null }
}
function counters(usage: ModelUsage | undefined) {
  return { inputTokens: number(usage?.inputTokens), outputTokens: number(usage?.outputTokens), totalTokens: number(usage?.totalTokens),
    cachedInputTokens: number(usage?.cachedInputTokens), reasoningTokens: number(usage?.reasoningTokens) }
}
export function affinitySelectionFact(selection: ModelSelection) {
  return { model: selection.model, parameters: structuredClone(selection.parameters ?? {}), protocol: selection.connection.protocol,
    route: selection.connection.baseURL, connectionRevision: selection.connection.revision,
    // Account and credential identity participate only in an opaque experiment scope.
    connectionScope: hash(JSON.stringify([selection.connection.id, selection.connection.revision,
      selection.connection.accountId, selection.connection.auth.credentialRef])) }
}
export function assertAffinitySelection(selection: ModelSelection) {
  if (selection.model !== 'gpt-6.1-terra' || selection.connection.protocol !== 'chatgpt-responses'
    || selection.connection.auth.kind !== 'oauth' || selection.connection.baseURL !== CHATGPT_RESPONSES_BASE_URL
    || JSON.stringify(selection.parameters) !== JSON.stringify({ reasoning: { effort: 'xhigh' } }))
    throw new Error('affinity-experiment-requires-exact-terra-xhigh-oauth')
}
export interface AffinitySample {
  index: number; block: number; arm: AffinityArm; requestId: string; startedAt: number; endedAt: number
  outcome: 'completed' | 'failed'; actualModel: string | null; outputAccepted: boolean; reportedInputAboveFloor: boolean | null
  usage: ReturnType<typeof counters>; timing: ModelProviderTiming | null
  durationsMs: { total: number | null; credentials: number | null; fetchToHeaders: number | null; headersToBodyRead: number | null;
    bodyReadToFirstFrame: number | null; firstFrameToReasoning: number | null; firstContent: number | null; contentToTerminal: number | null }
  network: { fetchCalls: number; httpStatus: number | null; responseBytes: number | null; dnsMs: null; tcpMs: null; tlsMs: null; connectionReused: null }
  failure: ReturnType<typeof safeFailure> | { outcome: 'unknown'; kind: 'fixture'; code: string; httpStatus: null; transport: null } | null
  payloadSha256: string; payloadBytes: number; bodyInvariant: boolean; candidateHeaderOnly: boolean; comparisonEligible: boolean
}
export interface AffinityExperimentResult {
  version: string; selection: ReturnType<typeof affinitySelectionFact>; order: AffinityArm[]; payloadSha256: string; payloadBytes: number
  inputTokenFloor: number; samples: AffinitySample[]; complete: boolean; comparisonEligible: boolean
  arms: Record<AffinityArm, { count: number; eligible: number; failed: number; medianFirstContentMs: number | null;
    medianTotalMs: number | null; reportedInputTokens: number | null; reportedCachedInputTokens: number | null; cachedTokenFraction: number | null }>
  limitations: string[]
}

/** Explicit transport injection is mandatory. This helper never chooses a route,
 * decrypts credentials, changes production defaults, dispatches tools or retries. */
export async function runAffinityExperiment(input: {
  payload: Payload; transport: typeof fetch; credentialResolver: CredentialResolver; blocks?: 1 | 2; inputTokenFloor: number
  perRequestTimeoutMs?: number; now?: () => number; createSessionId?: () => string; signal?: AbortSignal
  onSample?(sample: AffinitySample, samples: readonly AffinitySample[]): Promise<void>
}): Promise<AffinityExperimentResult> {
  assertAffinitySelection(input.payload.selection)
  if (!Number.isSafeInteger(input.inputTokenFloor) || input.inputTokenFloor < 1024) throw new Error('affinity-input-token-floor-invalid')
  const now = input.now ?? Date.now, blocks = input.blocks ?? 1
  if (blocks !== 1 && blocks !== 2) throw new Error('affinity-experiment-block-budget-invalid')
  const order: AffinityArm[] = Array.from({ length: blocks }, () => ['A', 'B', 'B', 'A'] as AffinityArm[]).flat()
  const sessionId = (input.createSessionId ?? randomUUID)()
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(sessionId)) throw new Error('affinity-experiment-session-id-invalid')
  let active: AffinitySample | undefined, serialized = ''
  const transport: typeof fetch = async (endpoint, init) => {
    if (!active || String(endpoint) !== `${CHATGPT_RESPONSES_BASE_URL}/responses` || init?.method !== 'POST'
      || typeof init.body !== 'string' || init.body !== serialized) {
      if (active) active.bodyInvariant = false
      throw new Error('affinity-experiment-payload-invariant')
    }
    const headers = new Headers(init.headers)
    if (headers.has('session-id')) { active.candidateHeaderOnly = false; throw new Error('affinity-experiment-production-header-changed') }
    if (active.arm === 'B') headers.set('session-id', sessionId)
    // This is the sole candidate mutation. No authorization/header values are inspected or logged.
    active.network.fetchCalls++
    const response = await input.transport(endpoint, { ...init, headers })
    active.network.httpStatus = response.status
    return response
  }
  const provider = new ChatGPTResponsesProvider({ fetch: transport, credentialResolver: input.credentialResolver, now })
  // A header-only production affinity owner may now exist. This experiment
  // explicitly opts its private clone out, then controls only session-id in the
  // transport above; the serialized body must remain byte-identical.
  const controlPayload = structuredClone(input.payload)
  delete controlPayload.sessionAffinity
  const prepared = provider.prepare(controlPayload)
  serialized = prepared.serialized
  const payloadSha256 = hash(serialized), payloadBytes = Buffer.byteLength(serialized), samples: AffinitySample[] = []
  for (const [index, arm] of order.entries()) {
    input.signal?.throwIfAborted()
    const controller = new AbortController(), stop = () => controller.abort(input.signal?.reason)
    input.signal?.addEventListener('abort', stop, { once: true })
    const timeout = setTimeout(() => controller.abort(new Error('affinity-experiment-request-budget')), input.perRequestTimeoutMs ?? 180_000)
    const sample: AffinitySample = { index, block: Math.floor(index / 4), arm, requestId: `w7-${randomUUID()}`, startedAt: now(), endedAt: 0,
      outcome: 'failed', actualModel: null, outputAccepted: false, reportedInputAboveFloor: null, usage: counters(undefined), timing: null,
      durationsMs: { total: null, credentials: null, fetchToHeaders: null, headersToBodyRead: null, bodyReadToFirstFrame: null,
        firstFrameToReasoning: null, firstContent: null, contentToTerminal: null },
      network: { fetchCalls: 0, httpStatus: null, responseBytes: null, dnsMs: null, tcpMs: null, tlsMs: null, connectionReused: null },
      failure: null, payloadSha256, payloadBytes, bodyInvariant: true, candidateHeaderOnly: true, comparisonEligible: false }
    active = sample
    try {
      for await (const event of prepared.stream(sample.requestId, { signal: controller.signal, onTiming: timing => { sample.timing = { ...timing } } })) {
        if (event.type === 'usage.reported') sample.usage = counters(event.usage)
        if (event.type === 'response.started' && event.actualModel) sample.actualModel = event.actualModel
        if (event.type === 'response.completed') {
          sample.outcome = 'completed'; sample.actualModel = event.actualModel ?? sample.actualModel
          if (event.usage) sample.usage = counters(event.usage)
          sample.outputAccepted = event.assistant.content?.trim() === 'READY' && event.toolCalls.length === 0 && event.finishReason !== 'length'
        }
        if (event.type === 'response.failed') sample.failure = safeFailure(event.failure)
      }
      if (sample.outcome !== 'completed' && !sample.failure) sample.failure = {
        outcome: 'unknown', kind: 'fixture', code: 'missing-terminal-event', httpStatus: null, transport: null }
    } catch {
      sample.failure = { outcome: 'unknown', kind: 'fixture', code: controller.signal.aborted ? 'experiment-aborted' : 'experiment-stream-error', httpStatus: null, transport: null }
    } finally { clearTimeout(timeout); input.signal?.removeEventListener('abort', stop); active = undefined; sample.endedAt = now() }
    const t = sample.timing
    sample.durationsMs = { total: elapsed(sample.endedAt, sample.startedAt), credentials: elapsed(t?.credentialReadyAt, t?.startedAt),
      fetchToHeaders: elapsed(t?.headersReceivedAt, t?.fetchStartedAt), headersToBodyRead: elapsed(t?.firstBodyReadAt, t?.headersReceivedAt),
      bodyReadToFirstFrame: elapsed(t?.firstSseFrameAt, t?.firstBodyReadAt), firstFrameToReasoning: elapsed(t?.firstReasoningAt, t?.firstSseFrameAt),
      firstContent: elapsed(t?.firstContentAt, t?.startedAt), contentToTerminal: elapsed(t?.terminalEventAt, t?.firstContentAt) }
    sample.reportedInputAboveFloor = sample.usage.inputTokens === null ? null : sample.usage.inputTokens >= input.inputTokenFloor
    sample.comparisonEligible = sample.outcome === 'completed' && !sample.failure && sample.actualModel === input.payload.selection.model
      && sample.outputAccepted && sample.reportedInputAboveFloor === true && sample.bodyInvariant && sample.candidateHeaderOnly && sample.network.fetchCalls === 1
    samples.push(sample); await input.onSample?.(structuredClone(sample), structuredClone(samples))
    // Do not spend the remaining budget under changed routing/authority or an invalid experimental control.
    if (!sample.bodyInvariant || !sample.candidateHeaderOnly || sample.actualModel && sample.actualModel !== input.payload.selection.model
      || sample.failure?.kind === 'auth' || sample.failure?.kind === 'configuration' || input.signal?.aborted) break
  }
  const arms = Object.fromEntries((['A', 'B'] as const).map(arm => {
    const rows = samples.filter(sample => sample.arm === arm), eligible = rows.filter(sample => sample.comparisonEligible)
    const sumKnown = (key: 'inputTokens' | 'cachedInputTokens') => rows.length && rows.every(row => row.usage[key] !== null)
      ? rows.reduce((sum, row) => sum + row.usage[key]!, 0) : null
    const inputTokens = sumKnown('inputTokens'), cached = sumKnown('cachedInputTokens')
    return [arm, { count: rows.length, eligible: eligible.length, failed: rows.filter(row => row.outcome !== 'completed').length,
      medianFirstContentMs: median(eligible.map(row => row.durationsMs.firstContent)), medianTotalMs: median(eligible.map(row => row.durationsMs.total)),
      reportedInputTokens: inputTokens, reportedCachedInputTokens: cached, cachedTokenFraction: inputTokens && cached !== null ? cached / inputTokens : null }]
  })) as AffinityExperimentResult['arms']
  return { version: AFFINITY_EXPERIMENT_VERSION, selection: affinitySelectionFact(input.payload.selection), order, payloadSha256, payloadBytes,
    inputTokenFloor: input.inputTokenFloor, samples, complete: samples.length === order.length,
    comparisonEligible: samples.length === order.length && samples.every(sample => sample.comparisonEligible), arms,
    limitations: ['Only this fixed-payload transport sample; not first-qualified-delivery or creator quality.',
      'ABBA is small and shares a possibly warm server cache; cache carryover, queue variation and order are not isolated.',
      'Missing usage and timing stay null; provider-reported cumulative input is not a bill.',
      'Fetch does not reveal DNS/TCP/TLS or socket reuse; body read timestamps are local consumption, not network arrival.',
      'A session-id candidate is not assumed to improve speed; this fixture changes no production defaults and explicitly controls its own affinity header.'] }
}
