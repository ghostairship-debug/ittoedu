import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const phases = new Set(['fetch-before-headers', 'body-read'])
const classes = new Set(['TypeError', 'Error', 'AbortError', 'AggregateError', 'SocketError',
  'ConnectTimeoutError', 'HeadersTimeoutError', 'BodyTimeoutError', 'other'])
const codes = new Set(['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EPIPE',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'])

type TransportDiagnostic = { phase: string; errorClass: string; httpResponseReceived: boolean;
  errorCode?: string; httpStatus?: number }

/** Read only product-sanitized transport categories; never copy log text or arbitrary fields. */
export function relTransportDiagnostics(profile: string): { state: 'readable' | 'missing' | 'read-failed'; entries: TransportDiagnostic[] } {
  let log: string
  try { log = readFileSync(join(profile, 'diagnostics', 'editor-diagnostics.jsonl'), 'utf8') }
  catch (error) { return { state: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'read-failed', entries: [] } }
  const entries: TransportDiagnostic[] = []
  for (const line of log.split(/\r?\n/)) {
    if (!line) continue
    try {
      const record = JSON.parse(line) as { source?: unknown; details?: Record<string, unknown> }
      if (record.source !== 'main' || !record.details) continue
      const details = record.details
      if (typeof details.chatTransportPhase !== 'string' || !phases.has(details.chatTransportPhase)
        || typeof details.chatTransportClass !== 'string' || !classes.has(details.chatTransportClass)
        || typeof details.chatHttpResponseReceived !== 'boolean') continue
      const diagnostic: TransportDiagnostic = { phase: details.chatTransportPhase,
        errorClass: details.chatTransportClass, httpResponseReceived: details.chatHttpResponseReceived }
      if (typeof details.code === 'string' && codes.has(details.code)) diagnostic.errorCode = details.code
      if (Number.isInteger(details.httpStatus) && Number(details.httpStatus) >= 100 && Number(details.httpStatus) <= 599)
        diagnostic.httpStatus = Number(details.httpStatus)
      entries.push(diagnostic)
    } catch { /* A malformed unrelated log line carries no transport evidence. */ }
  }
  return { state: 'readable', entries }
}

export function preserveRelFailureEvidence(input: { sent: boolean; status: string | null; outcome?: string;
  postSendFailure?: boolean }): boolean {
  return input.sent && (input.status === null || ['partial', 'failed', 'interrupted'].includes(input.status)
    || input.outcome === 'unknown' || input.postSendFailure === true)
}

/** A prior paid run survives a continuation that never reached send. */
export function relRecoveryDisposition(input: { hasResumeManifest: boolean; sent: boolean; failureEvidence: boolean;
  liveApp: boolean; canResumePaid: boolean }) {
  const existingUnconsumedResume = input.hasResumeManifest && !input.sent
  return { existingUnconsumedResume, consumeManifest: input.hasResumeManifest && input.sent,
    privateProfilePreserved: input.failureEvidence || input.liveApp || input.canResumePaid || existingUnconsumedResume }
}
